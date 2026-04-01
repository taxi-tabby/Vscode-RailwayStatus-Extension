import * as vscode from 'vscode';
import { RailwayApiClient } from '../api/client';
import { ACTIVE_DEPLOYMENT_STATUSES, POLLING_ACTIVE_INTERVAL, POLLING_IDLE_INTERVAL } from '../constants';
import { WorkspaceNode, ProjectNode, EnvironmentNode, ServiceNode, type RailwayNode } from './nodes';
import { PollingManager } from './pollingManager';
import { RailwayStatusBar } from './statusBar';
import { NotificationManager, type DeploymentChange } from './notificationManager';
import type { RailwayDeployment } from '../types';

export type SortMode = 'name' | 'createdAsc' | 'updatedDesc';

interface ProjectDetailCache {
  services: Array<{ id: string; name: string }>;
  environments: Array<{ id: string; name: string }>;
}

export class RailwayTreeDataProvider implements vscode.TreeDataProvider<RailwayNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RailwayNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private projectsByWorkspace = new Map<string, Array<{ id: string; name: string; createdAt: string; updatedAt: string }>>();
  private sortMode: SortMode = 'name';

  // Polling support
  private projectNodeMap = new Map<string, ProjectNode>();
  private projectDetailCache = new Map<string, ProjectDetailCache>();
  private lastDeploymentSnapshots = new Map<string, string>();
  private treeView: vscode.TreeView<RailwayNode> | undefined;
  readonly pollingManager: PollingManager;
  readonly statusBar = new RailwayStatusBar();
  private readonly notificationManager = new NotificationManager();
  private globalState!: vscode.Memento;

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

  private workspaceState!: vscode.Memento;
  private linkedProjectId: string | undefined;

  /** Must be called after construction to restore persisted settings */
  initState(globalState: vscode.Memento, workspaceState: vscode.Memento): void {
    this.globalState = globalState;
    this.workspaceState = workspaceState;
    this.sortMode = globalState.get<SortMode>('railway.sortMode', 'name');
    this.linkedProjectId = workspaceState.get<string>('railway.linkedProjectId');
  }

  linkProject(projectId: string): void {
    this.linkedProjectId = projectId;
    this.workspaceState?.update('railway.linkedProjectId', projectId);
    this._onDidChangeTreeData.fire();
  }

  unlinkProject(): void {
    this.linkedProjectId = undefined;
    this.workspaceState?.update('railway.linkedProjectId', undefined);
    this._onDidChangeTreeData.fire();
  }

  getLinkedProjectId(): string | undefined {
    return this.linkedProjectId;
  }

  setTreeView(treeView: vscode.TreeView<RailwayNode>): void {
    this.treeView = treeView;
  }

  setSortMode(mode: SortMode): void {
    this.sortMode = mode;
    this.globalState?.update('railway.sortMode', mode);
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this.projectsByWorkspace.clear();
    this.projectNodeMap.clear();
    this.projectDetailCache.clear();
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
      return this.getEnvironments(element.projectId, element.workspaceId);
    }

    if (element instanceof EnvironmentNode) {
      return this.getServices(element.projectId, element.environmentId, element.environmentName);
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

    // Pin linked project to top
    if (this.linkedProjectId) {
      const idx = projects.findIndex((p) => p.id === this.linkedProjectId);
      if (idx > 0) {
        const [linked] = projects.splice(idx, 1);
        projects.unshift(linked);
      }
    }

    const nodes = projects.map((proj) => {
      const isLinked = proj.id === this.linkedProjectId;
      return new ProjectNode(proj.id, proj.name, workspaceId, undefined, proj.createdAt, proj.updatedAt, isLinked);
    });
    for (const node of nodes) {
      this.projectNodeMap.set(node.projectId, node);
    }
    return nodes;
  }

  private async getEnvironments(projectId: string, workspaceId: string): Promise<EnvironmentNode[]> {
    try {
      const detail = await this.apiClient.getProjectDetail(projectId);

      // Cache for polling
      this.projectDetailCache.set(projectId, {
        services: detail.services,
        environments: detail.environments,
      });

      // Sort: production first, then alphabetically
      const sorted = [...detail.environments].sort((a, b) => {
        const aIsProd = /production/i.test(a.name) ? 0 : 1;
        const bIsProd = /production/i.test(b.name) ? 0 : 1;
        return aIsProd - bIsProd || a.name.localeCompare(b.name);
      });

      return sorted.map(
        (env) => new EnvironmentNode(env.id, env.name, projectId, workspaceId)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to load environments: ${message}`);
      return [];
    }
  }

  private async getServices(projectId: string, environmentId: string, environmentName: string): Promise<ServiceNode[]> {
    try {
      const cached = this.projectDetailCache.get(projectId);
      const services = cached?.services ?? (await this.apiClient.getProjectDetail(projectId)).services;

      const deployments = await Promise.all(
        services.map((svc) =>
          this.apiClient.getLatestDeployment(projectId, svc.id, environmentId)
        )
      );

      const serviceNodes: ServiceNode[] = services.map((svc, i) => {
        const deployment = deployments[i];
        if (deployment) {
          deployment.environmentName = environmentName;
          deployment.environmentId = environmentId;
        }
        return new ServiceNode(svc.id, svc.name, projectId, deployment);
      });

      // Track active deployment status for polling
      const snapshotKey = `${projectId}:${environmentId}`;
      const hasActive = serviceNodes.some(
        (n) => n.deployment && ACTIVE_DEPLOYMENT_STATUSES.has(n.deployment.status)
      );
      this.pollingManager.updateProjectStatus(snapshotKey, hasActive);
      this.saveDeploymentSnapshot(snapshotKey, serviceNodes);
      this.updateActiveCount();

      // Sort
      this.sortServiceNodes(serviceNodes);
      return serviceNodes;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to load services: ${message}`);
      return [];
    }
  }

  private sortServiceNodes(nodes: ServiceNode[]): void {
    switch (this.sortMode) {
      case 'name':
        nodes.sort((a, b) => a.serviceName.localeCompare(b.serviceName));
        break;
      case 'createdAsc':
        nodes.sort((a, b) => {
          const tA = a.deployment?.createdAt ? new Date(a.deployment.createdAt).getTime() : 0;
          const tB = b.deployment?.createdAt ? new Date(b.deployment.createdAt).getTime() : 0;
          return tA - tB;
        });
        break;
      case 'updatedDesc':
        nodes.sort((a, b) => {
          const tA = a.deployment?.createdAt ? new Date(a.deployment.createdAt).getTime() : 0;
          const tB = b.deployment?.createdAt ? new Date(b.deployment.createdAt).getTime() : 0;
          return tB - tA;
        });
        break;
    }
  }

  /** Poll a single project: re-fetch deployments for all cached environments */
  private async pollProject(projectId: string): Promise<void> {
    const cached = this.projectDetailCache.get(projectId);
    if (!cached) { return; }

    try {
      let changed = false;
      const allChanges: DeploymentChange[] = [];

      for (const env of cached.environments) {
        const snapshotKey = `${projectId}:${env.id}`;
        const deployments = await Promise.all(
          cached.services.map((svc) =>
            this.apiClient.getLatestDeployment(projectId, svc.id, env.id)
          )
        );

        const serviceNodes = cached.services.map((svc, i) => {
          const deployment = deployments[i];
          if (deployment) { deployment.environmentName = env.name; }
          return new ServiceNode(svc.id, svc.name, projectId, deployment);
        });

        const oldSnapshot = this.lastDeploymentSnapshots.get(snapshotKey);
        const newSnapshot = this.buildSnapshot(serviceNodes);
        if (oldSnapshot !== newSnapshot) {
          if (oldSnapshot) {
            allChanges.push(...this.detectChanges(projectId, oldSnapshot, newSnapshot));
          }
          this.lastDeploymentSnapshots.set(snapshotKey, newSnapshot);
          changed = true;
        }

        const hasActive = serviceNodes.some(
          (n) => n.deployment && ACTIVE_DEPLOYMENT_STATUSES.has(n.deployment.status)
        );
        this.pollingManager.updateProjectStatus(snapshotKey, hasActive);
      }

      if (changed) {
        const projectNode = this.projectNodeMap.get(projectId);
        this._onDidChangeTreeData.fire(projectNode);
        this.updateActiveCount();
      }

      if (allChanges.length > 0) {
        this.notificationManager.notify(allChanges);
      }
    } catch {
      // Silently ignore polling errors
    }
  }

  private saveDeploymentSnapshot(projectId: string, serviceNodes: ServiceNode[]): void {
    this.lastDeploymentSnapshots.set(projectId, this.buildSnapshot(serviceNodes));
  }

  private buildSnapshot(serviceNodes: ServiceNode[]): string {
    const data = serviceNodes.map((n) => ({
      id: n.deployment?.id,
      status: n.deployment?.status,
      name: n.serviceName,
    }));
    return JSON.stringify(data);
  }

  private detectChanges(projectId: string, oldSnapshot: string, newSnapshot: string): DeploymentChange[] {
    const oldEntries = JSON.parse(oldSnapshot) as Array<{ id?: string; status?: string; name?: string }>;
    const newEntries = JSON.parse(newSnapshot) as Array<{ id?: string; status?: string; name?: string }>;
    const changes: DeploymentChange[] = [];

    for (let i = 0; i < newEntries.length; i++) {
      const oldStatus = oldEntries[i]?.status;
      const newStatus = newEntries[i]?.status;
      if (newStatus && oldStatus !== newStatus) {
        changes.push({
          serviceName: newEntries[i].name ?? 'Unknown',
          projectId,
          oldStatus,
          newStatus,
        });
      }
    }
    return changes;
  }

  private updateActiveCount(): void {
    let deploying = 0;
    let failed = 0;
    let success = 0;
    for (const snapshot of this.lastDeploymentSnapshots.values()) {
      const entries = JSON.parse(snapshot) as Array<{ id?: string; status?: string }>;
      for (const e of entries) {
        if (!e.status) { continue; }
        if (ACTIVE_DEPLOYMENT_STATUSES.has(e.status)) { deploying++; }
        else if (e.status === 'FAILED' || e.status === 'CRASHED') { failed++; }
        else if (e.status === 'SUCCESS') { success++; }
      }
    }
    this.updateViewDescription(deploying);
    this.statusBar.update({ deploying, failed, success });
  }

  private updateViewDescription(activeCount: number): void {
    if (!this.treeView) { return; }
    this.treeView.description = activeCount > 0
      ? `${activeCount} deploying`
      : '';
  }
}
