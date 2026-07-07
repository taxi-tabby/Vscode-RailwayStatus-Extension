import { describe, it, expect, beforeEach } from 'vitest';
import { TokenStore, type SecretStorageLike } from './tokenStore';

class FakeSecrets implements SecretStorageLike {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k); }
  async store(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
}

describe('TokenStore', () => {
  let store: TokenStore;
  beforeEach(() => { store = new TokenStore(new FakeSecrets()); });

  it('stores and reads OAuth token set incl. numeric expiresAt', async () => {
    await store.storeOAuthTokens({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1234567890 });
    expect(await store.getAccessToken()).toBe('AT');
    expect(await store.getRefreshToken()).toBe('RT');
    expect(await store.getExpiresAt()).toBe(1234567890);
  });

  it('getExpiresAt returns undefined when unset', async () => {
    expect(await store.getExpiresAt()).toBeUndefined();
  });

  it('clearOAuthTokens removes oauth keys but keeps api token', async () => {
    await store.storeOAuthTokens({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1 });
    await store.storeApiToken('API');
    await store.clearOAuthTokens();
    expect(await store.getAccessToken()).toBeUndefined();
    expect(await store.getRefreshToken()).toBeUndefined();
    expect(await store.getExpiresAt()).toBeUndefined();
    expect(await store.getApiToken()).toBe('API');
  });

  it('clearAll removes everything', async () => {
    await store.storeOAuthTokens({ accessToken: 'AT', expiresAt: 1 });
    await store.storeApiToken('API');
    await store.clearAll();
    expect(await store.hasAnyToken()).toBe(false);
  });

  it('hasAnyToken true with only api token', async () => {
    await store.storeApiToken('API');
    expect(await store.hasAnyToken()).toBe(true);
  });
});
