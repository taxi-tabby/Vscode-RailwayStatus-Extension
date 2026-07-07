import { TokenStore } from './tokenStore';
import { refreshAccessToken, DeviceAuthError, type TokenSet } from './deviceFlow';
import { TOKEN_REFRESH_BUFFER_MS } from '../constants';

export class SessionManager {
  private inflight?: Promise<string | undefined>;

  constructor(
    private store: TokenStore,
    private refresh: (refreshToken: string) => Promise<TokenSet> = refreshAccessToken,
    private now: () => number = Date.now,
  ) {}

  async getValidAccessToken(): Promise<string | undefined> {
    const access = await this.store.getAccessToken();
    if (access) {
      const exp = await this.store.getExpiresAt();
      if (exp === undefined || exp - this.now() > TOKEN_REFRESH_BUFFER_MS) {
        return access;
      }
      const refreshed = await this.doRefresh();
      if (refreshed) { return refreshed; }
      // refresh failed: invalid_grant clears tokens, network errors keep them
      const still = await this.store.getAccessToken();
      if (still) { return still; }
    } else if (await this.store.getRefreshToken()) {
      const refreshed = await this.doRefresh();
      if (refreshed) { return refreshed; }
    }
    // OAuth path exhausted -> API token fallback
    return await this.store.getApiToken();
  }

  async forceRefresh(): Promise<string | undefined> {
    return this.doRefresh();
  }

  private doRefresh(): Promise<string | undefined> {
    if (!this.inflight) {
      this.inflight = this.performRefresh().finally(() => { this.inflight = undefined; });
    }
    return this.inflight;
  }

  private async performRefresh(): Promise<string | undefined> {
    const rt = await this.store.getRefreshToken();
    if (!rt) { return undefined; }
    try {
      const set = await this.refresh(rt);
      await this.store.storeOAuthTokens({
        accessToken: set.accessToken,
        refreshToken: set.refreshToken ?? rt, // keep the old one if the response omits it
        expiresAt: set.expiresAt,
      });
      return set.accessToken;
    } catch (e) {
      if (e instanceof DeviceAuthError && e.code === 'invalid_grant') {
        await this.store.clearOAuthTokens();
      }
      // network/unknown -> keep tokens
      return undefined;
    }
  }
}
