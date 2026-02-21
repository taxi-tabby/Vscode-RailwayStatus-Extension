import * as vscode from 'vscode';
import {
  SECRET_KEY_ACCESS_TOKEN,
  SECRET_KEY_REFRESH_TOKEN,
  SECRET_KEY_API_TOKEN,
  SECRET_KEY_TOKEN_EXPIRES_AT,
} from '../constants';

export class TokenStore {
  constructor(private secrets: vscode.SecretStorage) {}

  async getAccessToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_ACCESS_TOKEN);
  }

  async getRefreshToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_REFRESH_TOKEN);
  }

  async getApiToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_API_TOKEN);
  }

  async getTokenExpiresAt(): Promise<number | undefined> {
    const val = await this.secrets.get(SECRET_KEY_TOKEN_EXPIRES_AT);
    return val ? parseInt(val, 10) : undefined;
  }

  async storeOAuthTokens(accessToken: string, refreshToken?: string, expiresIn?: number): Promise<void> {
    await this.secrets.store(SECRET_KEY_ACCESS_TOKEN, accessToken);
    if (refreshToken) {
      await this.secrets.store(SECRET_KEY_REFRESH_TOKEN, refreshToken);
    }
    if (expiresIn) {
      const expiresAt = Date.now() + expiresIn * 1000;
      await this.secrets.store(SECRET_KEY_TOKEN_EXPIRES_AT, expiresAt.toString());
    }
  }

  async storeApiToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_API_TOKEN, token);
  }

  async storeToken(key: string, value: string): Promise<void> {
    await this.secrets.store(key, value);
  }

  async clearAll(): Promise<void> {
    await this.secrets.delete(SECRET_KEY_ACCESS_TOKEN);
    await this.secrets.delete(SECRET_KEY_REFRESH_TOKEN);
    await this.secrets.delete(SECRET_KEY_API_TOKEN);
    await this.secrets.delete(SECRET_KEY_TOKEN_EXPIRES_AT);
  }

  async hasAnyToken(): Promise<boolean> {
    const access = await this.getAccessToken();
    const api = await this.getApiToken();
    return !!(access || api);
  }
}
