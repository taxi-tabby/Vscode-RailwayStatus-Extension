import * as vscode from 'vscode';
import { STATUS_ICONS } from '../constants';
import { formatRelativeTime } from '../utils/timeFormat';
import type { RailwayDeployment } from '../types';

export type RailwayNode = WorkspaceNode | ProjectNode | ServiceNode;

export class WorkspaceNode extends vscode.TreeItem {
  readonly type = 'workspace' as const;

  constructor(
    public readonly workspaceId: string,
    public readonly workspaceName: string
  ) {
    super(workspaceName, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'railwayWorkspace';
  }
}

export class ProjectNode extends vscode.TreeItem {
  readonly type = 'project' as const;

  constructor(
    public readonly projectId: string,
    public readonly projectName: string,
    public readonly workspaceId: string,
    serviceCount?: number
  ) {
    super(projectName, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('package');
    this.contextValue = 'railwayProject';
    if (serviceCount !== undefined) {
      this.description = `${serviceCount} service${serviceCount !== 1 ? 's' : ''}`;
    }
  }
}

export class ServiceNode extends vscode.TreeItem {
  readonly type = 'service' as const;

  constructor(
    public readonly serviceId: string,
    public readonly serviceName: string,
    public readonly projectId: string,
    public readonly deployment?: RailwayDeployment
  ) {
    super(serviceName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'railwayService';

    if (deployment) {
      const status = deployment.status;
      const iconId = STATUS_ICONS[status] ?? 'question';
      this.iconPath = new vscode.ThemeIcon(iconId);

      const parts: string[] = [];
      parts.push(formatRelativeTime(deployment.createdAt));
      if (deployment.environmentName) {
        parts.push(deployment.environmentName);
      }
      this.description = parts.join(' \u2022 ');

      const tooltipLines = [`Status: ${status}`];
      if (deployment.url) {
        tooltipLines.push(`URL: ${deployment.url}`);
      }
      tooltipLines.push(`Deployed: ${new Date(deployment.createdAt).toLocaleString()}`);
      if (deployment.environmentName) {
        tooltipLines.push(`Environment: ${deployment.environmentName}`);
      }
      this.tooltip = tooltipLines.join('\n');
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-outline');
      this.description = 'No deployments';
    }
  }
}
