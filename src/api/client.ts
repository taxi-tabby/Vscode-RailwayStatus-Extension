import { RAILWAY_GRAPHQL_ENDPOINT } from '../constants';
import type {
  GraphQLResponse,
  RailwayEnvironment,
  RailwayDeployment,
} from '../types';
import {
  QUERY_WORKSPACES,
  QUERY_PROJECT_DETAIL,
  QUERY_LATEST_DEPLOYMENT,
} from './queries';

interface WorkspaceWithProjects {
  id: string;
  name: string;
  projects: Array<{ id: string; name: string; createdAt: string; updatedAt: string }>;
}

export class RailwayApiClient {
  private getAccessToken: () => Promise<string | undefined>;
  private getApiToken: () => Promise<string | undefined>;
  private onAuthFailure: () => void;

  constructor(options: {
    getAccessToken: () => Promise<string | undefined>;
    getApiToken: () => Promise<string | undefined>;
    onAuthFailure: () => void;
  }) {
    this.getAccessToken = options.getAccessToken;
    this.getApiToken = options.getApiToken;
    this.onAuthFailure = options.onAuthFailure;
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

  async getWorkspaces(): Promise<WorkspaceWithProjects[]> {
    const data = await this.request<{
      me: {
        workspaces: Array<{
          id: string;
          name: string;
          projects: {
            edges: Array<{ node: { id: string; name: string; createdAt: string; updatedAt: string } }>;
          };
        }>;
      };
    }>(QUERY_WORKSPACES);
    return data.me.workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      projects: ws.projects.edges.map((e) => e.node),
    }));
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
