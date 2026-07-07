import * as vscode from 'vscode';
import { requestDeviceCode, pollForToken, type TokenSet } from './deviceFlow';
import { RAILWAY_GRAPHQL_ENDPOINT } from '../constants';
import { TokenStore } from './tokenStore';
import { SessionManager } from './sessionManager';

const AUTH_PROVIDER_ID = 'railway';
const AUTH_PROVIDER_LABEL = 'Railway';

export class RailwayAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private tokenStore: TokenStore,
    private sessionManager: SessionManager,
  ) {
    this._disposables.push(
      vscode.authentication.registerAuthenticationProvider(
        AUTH_PROVIDER_ID, AUTH_PROVIDER_LABEL, this,
        { supportsMultipleAccounts: false },
      ),
    );
  }

  async getSessions(_scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    const token = await this.sessionManager.getValidAccessToken();
    return token ? [this.buildSession(token)] : [];
  }

  // ─── Device Authorization Grant (browserless) ───
  async createSession(_scopes: string[]): Promise<vscode.AuthenticationSession> {
    const device = await requestDeviceCode();
    const url = device.verificationUriComplete ?? device.verificationUri;
    await vscode.env.clipboard.writeText(device.userCode);
    await vscode.env.openExternal(vscode.Uri.parse(url));

    const tokenSet = await vscode.window.withProgress<TokenSet>(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Waiting for Railway sign-in — approve code [${device.userCode}] in your browser (copied to clipboard)`,
        cancellable: true,
      },
      async (_progress, cancelToken) => {
        const ac = new AbortController();
        cancelToken.onCancellationRequested(() => ac.abort());
        return pollForToken(device.deviceCode, device.intervalMs, device.expiresAt, ac.signal);
      },
    );

    await this.tokenStore.storeOAuthTokens(tokenSet);
    const session = this.buildSession(tokenSet.accessToken);
    this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
    return session;
  }

  async removeSession(_sessionId: string): Promise<void> {
    await this.tokenStore.clearAll();
    this._onDidChangeSessions.fire({ added: [], removed: [], changed: [] });
  }

  // ─── API Token (manual fallback) ───
  async loginWithToken(): Promise<void> {
    const token = await vscode.window.showInputBox({
      title: 'Railway: API Token',
      prompt: 'Paste your Railway API token (Account or Workspace token)',
      placeHolder: 'e.g. rlwy_xxxxxxxxxxxxxxxxxxxx',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : 'Token cannot be empty'),
    });
    if (!token) { return; }

    const trimmed = token.trim();
    const valid = await this.validateToken(trimmed);
    if (!valid) {
      vscode.window.showErrorMessage(
        'Railway: Invalid API token. Check it at railway.com/account/tokens.',
      );
      return;
    }
    await this.tokenStore.storeApiToken(trimmed);
    this._onDidChangeSessions.fire({ added: [this.buildSession(trimmed)], removed: [], changed: [] });
    vscode.window.showInformationMessage('Railway: Signed in with API token');
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

  private async validateToken(token: string): Promise<boolean> {
    try {
      const res = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ query: '{ me { id } }' }),
      });
      if (res.status === 401 || res.status === 403) { return false; }
      if (!res.ok) { return false; }
      const json = (await res.json()) as { data?: { me?: { id: string } } };
      return !!json.data?.me?.id;
    } catch {
      return true; // network error: give the benefit of the doubt
    }
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
  }
}
