import * as vscode from 'vscode';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  RAILWAY_OAUTH_AUTH_URL,
  RAILWAY_OAUTH_TOKEN_URL,
  RAILWAY_OAUTH_SCOPES,
  RAILWAY_GRAPHQL_ENDPOINT,
  OAUTH_CALLBACK_PORT,
  OAUTH_CALLBACK_PATH,
} from '../constants';
import { TokenStore } from './tokenStore';

const AUTH_PROVIDER_ID = 'railway';
const AUTH_PROVIDER_LABEL = 'Railway';
const AUTH_TIMEOUT_MS = 300_000; // 5 minutes

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
    return [{
      id: 'railway-session',
      accessToken: token,
      account: { id: 'railway-user', label: 'Railway User' },
      scopes: [],
    }];
  }

  // ─── OAuth (requires user-registered Railway OAuth App) ───

  async createSession(_scopes: string[]): Promise<vscode.AuthenticationSession> {
    const clientId = this.getClientId();
    if (!clientId) {
      await this.promptOAuthSetup();
      throw new Error('OAuth Client ID not configured');
    }

    let server: http.Server | undefined;
    try {
      const callback = await this.startCallbackServer();
      server = callback.server;
      const redirectUri = `http://127.0.0.1:${callback.port}${OAUTH_CALLBACK_PATH}`;

      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const state = generateState();

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: RAILWAY_OAUTH_SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      });

      await vscode.env.openExternal(vscode.Uri.parse(`${RAILWAY_OAUTH_AUTH_URL}?${params}`));

      const { code, receivedState } = await callback.codePromise;

      if (receivedState !== state) {
        throw new Error('State parameter mismatch. Authentication aborted for security.');
      }

      const tokenResponse = await this.exchangeCodeForToken(clientId, code, redirectUri, codeVerifier);
      if (!tokenResponse.access_token) {
        throw new Error('Server returned empty access token');
      }

      await this.tokenStore.storeAccessToken(tokenResponse.access_token);
      return this.buildSession(tokenResponse.access_token);
    } catch (err) {
      if (err instanceof Error && err.message === 'Authentication timed out') {
        vscode.window.showWarningMessage('Railway OAuth timed out. Please try again.');
      }
      throw err;
    } finally {
      server?.close();
    }
  }

  async removeSession(_sessionId: string): Promise<void> {
    await this.tokenStore.clearAll();
    this._onDidChangeSessions.fire({ added: [], removed: [], changed: [] });
  }

  // ─── API Token (manual input) ───

  async loginWithToken(): Promise<void> {
    const token = await vscode.window.showInputBox({
      title: 'Railway: API Token',
      prompt: 'Paste your Railway API token (Account or Workspace token)',
      placeHolder: 'e.g. rlwy_xxxxxxxxxxxxxxxxxxxx',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) { return 'Token cannot be empty'; }
        return undefined;
      },
    });

    if (!token) { return; }

    const trimmed = token.trim();

    // Validate token by making a test API call
    const valid = await this.validateToken(trimmed);
    if (!valid) {
      vscode.window.showErrorMessage(
        'Railway: Invalid API token. Please check and try again.\n\nGet your token at: railway.com/account/tokens'
      );
      return;
    }

    await this.tokenStore.storeApiToken(trimmed);
    this._onDidChangeSessions.fire({ added: [this.buildSession(trimmed)], removed: [], changed: [] });
    vscode.window.showInformationMessage('Railway: Signed in with API token');
  }

  // ─── Import from Railway CLI ───

  async loginWithCli(): Promise<void> {
    const configPath = path.join(os.homedir(), '.railway', 'config.json');

    // Check if config file exists
    if (!fs.existsSync(configPath)) {
      const choice = await vscode.window.showWarningMessage(
        'Railway CLI config not found.\n\nMake sure Railway CLI is installed and you\'ve run "railway login" at least once.',
        'Install CLI Guide',
        'Open Terminal'
      );
      if (choice === 'Install CLI Guide') {
        await vscode.env.openExternal(vscode.Uri.parse('https://docs.railway.com/guides/cli'));
      } else if (choice === 'Open Terminal') {
        const t = vscode.window.createTerminal('Railway');
        t.show();
        t.sendText('echo "Run: railway login"');
      }
      return;
    }

    // Read and parse config
    let token: string | undefined;
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as {
        user?: { accessToken?: string; token?: string };
      };
      token = config.user?.accessToken || config.user?.token || undefined;
    } catch (err) {
      vscode.window.showErrorMessage(
        `Railway: Failed to read CLI config (${configPath}): ${err instanceof Error ? err.message : 'parse error'}`
      );
      return;
    }

    if (!token) {
      const choice = await vscode.window.showWarningMessage(
        'Railway CLI is installed but not logged in.\n\nRun "railway login" in your terminal first, then try again.',
        'Open Terminal'
      );
      if (choice === 'Open Terminal') {
        const t = vscode.window.createTerminal('Railway Login');
        t.show();
        t.sendText('railway login');
      }
      return;
    }

    // Validate the token
    const valid = await this.validateToken(token);
    if (!valid) {
      const choice = await vscode.window.showWarningMessage(
        'Railway CLI token is expired or invalid.\n\nRun "railway login" to refresh your session.',
        'Open Terminal'
      );
      if (choice === 'Open Terminal') {
        const t = vscode.window.createTerminal('Railway Login');
        t.show();
        t.sendText('railway login');
      }
      return;
    }

    await this.tokenStore.storeAccessToken(token);
    this._onDidChangeSessions.fire({ added: [this.buildSession(token)], removed: [], changed: [] });
    vscode.window.showInformationMessage('Railway: Signed in using CLI credentials');
  }

  // ─── Helpers ───

  private buildSession(token: string): vscode.AuthenticationSession {
    return {
      id: 'railway-session',
      accessToken: token,
      account: { id: 'railway-user', label: 'Railway User' },
      scopes: [],
    };
  }

  /** Validate a token by querying the Railway API */
  private async validateToken(token: string): Promise<boolean> {
    try {
      const res = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ query: '{ me { id } }' }),
      });
      if (res.status === 401 || res.status === 403) { return false; }
      if (!res.ok) { return false; }
      const json = await res.json() as { data?: { me?: { id: string } }; errors?: unknown[] };
      return !!json.data?.me?.id;
    } catch {
      // Network error — give benefit of doubt, let it through
      return true;
    }
  }

  private getClientId(): string | undefined {
    const id = vscode.workspace.getConfiguration('railway').get<string>('oauthClientId');
    return id && id.trim() ? id.trim() : undefined;
  }

  private async promptOAuthSetup(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      'Railway OAuth requires a Client ID.\n\n' +
      'Setup: railway.com > Workspace Settings > Developer > New OAuth App\n' +
      '  Type: Native\n' +
      '  Redirect URI: http://127.0.0.1:9876/callback\n\n' +
      'Then paste the Client ID in VS Code settings (railway.oauthClientId).\n\n' +
      'Alternatively, use an API Token or CLI import instead.',
      'Use API Token',
      'Import from CLI',
      'Open OAuth Setup Page'
    );

    if (choice === 'Use API Token') {
      await vscode.commands.executeCommand('railway.loginWithToken');
    } else if (choice === 'Import from CLI') {
      await vscode.commands.executeCommand('railway.loginWithCli');
    } else if (choice === 'Open OAuth Setup Page') {
      await vscode.env.openExternal(vscode.Uri.parse('https://railway.com/workspace/developer'));
    }
  }

  private async exchangeCodeForToken(
    clientId: string,
    code: string,
    redirectUri: string,
    codeVerifier: string
  ): Promise<{ access_token: string }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    let response: Response;
    try {
      response = await fetch(RAILWAY_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new Error(`Network error during token exchange: ${err instanceof Error ? err.message : 'connection failed'}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '(no response body)');
      throw new Error(`Token exchange failed (HTTP ${response.status}): ${text}`);
    }

    const json = await response.json() as { access_token?: string };
    if (!json.access_token) {
      throw new Error('Token exchange succeeded but no access_token in response');
    }

    return json as { access_token: string };
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
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname !== OAUTH_CALLBACK_PATH) {
          res.writeHead(404);
          res.end();
          return;
        }

        const error = url.searchParams.get('error');
        if (error) {
          const description = url.searchParams.get('error_description') ?? error;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buildHtmlPage('Authentication Failed', `Error: ${escapeHtml(description)}. You can close this tab.`));
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

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          rejectStart(new Error(
            `Port ${OAUTH_CALLBACK_PORT} is in use. Close any other application using it, or try again.`
          ));
        } else {
          rejectStart(new Error(`OAuth callback server error: ${err.message}`));
        }
      });

      server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
        resolveStart({ port: OAUTH_CALLBACK_PORT, server, codePromise });
      });

      const timeout = setTimeout(() => {
        server.close();
        rejectCode!(new Error('Authentication timed out'));
      }, AUTH_TIMEOUT_MS);

      // Clear timeout if code is resolved
      codePromise.finally(() => clearTimeout(timeout));
    });
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
  }
}

// ─── Utility functions ───

function generateCodeVerifier(): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.randomBytes(128);
  return Array.from(bytes, (b) => charset[b % charset.length]).join('');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtmlPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:2rem;border-radius:12px;background:#16213e;box-shadow:0 4px 20px rgba(0,0,0,.3)}
h1{margin:0 0 .5rem;font-size:1.5rem}p{margin:0;opacity:.8}</style>
</head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}
