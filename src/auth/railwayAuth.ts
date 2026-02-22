import * as vscode from 'vscode';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import {
  RAILWAY_OAUTH_AUTH_URL,
  RAILWAY_OAUTH_TOKEN_URL,
  OAUTH_SCOPES,
  OAUTH_CALLBACK_PATH,
  OAUTH_CALLBACK_PORT,
} from '../constants';
import { TokenStore } from './tokenStore';

const AUTH_PROVIDER_ID = 'railway';
const AUTH_PROVIDER_LABEL = 'Railway';

export class RailwayAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private tokenStore: TokenStore
  ) {
    this._disposables.push(
      vscode.authentication.registerAuthenticationProvider(
        AUTH_PROVIDER_ID,
        AUTH_PROVIDER_LABEL,
        this,
        { supportsMultipleAccounts: false }
      )
    );
  }

  async getSessions(_scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    const token = await this.tokenStore.getAccessToken();
    if (!token) {
      return [];
    }

    return [
      {
        id: 'railway-session',
        accessToken: token,
        account: { id: 'railway-user', label: 'Railway User' },
        scopes: [],
      },
    ];
  }

  async createSession(_scopes: string[]): Promise<vscode.AuthenticationSession> {
    const clientId = vscode.workspace.getConfiguration('railwayStatus').get<string>('oauthClientId');
    if (!clientId) {
      throw new Error(
        'OAuth Client ID not configured. Set "railwayStatus.oauthClientId" in settings, or use "Railway: Set API Token" instead.'
      );
    }

    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    // Start callback server on fixed port
    const callback = this.startCallbackServer(state);
    await callback.ready;
    const redirectUri = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;

    // Build auth URL and open browser
    const authUrl = new URL(RAILWAY_OAUTH_AUTH_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', OAUTH_SCOPES);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

    // Wait for auth code from callback
    const authCode = await callback.code;

    // Exchange code for tokens
    const tokenResponse = await fetch(RAILWAY_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };

    await this.tokenStore.storeOAuthTokens(
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in
    );

    const session: vscode.AuthenticationSession = {
      id: 'railway-session',
      accessToken: tokens.access_token,
      account: { id: 'railway-user', label: 'Railway User' },
      scopes: [],
    };

    this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
    return session;
  }

  async removeSession(_sessionId: string): Promise<void> {
    await this.tokenStore.clearAll();
    this._onDidChangeSessions.fire({ added: [], removed: [], changed: [] });
  }

  private startCallbackServer(expectedState: string): { ready: Promise<void>; code: Promise<string> } {
    let resolveReady: () => void;
    let rejectReady: (err: Error) => void;
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;

    const readyPromise = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`);
      if (url.pathname !== OAUTH_CALLBACK_PATH) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authentication Failed</h1><p>You can close this tab.</p></body></html>');
        server.close();
        rejectCode(new Error(`OAuth error: ${error}`));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Invalid State</h1><p>CSRF validation failed.</p></body></html>');
        server.close();
        rejectCode(new Error('OAuth state mismatch'));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing Code</h1></body></html>');
        server.close();
        rejectCode(new Error('No authorization code received'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Authentication Successful!</h1><p>You can close this tab and return to VS Code.</p></body></html>');
      server.close();
      resolveCode(code);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        rejectReady!(new Error(`Port ${OAUTH_CALLBACK_PORT} is already in use. Close any other application using this port and try again.`));
      } else {
        rejectReady!(err);
      }
    });

    server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
      resolveReady!();
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      rejectCode!(new Error('OAuth callback timed out'));
    }, 120_000);

    return { ready: readyPromise, code: codePromise };
  }

  async loginWithToken(): Promise<void> {
    const token = await vscode.window.showInputBox({
      prompt: 'Enter your Railway API Token',
      placeHolder: 'Paste your Account or Workspace token here',
      password: true,
      ignoreFocusOut: true,
    });

    if (!token) {
      return;
    }

    await this.tokenStore.storeApiToken(token);

    const session: vscode.AuthenticationSession = {
      id: 'railway-session',
      accessToken: token,
      account: { id: 'railway-user', label: 'Railway User' },
      scopes: [],
    };

    this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
  }
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}
