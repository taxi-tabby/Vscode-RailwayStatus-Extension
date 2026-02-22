import * as vscode from 'vscode';
import {
  SECRET_KEY_ACCESS_TOKEN,
  SECRET_KEY_API_TOKEN,
} from '../constants';

export class TokenStore {
  constructor(private secrets: vscode.SecretStorage) {}

  async getAccessToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_ACCESS_TOKEN);
  }

  async getApiToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_API_TOKEN);
  }

  async storeAccessToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_ACCESS_TOKEN, token);
  }

  async storeApiToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_API_TOKEN, token);
  }

  async clearAll(): Promise<void> {
    await this.secrets.delete(SECRET_KEY_ACCESS_TOKEN);
    await this.secrets.delete(SECRET_KEY_API_TOKEN);
  }

  async hasAnyToken(): Promise<boolean> {
    const access = await this.getAccessToken();
    const api = await this.getApiToken();
    return !!(access || api);
  }
}
