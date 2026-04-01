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
  QUERY_DEPLOYMENT_HISTORY,
  MUTATION_DEPLOYMENT_REDEPLOY,
  MUTATION_DEPLOYMENT_RESTART,
  QUERY_BUILD_LOGS,
  QUERY_DEPLOY_LOGS,
  QUERY_VARIABLES,
  MUTATION_VARIABLE_UPSERT,
  MUTATION_VARIABLE_DELETE,
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

  async getDeploymentHistory(
    projectId: string,
    serviceId: string,
    environmentId: string
  ): Promise<RailwayDeployment[]> {
    const data = await this.request<{
      deployments: { edges: Array<{ node: RailwayDeployment }> };
    }>(QUERY_DEPLOYMENT_HISTORY, {
      input: { projectId, serviceId, environmentId },
    });
    return data.deployments.edges.map((e) => e.node);
  }

  async redeployDeployment(deploymentId: string): Promise<void> {
    await this.request<{ deploymentRedeploy: { id: string } }>(
      MUTATION_DEPLOYMENT_REDEPLOY,
      { id: deploymentId }
    );
  }

  async restartDeployment(deploymentId: string): Promise<void> {
    await this.request<{ deploymentRestart: boolean }>(
      MUTATION_DEPLOYMENT_RESTART,
      { id: deploymentId }
    );
  }

  async getBuildLogs(deploymentId: string, limit = 200): Promise<LogEntry[]> {
    const data = await this.request<{
      buildLogs: LogEntry[];
    }>(QUERY_BUILD_LOGS, { deploymentId, limit });
    return data.buildLogs ?? [];
  }

  async getDeploymentLogs(deploymentId: string, limit = 200): Promise<LogEntry[]> {
    const data = await this.request<{
      deploymentLogs: LogEntry[];
    }>(QUERY_DEPLOY_LOGS, { deploymentId, limit });
    return data.deploymentLogs ?? [];
  }

  async getVariables(projectId: string, environmentId: string, serviceId: string): Promise<Record<string, string>> {
    const data = await this.request<{
      variables: Record<string, string>;
    }>(QUERY_VARIABLES, { projectId, environmentId, serviceId });
    return data.variables ?? {};
  }

  async upsertVariable(projectId: string, environmentId: string, serviceId: string, name: string, value: string): Promise<void> {
    await this.request(MUTATION_VARIABLE_UPSERT, {
      input: { projectId, environmentId, serviceId, name, value },
    });
  }

  async deleteVariable(projectId: string, environmentId: string, serviceId: string, name: string): Promise<void> {
    await this.request(MUTATION_VARIABLE_DELETE, {
      input: { projectId, environmentId, serviceId, name },
    });
  }
}

export interface LogEntry {
  message: string;
  timestamp: string;
  severity?: string;
}
