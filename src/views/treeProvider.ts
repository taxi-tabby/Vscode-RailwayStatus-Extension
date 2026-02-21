import * as vscode from 'vscode';
import { RailwayApiClient } from '../api/client';
import { WorkspaceNode, ProjectNode, ServiceNode, type RailwayNode } from './nodes';

export class RailwayTreeDataProvider implements vscode.TreeDataProvider<RailwayNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RailwayNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private apiClient: RailwayApiClient) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: RailwayNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RailwayNode): Promise<RailwayNode[]> {
    if (!element) {
      return this.getWorkspaces();
    }

    if (element instanceof WorkspaceNode) {
      return this.getProjects(element.workspaceId);
    }

    if (element instanceof ProjectNode) {
      return this.getServices(element.projectId);
    }

    return [];
  }

  private async getWorkspaces(): Promise<WorkspaceNode[]> {
    try {
      const workspaces = await this.apiClient.getWorkspaces();
      return workspaces.map((ws) => new WorkspaceNode(ws.id, ws.name));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to load workspaces: ${message}`);
      return [];
    }
  }

  private async getProjects(workspaceId: string): Promise<ProjectNode[]> {
    try {
      const projects = await this.apiClient.getProjects(workspaceId);
      return projects.map(
        (proj) => new ProjectNode(proj.id, proj.name, workspaceId)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to load projects: ${message}`);
      return [];
    }
  }

  private async getServices(projectId: string): Promise<ServiceNode[]> {
    try {
      const detail = await this.apiClient.getProjectDetail(projectId);
      const defaultEnv = detail.environments[0];

      const serviceNodes: ServiceNode[] = [];
      for (const svc of detail.services) {
        let deployment;
        if (defaultEnv) {
          deployment = await this.apiClient.getLatestDeployment(
            projectId,
            svc.id,
            defaultEnv.id
          );
          if (deployment) {
            deployment.environmentName = defaultEnv.name;
          }
        }
        serviceNodes.push(new ServiceNode(svc.id, svc.name, projectId, deployment));
      }
      return serviceNodes;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to load services: ${message}`);
      return [];
    }
  }
}
