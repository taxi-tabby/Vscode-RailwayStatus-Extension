import * as vscode from 'vscode';
import { RailwayApiClient } from '../api/client';
import type { RailwayDeployment } from '../types';
import { STATUS_ICONS } from '../constants';

interface ServiceInfo {
  serviceName: string;
  serviceId: string;
  projectId: string;
  environmentId: string;
  environmentName: string;
}

export class ServiceDetailPanel {
  private static panels = new Map<string, vscode.WebviewPanel>();

  static async show(
    extensionUri: vscode.Uri,
    apiClient: RailwayApiClient,
    info: ServiceInfo
  ): Promise<void> {
    const key = `${info.serviceId}:${info.environmentId}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'railwayServiceDetail',
      `${info.serviceName} - ${info.environmentName}`,
      vscode.ViewColumn.One,
      { enableScripts: false }
    );

    this.panels.set(key, panel);
    panel.onDidDispose(() => this.panels.delete(key));

    panel.webview.html = this.buildLoadingHtml();

    try {
      const [history, variables] = await Promise.all([
        apiClient.getDeploymentHistory(info.projectId, info.serviceId, info.environmentId),
        apiClient.getVariables(info.projectId, info.environmentId, info.serviceId).catch(() => ({} as Record<string, string>)),
      ]);

      panel.webview.html = this.buildHtml(info, history, variables);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      panel.webview.html = this.buildErrorHtml(msg);
    }
  }

  private static buildLoadingHtml(): string {
    return this.wrapHtml('<div class="loading">Loading service details...</div>');
  }

  private static buildErrorHtml(message: string): string {
    return this.wrapHtml(`<div class="error">Failed to load: ${this.escapeHtml(message)}</div>`);
  }

  private static buildHtml(
    info: ServiceInfo,
    history: RailwayDeployment[],
    variables: Record<string, string>
  ): string {
    const dashboardUrl = `https://railway.com/project/${info.projectId}`;

    const historyRows = history.map((d) => {
      const date = new Date(d.createdAt).toLocaleString();
      const statusClass = d.status === 'SUCCESS' ? 'success' : d.status === 'FAILED' || d.status === 'CRASHED' ? 'failed' : 'other';
      return `<tr>
        <td><span class="status ${statusClass}">${this.escapeHtml(d.status)}</span></td>
        <td>${this.escapeHtml(date)}</td>
        <td class="mono">${this.escapeHtml(d.id.substring(0, 8))}</td>
      </tr>`;
    }).join('');

    const varNames = Object.keys(variables).sort();
    const varRows = varNames.map((name) => {
      return `<tr>
        <td class="mono">${this.escapeHtml(name)}</td>
        <td class="mono masked">••••••••</td>
      </tr>`;
    }).join('');

    const content = `
      <div class="header">
        <h1>${this.escapeHtml(info.serviceName)}</h1>
        <span class="env-badge">${this.escapeHtml(info.environmentName)}</span>
        <a class="link" href="${dashboardUrl}">Open Dashboard</a>
      </div>

      <section>
        <h2>Deployment History</h2>
        ${history.length === 0 ? '<p class="empty">No deployments yet</p>' : `
        <table>
          <thead><tr><th>Status</th><th>Date</th><th>ID</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>`}
      </section>

      <section>
        <h2>Environment Variables</h2>
        ${varNames.length === 0 ? '<p class="empty">No variables configured</p>' : `
        <table>
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody>${varRows}</tbody>
        </table>`}
      </section>
    `;

    return this.wrapHtml(content);
  }

  private static wrapHtml(body: string): string {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; margin: 0; }
  h1 { font-size: 1.5em; margin: 0; display: inline-block; }
  h2 { font-size: 1.1em; margin: 1.5em 0 0.5em; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
  .header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .env-badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; font-size: 0.85em; }
  .link { color: var(--vscode-textLink-foreground); font-size: 0.85em; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border); }
  th { font-weight: 600; font-size: 0.85em; opacity: 0.7; }
  .mono { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  .masked { opacity: 0.5; }
  .status { padding: 2px 6px; border-radius: 4px; font-size: 0.85em; font-weight: 600; }
  .status.success { background: rgba(40,167,69,0.2); color: #28a745; }
  .status.failed { background: rgba(220,53,69,0.2); color: #dc3545; }
  .status.other { background: rgba(255,193,7,0.2); color: #ffc107; }
  .empty { opacity: 0.5; font-style: italic; }
  .loading { display: flex; justify-content: center; align-items: center; height: 200px; opacity: 0.5; }
  .error { color: var(--vscode-errorForeground); padding: 20px; }
</style>
</head><body>${body}</body></html>`;
  }

  private static escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
