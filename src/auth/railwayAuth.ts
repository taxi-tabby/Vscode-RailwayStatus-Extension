import * as vscode from 'vscode';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import {
  RAILWAY_OAUTH_AUTH_URL,
  RAILWAY_OAUTH_TOKEN_URL,
  RAILWAY_OAUTH_CLIENT_ID,
  RAILWAY_OAUTH_SCOPES,
} from '../constants';
import { TokenStore } from './tokenStore';

const AUTH_PROVIDER_ID = 'railway';
const AUTH_PROVIDER_LABEL = 'Railway';
const CALLBACK_PATH = '/callback';
const AUTH_TIMEOUT_MS = 300_000; // 5 minutes (matching CLI)

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
    const { port, server, codePromise } = await this.startCallbackServer();
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Build authorization URL (matching Railway CLI's OAuth flow)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: RAILWAY_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: RAILWAY_OAUTH_SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      prompt: 'consent',
    });

    const authUrl = `${RAILWAY_OAUTH_AUTH_URL}?${params.toString()}`;
    await vscode.env.openExternal(vscode.Uri.parse(authUrl));

    try {
      const { code, receivedState } = await codePromise;

      // Validate state to prevent CSRF
      if (receivedState !== state) {
        throw new Error('State mismatch — possible CSRF attack');
      }

      // Exchange authorization code for tokens
      const tokenResponse = await this.exchangeCodeForToken(code, redirectUri, codeVerifier);
      await this.tokenStore.storeAccessToken(tokenResponse.access_token);

      const session: vscode.AuthenticationSession = {
        id: 'railway-session',
        accessToken: tokenResponse.access_token,
        account: { id: 'railway-user', label: 'Railway User' },
        scopes: [],
      };

      this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
      return session;
    } finally {
      server.close();
    }
  }

  async removeSession(_sessionId: string): Promise<void> {
    await this.tokenStore.clearAll();
    this._onDidChangeSessions.fire({ added: [], removed: [], changed: [] });
  }

  private async exchangeCodeForToken(
    code: string,
    redirectUri: string,
    codeVerifier: string
  ): Promise<{ access_token: string }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: RAILWAY_OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    });

    const response = await fetch(RAILWAY_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<{ access_token: string }>;
  }

  private startCallbackServer(): Promise<{
    port: number;
    server: http.Server;
    codePromise: Promise<{ code: string; receivedState: string }>;
  }> {
    return new Promise((resolveStart, rejectStart) => {
      let resolveCode: (value: { code: string; receivedState: string }) => void;
      let rejectCode: (err: Error) => void;

      const codePromise = new Promise<{ code: string; receivedState: string }>((res, rej) => {
        resolveCode = res;
        rejectCode = rej;
      });

      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost`);

        // Only handle the callback path
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404);
          res.end();
          return;
        }

        const error = url.searchParams.get('error');
        if (error) {
          const description = url.searchParams.get('error_description') ?? error;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buildHtmlPage('Authentication Failed', `Error: ${description}. You can close this tab.`));
          rejectCode(new Error(description));
          return;
        }

        const code = url.searchParams.get('code');
        const receivedState = url.searchParams.get('state') ?? '';

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buildHtmlPage('Authentication Failed', 'No authorization code received. You can close this tab.'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildHtmlPage('Authentication Successful', 'You can close this tab and return to VS Code.'));
        resolveCode({ code, receivedState });
      });

      server.on('error', (err) => {
        rejectStart(err);
      });

      // Listen on random port (port 0 lets the OS assign one)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolveStart({ port, server, codePromise });
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        rejectCode!(new Error('Authentication timed out'));
      }, AUTH_TIMEOUT_MS);
    });
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

/** Generate a PKCE code verifier (128 chars from unreserved charset) */
function generateCodeVerifier(): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.randomBytes(128);
  return Array.from(bytes, (b) => charset[b % charset.length]).join('');
}

/** Generate a PKCE code challenge (S256) from the verifier */
function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url'); // base64url = URL-safe, no padding
}

/** Generate a random state parameter for CSRF protection */
function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Build a simple HTML response page */
function buildHtmlPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:2rem;border-radius:12px;background:#16213e;box-shadow:0 4px 20px rgba(0,0,0,.3)}
h1{margin:0 0 .5rem;font-size:1.5rem}p{margin:0;opacity:.8}</style>
</head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}
