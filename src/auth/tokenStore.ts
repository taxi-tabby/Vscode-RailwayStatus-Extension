import {
  SECRET_KEY_ACCESS_TOKEN,
  SECRET_KEY_API_TOKEN,
  SECRET_KEY_REFRESH_TOKEN,
  SECRET_KEY_TOKEN_EXPIRES_AT,
} from '../constants';

/** vscode.SecretStorage의 구조적 부분집합 (테스트를 위해 vscode 의존 제거) */
export interface SecretStorageLike {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export class TokenStore {
  constructor(private secrets: SecretStorageLike) {}

  async getAccessToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_ACCESS_TOKEN);
  }

  async getRefreshToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_REFRESH_TOKEN);
  }

  async getApiToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_API_TOKEN);
  }

  async getExpiresAt(): Promise<number | undefined> {
    const raw = await this.secrets.get(SECRET_KEY_TOKEN_EXPIRES_AT);
    if (raw === undefined) { return undefined; }
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  async storeOAuthTokens(t: {
    accessToken: string; refreshToken?: string; expiresAt: number;
  }): Promise<void> {
    await this.secrets.store(SECRET_KEY_ACCESS_TOKEN, t.accessToken);
    if (t.refreshToken) {
      await this.secrets.store(SECRET_KEY_REFRESH_TOKEN, t.refreshToken);
    }
    await this.secrets.store(SECRET_KEY_TOKEN_EXPIRES_AT, String(t.expiresAt));
  }

  async storeAccessToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_ACCESS_TOKEN, token);
  }

  async storeApiToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_API_TOKEN, token);
  }

  async clearOAuthTokens(): Promise<void> {
    await this.secrets.delete(SECRET_KEY_ACCESS_TOKEN);
    await this.secrets.delete(SECRET_KEY_REFRESH_TOKEN);
    await this.secrets.delete(SECRET_KEY_TOKEN_EXPIRES_AT);
  }

  async clearAll(): Promise<void> {
    await this.clearOAuthTokens();
    await this.secrets.delete(SECRET_KEY_API_TOKEN);
  }

  async hasAnyToken(): Promise<boolean> {
    const access = await this.getAccessToken();
    const api = await this.getApiToken();
    return !!(access || api);
  }
}
