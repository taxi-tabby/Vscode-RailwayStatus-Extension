import * as vscode from 'vscode';
import { RailwayApiClient } from '../api/client';
import { ACTIVE_DEPLOYMENT_STATUSES, POLLING_ACTIVE_INTERVAL, POLLING_IDLE_INTERVAL } from '../constants';
import { WorkspaceNode, ProjectNode, ServiceNode, type RailwayNode } from './nodes';
import { PollingManager } from './pollingManager';
import type { RailwayDeployment } from '../types';

export type SortMode = 'name' | 'createdAsc' | 'updatedDesc';

interface ServiceDetailCache {
  services: Array<{ id: string; name: string }>;
  defaultEnvId: string;
  defaultEnvName: string;
}

export class RailwayTreeDataProvider implements vscode.TreeDataProvider<RailwayNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RailwayNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private projectsByWorkspace = new Map<string, Array<{ id: string; name: string; createdAt: string; updatedAt: string }>>();
  private sortMode: SortMode = 'name';

  // Polling support
  private projectNodeMap = new Map<string, ProjectNode>();
  private serviceDetailCache = new Map<string, ServiceDetailCache>();
  private lastDeploymentSnapshots = new Map<string, string>();
  private treeView: vscode.TreeView<RailwayNode> | undefined;
  readonly pollingManager: PollingManager;

  constructor(private apiClient: RailwayApiClient) {
    const config = vscode.workspace.getConfiguration('railway');
    const activeInterval = (config.get<number>('autoRefreshActiveInterval') ?? 10) * 1000;
    const idleInterval = (config.get<number>('autoRefreshIdleInterval') ?? 30) * 1000;

    this.pollingManager = new PollingManager(
      (projectId) => this.pollProject(projectId),
      activeInterval || POLLING_ACTIVE_INTERVAL,
      idleInterval || POLLING_IDLE_INTERVAL,
    );
  }

  setTreeView(treeView: vscode.TreeView<RailwayNode>): void {
    this.treeView = treeView;
  }

  setSortMode(mode: SortMode): void {
    this.sortMode = mode;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this.projectsByWorkspace.clear();
    this.projectNodeMap.clear();
    this.serviceDetailCache.clear();
    this.lastDeploymentSnapshots.clear();
    this.pollingManager.clearAll();
    this._onDidChangeTreeData.fire();
    this.updateViewDescription(0);
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
      for (const ws of workspaces) {
        this.projectsByWorkspace.set(ws.id, ws.projects);
      }
      return workspaces.map((ws) => new WorkspaceNode(ws.id, ws.name));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to load workspaces: ${message}`);
      return [];
    }
  }

  private async getProjects(workspaceId: string): Promise<ProjectNode[]> {
    const projects = [...(this.projectsByWorkspace.get(workspaceId) ?? [])];

    switch (this.sortMode) {
      case 'name':
        projects.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'createdAsc':
        projects.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case 'updatedDesc':
        projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
    }

    const nodes = projects.map(
      (proj) => new ProjectNode(proj.id, proj.name, workspaceId, undefined, proj.createdAt, proj.updatedAt)
    );
    for (const node of nodes) {
      this.projectNodeMap.set(node.projectId, node);
    }
    return nodes;
  }

  private async getServices(projectId: string): Promise<ServiceNode[]> {
    try {
      const detail = await this.apiClient.getProjectDetail(projectId);
      const defaultEnv = detail.environments[0];

      // Cache service/environment info for polling
      if (defaultEnv) {
        this.serviceDetailCache.set(projectId, {
          services: detail.services,
          defaultEnvId: defaultEnv.id,
          defaultEnvName: defaultEnv.name,
        });
      }

      // Fetch all deployments in parallel
      let deployments: Array<RailwayDeployment | undefined> = [];
      if (defaultEnv) {
        deployments = await Promise.all(
          detail.services.map((svc) =>
            this.apiClient.getLatestDeployment(projectId, svc.id, defaultEnv.id)
          )
        );
      }

      const serviceNodes: ServiceNode[] = detail.services.map((svc, i) => {
        const deployment = deployments[i];
        if (deployment && defaultEnv) {
          deployment.environmentName = defaultEnv.name;
        }
        return new ServiceNode(svc.id, svc.name, projectId, deployment);
      });

      // Track active deployment status for polling interval
      const hasActive = serviceNodes.some(
        (n) => n.deployment && ACTIVE_DEPLOYMENT_STATUSES.has(n.deployment.status)
      );
      this.pollingManager.updateProjectStatus(projectId, hasActive);

      // Save deployment snapshot for change detection
      this.saveDeploymentSnapshot(projectId, serviceNodes);

      // Update view description
      this.updateActiveCount();

      // Sort
      switch (this.sortMode) {
        case 'name':
          serviceNodes.sort((a, b) => a.serviceName.localeCompare(b.serviceName));
          break;
        case 'createdAsc':
          serviceNodes.sort((a, b) => {
            const tA = a.deployment?.createdAt ? new Date(a.deployment.createdAt).getTime() : 0;
            const tB = b.deployment?.createdAt ? new Date(b.deployment.createdAt).getTime() : 0;
            return tA - tB;
          });
          break;
        case 'updatedDesc':
          serviceNodes.sort((a, b) => {
            const tA = a.deployment?.createdAt ? new Date(a.deployment.createdAt).getTime() : 0;
            const tB = b.deployment?.createdAt ? new Date(b.deployment.createdAt).getTime() : 0;
            return tB - tA;
          });
          break;
      }

      return serviceNodes;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to load services: ${message}`);
      return [];
    }
  }

  /** Poll a single project: reuse cached services, only re-fetch deployments */
  private async pollProject(projectId: string): Promise<void> {
    const cached = this.serviceDetailCache.get(projectId);
    if (!cached) { return; } // never loaded yet, skip

    try {
      const deployments = await Promise.all(
        cached.services.map((svc) =>
          this.apiClient.getLatestDeployment(projectId, svc.id, cached.defaultEnvId)
        )
      );

      const serviceNodes = cached.services.map((svc, i) => {
        const deployment = deployments[i];
        if (deployment) {
          deployment.environmentName = cached.defaultEnvName;
        }
        return new ServiceNode(svc.id, svc.name, projectId, deployment);
      });

      // Check if anything changed
      const oldSnapshot = this.lastDeploymentSnapshots.get(projectId);
      const newSnapshot = this.buildSnapshot(serviceNodes);
      if (oldSnapshot === newSnapshot) { return; } // no change

      this.lastDeploymentSnapshots.set(projectId, newSnapshot);

      // Update active status
      const hasActive = serviceNodes.some(
        (n) => n.deployment && ACTIVE_DEPLOYMENT_STATUSES.has(n.deployment.status)
      );
      this.pollingManager.updateProjectStatus(projectId, hasActive);

      // Partial tree refresh
      const projectNode = this.projectNodeMap.get(projectId);
      this._onDidChangeTreeData.fire(projectNode);

      this.updateActiveCount();
    } catch {
      // Silently ignore polling errors to avoid spamming the user
    }
  }

  private saveDeploymentSnapshot(projectId: string, serviceNodes: ServiceNode[]): void {
    this.lastDeploymentSnapshots.set(projectId, this.buildSnapshot(serviceNodes));
  }

  private buildSnapshot(serviceNodes: ServiceNode[]): string {
    const data = serviceNodes.map((n) => ({
      id: n.deployment?.id,
      status: n.deployment?.status,
    }));
    return JSON.stringify(data);
  }

  private updateActiveCount(): void {
    let count = 0;
    for (const snapshot of this.lastDeploymentSnapshots.values()) {
      const entries = JSON.parse(snapshot) as Array<{ id?: string; status?: string }>;
      count += entries.filter((e) => e.status && ACTIVE_DEPLOYMENT_STATUSES.has(e.status)).length;
    }
    this.updateViewDescription(count);
  }

  private updateViewDescription(activeCount: number): void {
    if (!this.treeView) { return; }
    this.treeView.description = activeCount > 0
      ? `${activeCount} deploying`
      : '';
  }
}
