import * as vscode from 'vscode';
import { RailwayApiClient } from '../api/client';

interface VariableEditorInfo {
  serviceName: string;
  serviceId: string;
  projectId: string;
  environmentId: string;
  environmentName: string;
}

export class VariableEditorPanel {
  private static panels = new Map<string, vscode.WebviewPanel>();

  static async show(apiClient: RailwayApiClient, info: VariableEditorInfo): Promise<void> {
    const key = `vars:${info.serviceId}:${info.environmentId}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'railwayVariableEditor',
      `Env: ${info.serviceName} (${info.environmentName})`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panels.set(key, panel);
    panel.onDidDispose(() => this.panels.delete(key));

    let variables: Record<string, string> = {};
    try {
      variables = await apiClient.getVariables(info.projectId, info.environmentId, info.serviceId);
    } catch (err) {
      variables = {};
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(
        `Railway: Failed to load variables (${message}). Showing an empty list.`
      );
    }

    panel.webview.html = this.buildHtml(info, variables);

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'apply') {
        const changes = msg.changes as {
          added: Record<string, string>;
          modified: Record<string, string>;
          deleted: string[];
        };

        const summary: string[] = [];
        const addedCount = Object.keys(changes.added).length;
        const modifiedCount = Object.keys(changes.modified).length;
        const deletedCount = changes.deleted.length;

        if (addedCount > 0) { summary.push(`Add ${addedCount}`); }
        if (modifiedCount > 0) { summary.push(`Modify ${modifiedCount}`); }
        if (deletedCount > 0) { summary.push(`Delete ${deletedCount}`); }

        const confirm = await vscode.window.showWarningMessage(
          `Apply changes to ${info.serviceName} (${info.environmentName})?\n${summary.join(', ')} variable(s)`,
          { modal: true },
          'Apply'
        );

        if (confirm !== 'Apply') {
          panel.webview.postMessage({ type: 'applyResult', success: false, error: 'Cancelled' });
          return;
        }

        try {
          for (const [name, value] of Object.entries(changes.added)) {
            await apiClient.upsertVariable(info.projectId, info.environmentId, info.serviceId, name, value);
          }
          for (const [name, value] of Object.entries(changes.modified)) {
            await apiClient.upsertVariable(info.projectId, info.environmentId, info.serviceId, name, value);
          }
          for (const name of changes.deleted) {
            await apiClient.deleteVariable(info.projectId, info.environmentId, info.serviceId, name);
          }

          vscode.window.showInformationMessage(`Variables updated for ${info.serviceName}`);
          const newVars = await apiClient.getVariables(info.projectId, info.environmentId, info.serviceId);
          panel.webview.postMessage({ type: 'applyResult', success: true, variables: newVars });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          vscode.window.showErrorMessage(`Failed to update variables: ${errMsg}`);
          panel.webview.postMessage({ type: 'applyResult', success: false, error: errMsg });
        }
      } else if (msg.type === 'refresh') {
        try {
          const newVars = await apiClient.getVariables(info.projectId, info.environmentId, info.serviceId);
          panel.webview.postMessage({ type: 'refreshResult', variables: newVars });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          panel.webview.postMessage({ type: 'refreshResult', error: errMsg });
        }
      }
    });
  }

  private static buildHtml(info: VariableEditorInfo, variables: Record<string, string>): string {
    const varsJson = JSON.stringify(variables);
    const nonce = getNonce();
    const safeServiceName = esc(info.serviceName);
    const safeEnvName = esc(info.environmentName);

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; margin: 0; }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  h1 { font-size: 1.3em; margin: 0; }
  .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; font-size: 0.85em; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; border-radius: 4px; font-size: 0.9em; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.danger { background: #dc3545; color: #fff; }
  button:disabled { opacity: 0.5; cursor: default; }
  .apply-bar { position: sticky; bottom: 0; background: var(--vscode-editor-background); padding: 12px 0; border-top: 1px solid var(--vscode-widget-border); display: none; }
  .apply-bar.visible { display: flex; gap: 8px; align-items: center; }
  .changes-count { font-size: 0.85em; opacity: 0.7; }
  #varTable { width: 100%; border-collapse: collapse; }
  #varTable th, #varTable td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-widget-border); }
  #varTable th { font-weight: 600; font-size: 0.85em; opacity: 0.7; position: sticky; top: 0; background: var(--vscode-editor-background); }
  input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 8px; font-family: var(--vscode-editor-font-family); font-size: 0.9em; width: 100%; box-sizing: border-box; border-radius: 3px; }
  input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .row-new { background: rgba(40,167,69,0.1); }
  .row-modified { background: rgba(255,193,7,0.1); }
  .row-deleted { background: rgba(220,53,69,0.1); opacity: 0.5; }
  .row-deleted td { text-decoration: line-through; }
  .actions { white-space: nowrap; }
  .actions button { padding: 2px 8px; font-size: 0.8em; }
  .empty { text-align: center; padding: 40px; opacity: 0.5; }
</style>
</head><body>
<div class="header">
  <h1>${safeServiceName}</h1>
  <span class="badge">${safeEnvName}</span>
  <span class="badge">Environment Variables</span>
</div>
<div class="toolbar">
  <button id="btnAdd">+ Add Variable</button>
  <button id="btnToggleMask" class="secondary">Show Values</button>
  <button id="btnRefresh" class="secondary">Refresh</button>
</div>
<div id="tableContainer"></div>
<div id="applyBar" class="apply-bar">
  <button id="btnApply">Apply Changes</button>
  <button id="btnDiscard" class="secondary">Discard</button>
  <span class="changes-count" id="changesCount"></span>
</div>
<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  let original = ${varsJson};
  let current = JSON.parse(JSON.stringify(original));
  let newVars = {};
  let deletedSet = new Set();
  let showValues = false;

  function safeText(s) {
    const d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  }

  function render() {
    const container = document.getElementById('tableContainer');
    // Clear safely
    while (container.firstChild) container.removeChild(container.firstChild);

    const existingNames = Object.keys(current).sort();
    const newNames = Object.keys(newVars).sort();

    if (existingNames.length === 0 && newNames.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No variables. Click "+ Add Variable" to create one.';
      container.appendChild(empty);
      updateApplyBar();
      return;
    }

    const table = document.createElement('table');
    table.id = 'varTable';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Name', 'Value', 'Actions'].forEach(t => {
      const th = document.createElement('th');
      th.textContent = t;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    // Existing vars
    for (const name of existingNames) {
      const tr = document.createElement('tr');
      if (deletedSet.has(name)) {
        tr.className = 'row-deleted';
        const tdName = document.createElement('td');
        tdName.textContent = name;
        const tdVal = document.createElement('td');
        tdVal.textContent = 'deleted';
        const tdAct = document.createElement('td');
        tdAct.className = 'actions';
        const btnUndo = document.createElement('button');
        btnUndo.className = 'secondary';
        btnUndo.textContent = 'Undo';
        btnUndo.onclick = () => { deletedSet.delete(name); render(); };
        tdAct.appendChild(btnUndo);
        tr.append(tdName, tdVal, tdAct);
      } else {
        const isModified = current[name] !== original[name];
        if (isModified) tr.className = 'row-modified';

        const tdName = document.createElement('td');
        tdName.textContent = name;

        const tdVal = document.createElement('td');
        const inp = document.createElement('input');
        inp.type = showValues ? 'text' : 'password';
        inp.value = current[name];
        inp.onchange = () => { current[name] = inp.value; render(); };
        tdVal.appendChild(inp);

        const tdAct = document.createElement('td');
        tdAct.className = 'actions';
        const btnDel = document.createElement('button');
        btnDel.className = 'danger';
        btnDel.textContent = 'Delete';
        btnDel.onclick = () => { deletedSet.add(name); render(); };
        tdAct.appendChild(btnDel);

        tr.append(tdName, tdVal, tdAct);
      }
      tbody.appendChild(tr);
    }

    // New vars
    for (const name of newNames) {
      const tr = document.createElement('tr');
      tr.className = 'row-new';

      const tdName = document.createElement('td');
      const nameInp = document.createElement('input');
      nameInp.placeholder = 'VARIABLE_NAME';
      nameInp.value = name;
      nameInp.onchange = () => {
        const val = newVars[name];
        delete newVars[name];
        if (nameInp.value.trim()) newVars[nameInp.value.trim()] = val;
        render();
      };
      tdName.appendChild(nameInp);

      const tdVal = document.createElement('td');
      const valInp = document.createElement('input');
      valInp.type = showValues ? 'text' : 'password';
      valInp.value = newVars[name];
      valInp.onchange = () => { newVars[name] = valInp.value; };
      tdVal.appendChild(valInp);

      const tdAct = document.createElement('td');
      tdAct.className = 'actions';
      const btnRm = document.createElement('button');
      btnRm.className = 'danger';
      btnRm.textContent = 'Remove';
      btnRm.onclick = () => { delete newVars[name]; render(); };
      tdAct.appendChild(btnRm);

      tr.append(tdName, tdVal, tdAct);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    container.appendChild(table);
    updateApplyBar();
  }

  function updateApplyBar() {
    const addedCount = Object.keys(newVars).filter(n => n.trim()).length;
    const modifiedCount = Object.keys(current).filter(n => !deletedSet.has(n) && current[n] !== original[n]).length;
    const deletedCount = deletedSet.size;
    const total = addedCount + modifiedCount + deletedCount;
    const bar = document.getElementById('applyBar');
    const countEl = document.getElementById('changesCount');
    if (total > 0) {
      bar.classList.add('visible');
      const parts = [];
      if (addedCount) parts.push(addedCount + ' added');
      if (modifiedCount) parts.push(modifiedCount + ' modified');
      if (deletedCount) parts.push(deletedCount + ' deleted');
      countEl.textContent = parts.join(', ');
    } else {
      bar.classList.remove('visible');
    }
  }

  document.getElementById('btnAdd').onclick = () => {
    const idx = Object.keys(newVars).length + 1;
    newVars['NEW_VAR_' + idx] = '';
    render();
  };

  document.getElementById('btnToggleMask').onclick = function() {
    showValues = !showValues;
    this.textContent = showValues ? 'Hide Values' : 'Show Values';
    render();
  };

  document.getElementById('btnRefresh').onclick = () => {
    vscode.postMessage({ type: 'refresh' });
  };

  document.getElementById('btnApply').onclick = () => {
    const added = {};
    for (const [n, v] of Object.entries(newVars)) {
      if (n.trim()) added[n.trim()] = v;
    }
    const modified = {};
    for (const [n, v] of Object.entries(current)) {
      if (!deletedSet.has(n) && v !== original[n]) modified[n] = v;
    }
    vscode.postMessage({ type: 'apply', changes: { added, modified, deleted: [...deletedSet] } });
  };

  document.getElementById('btnDiscard').onclick = () => {
    current = JSON.parse(JSON.stringify(original));
    newVars = {};
    deletedSet = new Set();
    render();
  };

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if ((msg.type === 'applyResult' && msg.success) || (msg.type === 'refreshResult' && msg.variables)) {
      const vars = msg.variables;
      original = vars;
      current = JSON.parse(JSON.stringify(original));
      newVars = {};
      deletedSet = new Set();
      render();
    }
  });

  render();
})();
</script>
</body></html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
