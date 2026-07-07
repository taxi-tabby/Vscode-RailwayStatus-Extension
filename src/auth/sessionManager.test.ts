import { describe, it, expect, vi } from 'vitest';
import { TokenStore, type SecretStorageLike } from './tokenStore';
import { SessionManager } from './sessionManager';
import { DeviceAuthError, type TokenSet } from './deviceFlow';
import { TOKEN_REFRESH_BUFFER_MS } from '../constants';

class FakeSecrets implements SecretStorageLike {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k); }
  async store(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
}
const makeStore = () => new TokenStore(new FakeSecrets());

describe('SessionManager.getValidAccessToken', () => {
  it('returns access token when not near expiry', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1_000_000 });
    const refresh = vi.fn<[string], Promise<TokenSet>>();
    const sm = new SessionManager(store, refresh, () => 1_000_000 - TOKEN_REFRESH_BUFFER_MS - 1);
    expect(await sm.getValidAccessToken()).toBe('AT');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when near expiry and stores new tokens', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 1_000_000 });
    const refresh = vi.fn(async (): Promise<TokenSet> => ({ accessToken: 'NEW', refreshToken: 'RT2', expiresAt: 9_000_000 }));
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    expect(await sm.getValidAccessToken()).toBe('NEW');
    expect(refresh).toHaveBeenCalledWith('RT');
    expect(await store.getAccessToken()).toBe('NEW');
    expect(await store.getRefreshToken()).toBe('RT2');
  });

  it('preserves old refresh token when refresh omits it', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 });
    const refresh = vi.fn(async (): Promise<TokenSet> => ({ accessToken: 'NEW', expiresAt: 9_000_000 }));
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    await sm.getValidAccessToken();
    expect(await store.getRefreshToken()).toBe('RT');
  });

  it('clears oauth tokens and falls back to api token on invalid_grant', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 });
    await store.storeApiToken('API');
    const refresh = vi.fn(async (): Promise<TokenSet> => { throw new DeviceAuthError('invalid_grant'); });
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    expect(await sm.getValidAccessToken()).toBe('API');
    expect(await store.getAccessToken()).toBeUndefined();
  });

  it('keeps existing access token on network error during refresh', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 });
    const refresh = vi.fn(async (): Promise<TokenSet> => { throw new DeviceAuthError('network'); });
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    expect(await sm.getValidAccessToken()).toBe('OLD');
    expect(await store.getAccessToken()).toBe('OLD');
  });

  it('falls back to api token when no oauth tokens', async () => {
    const store = makeStore();
    await store.storeApiToken('API');
    const sm = new SessionManager(store, vi.fn<[string], Promise<TokenSet>>(), () => 0);
    expect(await sm.getValidAccessToken()).toBe('API');
  });

  it('dedupes concurrent refreshes into one call', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 });
    let calls = 0;
    const refresh = vi.fn(async (): Promise<TokenSet> => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { accessToken: 'NEW', refreshToken: 'RT2', expiresAt: 9_000_000 };
    });
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    const [a, b] = await Promise.all([sm.getValidAccessToken(), sm.getValidAccessToken()]);
    expect([a, b]).toEqual(['NEW', 'NEW']);
    expect(calls).toBe(1);
  });
});
