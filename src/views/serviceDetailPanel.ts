import * as vscode from 'vscode';
import { RailwayApiClient } from '../api/client';
import type { RailwayDeployment } from '../types';

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
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panels.set(key, panel);
    panel.onDidDispose(() => this.panels.delete(key));

    // Load and render
    await this.loadAndRender(panel, apiClient, info);

    // Handle messages
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'redeploy') {
        const deploymentId = msg.deploymentId;
        const confirm = await vscode.window.showWarningMessage(
          `Redeploy "${info.serviceName}"?`, { modal: true }, 'Redeploy'
        );
        if (confirm === 'Redeploy') {
          try {
            await apiClient.redeployDeployment(deploymentId);
            vscode.window.showInformationMessage(`Redeploying ${info.serviceName}...`);
            // Reload after short delay
            setTimeout(() => this.loadAndRender(panel, apiClient, info), 2000);
          } catch (err) {
            vscode.window.showErrorMessage(`Redeploy failed: ${err instanceof Error ? err.message : 'Unknown'}`);
          }
        }
      } else if (msg.type === 'restart') {
        const deploymentId = msg.deploymentId;
        const confirm = await vscode.window.showWarningMessage(
          `Restart "${info.serviceName}"?`, { modal: true }, 'Restart'
        );
        if (confirm === 'Restart') {
          try {
            await apiClient.restartDeployment(deploymentId);
            vscode.window.showInformationMessage(`Restarting ${info.serviceName}...`);
            setTimeout(() => this.loadAndRender(panel, apiClient, info), 2000);
          } catch (err) {
            vscode.window.showErrorMessage(`Restart failed: ${err instanceof Error ? err.message : 'Unknown'}`);
          }
        }
      } else if (msg.type === 'viewLogs') {
        await vscode.commands.executeCommand('railway.viewLogs', {
          serviceName: info.serviceName,
          deployment: { id: msg.deploymentId },
        });
      } else if (msg.type === 'editVariables') {
        await vscode.commands.executeCommand('railway.viewVariables', {
          serviceId: info.serviceId,
          serviceName: info.serviceName,
          projectId: info.projectId,
          deployment: { environmentId: info.environmentId, environmentName: info.environmentName },
        });
      } else if (msg.type === 'refresh') {
        await this.loadAndRender(panel, apiClient, info);
      } else if (msg.type === 'openDashboard') {
        vscode.env.openExternal(vscode.Uri.parse(`https://railway.com/project/${info.projectId}`));
      }
    });
  }

  private static async loadAndRender(
    panel: vscode.WebviewPanel,
    apiClient: RailwayApiClient,
    info: ServiceInfo
  ): Promise<void> {
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

  private static buildErrorHtml(message: string): string {
    return this.wrapHtml(`<div class="error">Failed to load: ${esc(message)}</div>`, '');
  }

  private static buildHtml(
    info: ServiceInfo,
    history: RailwayDeployment[],
    variables: Record<string, string>
  ): string {
    const nonce = getNonce();
    const latestId = history[0]?.id ?? '';
    const latestStatus = history[0]?.status ?? '';
    const varCount = Object.keys(variables).length;

    const body = `
<div class="header">
  <h1>${esc(info.serviceName)}</h1>
  <span class="badge">${esc(info.environmentName)}</span>
</div>

<div class="toolbar">
  <button onclick="action('redeploy','${esc(latestId)}')" ${latestId ? '' : 'disabled'}>Redeploy</button>
  <button onclick="action('restart','${esc(latestId)}')" ${latestId ? '' : 'disabled'}>Restart</button>
  <button onclick="action('viewLogs','${esc(latestId)}')" ${latestId ? '' : 'disabled'}>View Logs</button>
  <button class="secondary" onclick="post('editVariables')">Edit Variables (${varCount})</button>
  <button class="secondary" onclick="post('openDashboard')">Open Dashboard</button>
  <button class="secondary" onclick="post('refresh')">Refresh</button>
</div>

${latestStatus ? `<div class="current-status">Current: <span class="status ${statusClass(latestStatus)}">${esc(latestStatus)}</span></div>` : ''}

<section>
  <h2>Deployment History</h2>
  ${history.length === 0 ? '<p class="empty">No deployments yet</p>' : ''}
</section>
<div id="historyContainer"></div>

<section>
  <h2>Environment Variables (${varCount})</h2>
  <p class="hint">Click "Edit Variables" to add, modify, or delete variables.</p>
</section>
<div id="varContainer"></div>
`;

    const historyJson = JSON.stringify(history.map(d => ({
      id: d.id,
      status: d.status,
      createdAt: d.createdAt,
    })));
    const varNamesJson = JSON.stringify(Object.keys(variables).sort());

    const script = `
<script nonce="${nonce}">
  function post(type) {
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type });
  }
  function action(type, deploymentId) {
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type, deploymentId });
  }

  (function() {
    const history = ${historyJson};
    const varNames = ${varNamesJson};

    // Render history with DOM APIs
    const hc = document.getElementById('historyContainer');
    if (history.length > 0) {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      ['Status', 'Date', 'ID', 'Actions'].forEach(t => {
        const th = document.createElement('th');
        th.textContent = t;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const d of history) {
        const tr = document.createElement('tr');

        const tdStatus = document.createElement('td');
        const statusSpan = document.createElement('span');
        statusSpan.className = 'status ' + getStatusClass(d.status);
        statusSpan.textContent = d.status;
        tdStatus.appendChild(statusSpan);

        const tdDate = document.createElement('td');
        tdDate.textContent = new Date(d.createdAt).toLocaleString();

        const tdId = document.createElement('td');
        tdId.className = 'mono';
        tdId.textContent = d.id.substring(0, 8);

        const tdAct = document.createElement('td');
        tdAct.className = 'actions';
        const btnLogs = document.createElement('button');
        btnLogs.className = 'small secondary';
        btnLogs.textContent = 'Logs';
        btnLogs.onclick = () => action('viewLogs', d.id);
        const btnRedeploy = document.createElement('button');
        btnRedeploy.className = 'small';
        btnRedeploy.textContent = 'Redeploy';
        btnRedeploy.onclick = () => action('redeploy', d.id);
        tdAct.append(btnLogs, btnRedeploy);

        tr.append(tdStatus, tdDate, tdId, tdAct);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      hc.appendChild(table);
    }

    // Render var names
    const vc = document.getElementById('varContainer');
    if (varNames.length > 0) {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      ['Name', 'Value'].forEach(t => {
        const th = document.createElement('th');
        th.textContent = t;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const name of varNames) {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.className = 'mono';
        tdName.textContent = name;
        const tdVal = document.createElement('td');
        tdVal.className = 'mono masked';
        tdVal.textContent = String.fromCodePoint(0x2022).repeat(8);
        tr.append(tdName, tdVal);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      vc.appendChild(table);
    } else {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'No variables configured';
      vc.appendChild(p);
    }

    function getStatusClass(s) {
      if (s === 'SUCCESS') return 'success';
      if (s === 'FAILED' || s === 'CRASHED') return 'failed';
      return 'other';
    }
  })();
</script>`;

    return this.wrapHtml(body, script);
  }

  private static wrapHtml(body: string, script: string): string {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; margin: 0; }
  h1 { font-size: 1.5em; margin: 0; display: inline-block; }
  h2 { font-size: 1.1em; margin: 1.5em 0 0.5em; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
  .header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; font-size: 0.85em; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; border-radius: 4px; font-size: 0.9em; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.small { padding: 2px 8px; font-size: 0.8em; }
  button:disabled { opacity: 0.4; cursor: default; }
  .current-status { margin-bottom: 12px; font-size: 0.95em; }
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
  .hint { opacity: 0.5; font-size: 0.85em; margin: 0; }
  .error { color: var(--vscode-errorForeground); padding: 20px; }
  .actions { white-space: nowrap; display: flex; gap: 4px; }
</style>
</head><body>${body}${script}</body></html>`;
  }
}

function statusClass(s: string): string {
  if (s === 'SUCCESS') return 'success';
  if (s === 'FAILED' || s === 'CRASHED') return 'failed';
  return 'other';
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
