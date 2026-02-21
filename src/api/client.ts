import {
  RAILWAY_GRAPHQL_ENDPOINT,
  RAILWAY_OAUTH_TOKEN_URL,
  SECRET_KEY_ACCESS_TOKEN,
  SECRET_KEY_REFRESH_TOKEN,
  SECRET_KEY_TOKEN_EXPIRES_AT,
} from '../constants';
import type {
  GraphQLResponse,
  RailwayWorkspace,
  RailwayEnvironment,
  RailwayDeployment,
} from '../types';
import {
  QUERY_WORKSPACES,
  QUERY_PROJECTS,
  QUERY_PROJECT_DETAIL,
  QUERY_LATEST_DEPLOYMENT,
} from './queries';

export class RailwayApiClient {
  private getAccessToken: () => Promise<string | undefined>;
  private getApiToken: () => Promise<string | undefined>;
  private getRefreshToken: () => Promise<string | undefined>;
  private storeToken: (key: string, value: string) => Promise<void>;
  private onAuthFailure: () => void;
  private clientId?: string;

  constructor(options: {
    getAccessToken: () => Promise<string | undefined>;
    getApiToken: () => Promise<string | undefined>;
    getRefreshToken: () => Promise<string | undefined>;
    storeToken: (key: string, value: string) => Promise<void>;
    onAuthFailure: () => void;
    clientId?: string;
  }) {
    this.getAccessToken = options.getAccessToken;
    this.getApiToken = options.getApiToken;
    this.getRefreshToken = options.getRefreshToken;
    this.storeToken = options.storeToken;
    this.onAuthFailure = options.onAuthFailure;
    this.clientId = options.clientId;
  }

  private async getToken(): Promise<string | undefined> {
    return (await this.getAccessToken()) ?? (await this.getApiToken());
  }

  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const token = await this.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 401) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        return this.request(query, variables);
      }
      this.onAuthFailure();
      throw new Error('Authentication expired');
    }

    if (!response.ok) {
      throw new Error(`Railway API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      throw new Error(`GraphQL error: ${json.errors[0].message}`);
    }
    if (!json.data) {
      throw new Error('No data in GraphQL response');
    }
    return json.data;
  }

  private async tryRefreshToken(): Promise<boolean> {
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken || !this.clientId) {
      return false;
    }

    try {
      const response = await fetch(RAILWAY_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
        }),
      });

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      await this.storeToken(SECRET_KEY_ACCESS_TOKEN, data.access_token);
      if (data.refresh_token) {
        await this.storeToken(SECRET_KEY_REFRESH_TOKEN, data.refresh_token);
      }
      if (data.expires_in) {
        const expiresAt = Date.now() + data.expires_in * 1000;
        await this.storeToken(SECRET_KEY_TOKEN_EXPIRES_AT, expiresAt.toString());
      }
      return true;
    } catch {
      return false;
    }
  }

  async getWorkspaces(): Promise<RailwayWorkspace[]> {
    const data = await this.request<{
      me: { workspaces: RailwayWorkspace[] };
    }>(QUERY_WORKSPACES);
    return data.me.workspaces;
  }

  async getProjects(workspaceId: string): Promise<Array<{ id: string; name: string }>> {
    const data = await this.request<{
      workspace: {
        projects: { edges: Array<{ node: { id: string; name: string } }> };
      };
    }>(QUERY_PROJECTS, { workspaceId });
    return data.workspace.projects.edges.map((e) => e.node);
  }

  async getProjectDetail(projectId: string): Promise<{
    services: Array<{ id: string; name: string }>;
    environments: RailwayEnvironment[];
  }> {
    const data = await this.request<{
      project: {
        id: string;
        name: string;
        services: { edges: Array<{ node: { id: string; name: string } }> };
        environments: { edges: Array<{ node: RailwayEnvironment }> };
      };
    }>(QUERY_PROJECT_DETAIL, { id: projectId });
    return {
      services: data.project.services.edges.map((e) => e.node),
      environments: data.project.environments.edges.map((e) => e.node),
    };
  }

  async getLatestDeployment(
    projectId: string,
    serviceId: string,
    environmentId: string
  ): Promise<RailwayDeployment | undefined> {
    const data = await this.request<{
      deployments: {
        edges: Array<{ node: RailwayDeployment }>;
      };
    }>(QUERY_LATEST_DEPLOYMENT, {
      input: { projectId, serviceId, environmentId },
    });
    return data.deployments.edges[0]?.node;
  }
}
