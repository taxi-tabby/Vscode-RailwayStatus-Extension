import * as vscode from 'vscode';
import { RailwayApiClient } from '../api/client';
import { RailwayTreeDataProvider } from '../views/treeProvider';
import { VariableEditorPanel } from '../views/variableEditorPanel';
import { formatDotEnv } from '../utils/dotenv';
import { detectRailwayCli, buildSshCommand, hasUnsafeShellChars } from '../utils/railwayCli';

interface NamedItem { id: string; name: string; }
interface Target {
  projectId: string; projectName: string;
  environmentId: string; environmentName: string;
  serviceId: string; serviceName: string;
}

const RAILWAY_CLI_DOCS = 'https://docs.railway.com/guides/cli';

export class LinkedProjectService implements vscode.Disposable {
  private status: vscode.StatusBarItem;

  constructor(
    private api: RailwayApiClient,
    private tree: RailwayTreeDataProvider,
    private workspaceState: vscode.Memento,
  ) {
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    this.status.command = 'railway.linkedActions';
    this.status.name = 'Railway Linked Project';
  }

  updateStatusBar(): void {
    const linked = this.tree.getLinkedProject();
    vscode.commands.executeCommand('setContext', 'railway.hasLinkedProject', !!linked);
    if (!linked) { this.status.hide(); return; }
    this.status.text = `$(link) ${linked.name}`;
    this.status.tooltip = `Railway linked: ${linked.name}\nClick for quick actions`;
    this.status.show();
  }

  /** Unlink the project, also clearing the remembered service/environment target. */
  unlink(): void {
    const linked = this.tree.getLinkedProject();
    if (linked) {
      this.workspaceState.update(`railway.linked.env.${linked.id}`, undefined);
      this.workspaceState.update(`railway.linked.service.${linked.id}`, undefined);
    }
    this.tree.unlinkProject();
    this.updateStatusBar();
  }

  async showQuickActions(): Promise<void> {
    const linked = this.tree.getLinkedProject();
    if (!linked) {
      vscode.window.showInformationMessage('Link a project from the tree first.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      [
        { label: '$(terminal-bash) SSH into service', id: 'ssh' },
        { label: '$(symbol-variable) Edit variables', id: 'variables' },
        { label: '$(export) Export .env', id: 'export' },
        { label: '$(globe) Open dashboard', id: 'dashboard' },
        { label: '$(pinned-dirty) Change service/environment', id: 'change' },
        { label: '$(circle-slash) Unlink', id: 'unlink' },
      ],
      { title: `Railway: ${linked.name}`, placeHolder: 'Choose an action' },
    );
    if (!pick) { return; }
    switch (pick.id) {
      case 'ssh': return this.ssh();
      case 'variables': return this.openVariables();
      case 'export': return this.exportEnv();
      case 'dashboard': return this.openDashboard();
      case 'change': return this.changeTarget();
      case 'unlink':
        this.unlink();
        vscode.window.showInformationMessage('Project unlinked.');
        return;
    }
  }

  async ssh(): Promise<void> {
    if (!(await detectRailwayCli())) {
      const choice = await vscode.window.showWarningMessage(
        'The railway CLI was not found (not installed or not on PATH). Install it and try again.',
        'CLI install guide',
      );
      if (choice === 'CLI install guide') {
        vscode.env.openExternal(vscode.Uri.parse(RAILWAY_CLI_DOCS));
      }
      return;
    }
    const t = await this.resolveTarget();
    if (!t) { return; }

    // SSH requires a running instance — a sleeping/undeployed service is not reachable.
    let running: boolean;
    try {
      const dep = await this.api.getLatestDeployment(t.projectId, t.serviceId, t.environmentId);
      running = dep?.status === 'SUCCESS';
      if (!running) {
        if (!dep) {
          vscode.window.showWarningMessage(
            `No deployment found for ${t.serviceName} (${t.environmentName}). Deploy it before using SSH.`,
          );
        } else if (dep.status === 'SLEEPING') {
          vscode.window.showWarningMessage(
            `${t.serviceName} is sleeping. SSH needs a running instance — send a request to wake it, then try again.`,
          );
        } else {
          vscode.window.showWarningMessage(
            `${t.serviceName} has no running instance (status: ${dep.status}). SSH is only available while it is running.`,
          );
        }
        return;
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to check deployment status: ${msg(err)}`);
      return;
    }

    if (hasUnsafeShellChars(t.serviceName) || hasUnsafeShellChars(t.environmentName)) {
      vscode.window.showErrorMessage(
        'The service/environment name contains characters that are unsafe to pass through a shell. Run "railway ssh" directly in a terminal.',
      );
      return;
    }
    const term = vscode.window.createTerminal(`Railway SSH: ${t.serviceName}`);
    term.show();
    term.sendText(buildSshCommand({
      projectId: t.projectId, serviceName: t.serviceName, environmentName: t.environmentName,
    }));
    vscode.window.showInformationMessage(
      'SSH uses the railway CLI\'s own login (railway login). If you are not logged in, follow the prompt in the terminal.',
    );
  }

  async exportEnv(): Promise<void> {
    const t = await this.resolveTarget();
    if (!t) { return; }
    let vars: Record<string, string>;
    try {
      vars = await this.api.getVariables(t.projectId, t.environmentId, t.serviceId);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to fetch variables: ${msg(err)}`);
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('.env'),
      filters: { 'Environment files': ['env'], 'All files': ['*'] },
    });
    if (!uri) { return; }
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(formatDotEnv(vars), 'utf-8'));
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to export .env: ${msg(err)}`);
      return;
    }
    vscode.window.showInformationMessage(
      `Exported ${Object.keys(vars).length} variable(s) to ${uri.fsPath}`,
    );
  }

  async openVariables(): Promise<void> {
    const t = await this.resolveTarget();
    if (!t) { return; }
    await VariableEditorPanel.show(this.api, {
      serviceName: t.serviceName,
      serviceId: t.serviceId,
      projectId: t.projectId,
      environmentId: t.environmentId,
      environmentName: t.environmentName,
    });
  }

  async openDashboard(): Promise<void> {
    const linked = this.tree.getLinkedProject();
    if (!linked) { return; }
    const opened = await vscode.env.openExternal(
      vscode.Uri.parse(`https://railway.com/project/${linked.id}`),
    );
    if (!opened) {
      vscode.window.showErrorMessage('Failed to open the dashboard in a browser.');
    }
  }

  async changeTarget(): Promise<void> {
    const t = await this.resolveTarget(true);
    if (t) {
      vscode.window.showInformationMessage(`Target: ${t.serviceName} (${t.environmentName})`);
    }
  }

  // ─── Target resolution (service/environment QuickPick + memory) ───
  private async resolveTarget(forcePick = false): Promise<Target | undefined> {
    const linked = this.tree.getLinkedProject();
    if (!linked) {
      vscode.window.showInformationMessage('Link a project from the tree first.');
      return undefined;
    }
    let detail: { services: NamedItem[]; environments: NamedItem[] };
    try {
      detail = await this.api.getProjectDetail(linked.id);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to fetch project detail: ${msg(err)}`);
      return undefined;
    }
    const env = await this.pick('env', linked.id, detail.environments, 'Select environment', forcePick);
    if (!env) { return undefined; }
    const svc = await this.pick('service', linked.id, detail.services, 'Select service', forcePick);
    if (!svc) { return undefined; }
    return {
      projectId: linked.id, projectName: linked.name,
      environmentId: env.id, environmentName: env.name,
      serviceId: svc.id, serviceName: svc.name,
    };
  }

  private async pick(
    kind: 'env' | 'service', projectId: string, items: NamedItem[],
    placeHolder: string, forcePick: boolean,
  ): Promise<NamedItem | undefined> {
    if (items.length === 0) {
      vscode.window.showWarningMessage(
        `The linked project has no ${kind === 'env' ? 'environments' : 'services'}.`,
      );
      return undefined;
    }
    const key = `railway.linked.${kind}.${projectId}`;
    if (!forcePick) {
      const rememberedId = this.workspaceState.get<string>(key);
      const remembered = rememberedId && items.find((i) => i.id === rememberedId);
      if (remembered) { return remembered; }
      if (items.length === 1) {
        await this.workspaceState.update(key, items[0].id);
        return items[0];
      }
    }
    const chosen = await vscode.window.showQuickPick(
      items.map((i) => ({ label: i.name, item: i })),
      { title: placeHolder, placeHolder },
    );
    if (!chosen) { return undefined; }
    await this.workspaceState.update(key, chosen.item.id);
    return chosen.item;
  }

  dispose(): void {
    this.status.dispose();
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
