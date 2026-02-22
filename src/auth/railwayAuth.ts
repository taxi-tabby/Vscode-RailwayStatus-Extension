import * as vscode from 'vscode';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { RAILWAY_CLI_LOGIN_URL } from '../constants';
import { TokenStore } from './tokenStore';

const AUTH_PROVIDER_ID = 'railway';
const AUTH_PROVIDER_LABEL = 'Railway';
const RAILWAY_ORIGIN = 'https://railway.com';

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
    const { port, server, tokenPromise } = await this.startCallbackServer();

    const code = generateNumericCode(32);
    const payload = `port=${port}&code=${code}&hostname=${os.hostname()}`;
    // Use base64 with URL-safe characters (matching Rust CLI's URL_SAFE + padding)
    const encoded = Buffer.from(payload).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const loginUrl = `${RAILWAY_CLI_LOGIN_URL}?d=${encoded}`;
    await vscode.env.openExternal(vscode.Uri.parse(loginUrl));

    try {
      const token = await tokenPromise;
      await this.tokenStore.storeAccessToken(token);

      const session: vscode.AuthenticationSession = {
        id: 'railway-session',
        accessToken: token,
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

  private startCallbackServer(): Promise<{
    port: number;
    server: http.Server;
    tokenPromise: Promise<string>;
  }> {
    return new Promise((resolveStart, rejectStart) => {
      let resolveToken: (token: string) => void;
      let rejectToken: (err: Error) => void;

      const tokenPromise = new Promise<string>((res, rej) => {
        resolveToken = res;
        rejectToken = rej;
      });

      const server = http.createServer((req, res) => {
        const corsHeaders: Record<string, string> = {
          'Access-Control-Allow-Origin': RAILWAY_ORIGIN,
          'Access-Control-Allow-Methods': 'GET, HEAD, PUT, PATCH, POST, DELETE',
          'Access-Control-Allow-Headers': '*',
        };

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders);
          res.end();
          return;
        }

        const url = new URL(req.url ?? '/', 'http://localhost');
        const token = url.searchParams.get('token');

        if (!token) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ status: 'error', error: 'No token received' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ status: 'Ok', error: '' }));
        resolveToken(token);
      });

      server.on('error', (err) => {
        rejectStart(err);
      });

      // Listen on random port (50000-60000 range like Railway CLI)
      const port = 50000 + crypto.randomInt(10000);
      server.listen(port, '127.0.0.1', () => {
        resolveStart({ port, server, tokenPromise });
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        rejectToken!(new Error('Authentication timed out'));
      }, 120_000);
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

function generateNumericCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => (b % 10).toString()).join('');
}
