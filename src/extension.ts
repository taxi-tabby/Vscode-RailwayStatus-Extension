import * as vscode from 'vscode';
import { RailwayAuthProvider } from './auth/railwayAuth';
import { TokenStore } from './auth/tokenStore';
import { SessionManager } from './auth/sessionManager';
import { DeviceAuthCancelled, describeDeviceAuthError } from './auth/deviceFlow';
import { RailwayApiClient } from './api/client';
import { RailwayTreeDataProvider, type SortMode } from './views/treeProvider';
import { ProjectNode, EnvironmentNode, WorkspaceNode } from './views/nodes';
import { LogViewer } from './views/logViewer';
import { ServiceDetailPanel } from './views/serviceDetailPanel';
import { ServiceNode } from './views/nodes';
import { VariableEditorPanel } from './views/variableEditorPanel';

export async function activate(context: vscode.ExtensionContext) {
  const tokenStore = new TokenStore(context.secrets);
  const sessionManager = new SessionManager(tokenStore);
  const authProvider = new RailwayAuthProvider(context, tokenStore, sessionManager);

  const apiClient = new RailwayApiClient({
    getAccessToken: () => tokenStore.getAccessToken(),
    getApiToken: () => tokenStore.getApiToken(),
    onAuthFailure: () => {
      vscode.commands.executeCommand('setContext', 'railway.authenticated', false);
      vscode.window
        .showWarningMessage('Railway session expired. Please sign in again.', 'Sign In')
        .then((choice) => {
          if (choice === 'Sign In') {
            vscode.commands.executeCommand('railway.login');
          }
        });
    },
  });

  const logViewer = new LogViewer(apiClient);
  const treeProvider = new RailwayTreeDataProvider(apiClient);
  treeProvider.initState(context.globalState, context.workspaceState);

  const treeView = vscode.window.createTreeView('railwayStatus', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  treeProvider.setTreeView(treeView);

  // Check if already authenticated
  const hasToken = await tokenStore.hasAnyToken();
  await vscode.commands.executeCommand('setContext', 'railway.authenticated', hasToken);
  if (hasToken) {
    treeProvider.refresh();
  }

  // Auto-refresh defaults to enabled
  const autoRefreshDefault = vscode.workspace.getConfiguration('railway').get<boolean>('autoRefresh', true);
  treeProvider.pollingManager.setEnabled(autoRefreshDefault);
  await vscode.commands.executeCommand('setContext', 'railway.autoRefreshEnabled', autoRefreshDefault);

  // TreeView event listeners for polling
  treeView.onDidExpandElement((e) => {
    if (e.element instanceof ProjectNode) {
      treeProvider.pollingManager.addProject(e.element.projectId, e.element.workspaceId);
    }
  });

  treeView.onDidCollapseElement((e) => {
    if (e.element instanceof ProjectNode) {
      treeProvider.pollingManager.removeProject(e.element.projectId);
    }
    if (e.element instanceof EnvironmentNode) {
      treeProvider.pollingManager.removeProject(`${e.element.projectId}:${e.element.environmentId}`);
    }
    if (e.element instanceof WorkspaceNode) {
      treeProvider.pollingManager.removeProjectsByWorkspace(e.element.workspaceId);
    }
  });

  treeView.onDidChangeVisibility((e) => {
    treeProvider.pollingManager.setViewVisible(e.visible);
  });

  // Register commands
  context.subscriptions.push(
    treeView,
    authProvider,
    logViewer,
    treeProvider.pollingManager,
    treeProvider.statusBar,

    vscode.commands.registerCommand('railway.login', async () => {
      try {
        await vscode.authentication.getSession('railway', [], { createIfNone: true });
        await vscode.commands.executeCommand('setContext', 'railway.authenticated', true);
        treeProvider.refresh();
      } catch (err) {
        if (err instanceof DeviceAuthCancelled) { return; }
        vscode.window.showErrorMessage(`Railway 로그인 실패: ${describeDeviceAuthError(err)}`);
      }
    }),

    vscode.commands.registerCommand('railway.loginWithToken', async () => {
      await authProvider.loginWithToken();
      const hasToken = await tokenStore.hasAnyToken();
      if (hasToken) {
        await vscode.commands.executeCommand('setContext', 'railway.authenticated', true);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('railway.refresh', () => {
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('railway.openInBrowser', (node) => {
      if (node?.projectId) {
        const url = `https://railway.com/project/${node.projectId}`;
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),

    vscode.commands.registerCommand('railway.copyUrl', (node) => {
      if (node?.deployment?.url) {
        vscode.env.clipboard.writeText(node.deployment.url);
        vscode.window.showInformationMessage('Service URL copied to clipboard');
      } else {
        vscode.window.showWarningMessage('No URL available for this service');
      }
    }),

    vscode.commands.registerCommand('railway.sortBy', async () => {
      const options: Array<{ label: string; description: string; mode: SortMode }> = [
        { label: '$(list-ordered) Name', description: 'Sort alphabetically A → Z', mode: 'name' },
        { label: '$(history) Created (oldest first)', description: 'Sort by creation date, oldest first', mode: 'createdAsc' },
        { label: '$(clock) Updated (newest first)', description: 'Sort by last update, newest first', mode: 'updatedDesc' },
      ];
      const picked = await vscode.window.showQuickPick(options, {
        placeHolder: 'Sort projects and services by...',
      });
      if (picked) {
        treeProvider.setSortMode(picked.mode);
      }
    }),

    vscode.commands.registerCommand('railway.enableAutoRefresh', async () => {
      treeProvider.pollingManager.setEnabled(true);
      await vscode.commands.executeCommand('setContext', 'railway.autoRefreshEnabled', true);
    }),

    vscode.commands.registerCommand('railway.disableAutoRefresh', async () => {
      treeProvider.pollingManager.setEnabled(false);
      await vscode.commands.executeCommand('setContext', 'railway.autoRefreshEnabled', false);
    }),

    vscode.commands.registerCommand('railway.serviceDetail', async (node) => {
      if (!node?.serviceId || !node?.deployment?.environmentId) {
        return;
      }
      await ServiceDetailPanel.show(context.extensionUri, apiClient, {
        serviceName: node.serviceName,
        serviceId: node.serviceId,
        projectId: node.projectId,
        environmentId: node.deployment.environmentId,
        environmentName: node.deployment.environmentName ?? 'Unknown',
      });
    }),

    vscode.commands.registerCommand('railway.viewLogs', async (node) => {
      if (!node?.deployment?.id) {
        vscode.window.showWarningMessage('No deployment logs available');
        return;
      }
      await logViewer.showLogs(node.serviceName, node.deployment.id);
    }),

    vscode.commands.registerCommand('railway.redeploy', async (node) => {
      if (!node?.deployment?.id) {
        vscode.window.showWarningMessage('No deployment to redeploy');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Redeploy "${node.serviceName}"?`, { modal: true }, 'Redeploy'
      );
      if (confirm === 'Redeploy') {
        try {
          await apiClient.redeployDeployment(node.deployment.id);
          vscode.window.showInformationMessage(`Redeploying ${node.serviceName}...`);
          treeProvider.refresh();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          vscode.window.showErrorMessage(`Redeploy failed: ${msg}`);
        }
      }
    }),

    vscode.commands.registerCommand('railway.restart', async (node) => {
      if (!node?.deployment?.id) {
        vscode.window.showWarningMessage('No deployment to restart');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Restart "${node.serviceName}"?`, { modal: true }, 'Restart'
      );
      if (confirm === 'Restart') {
        try {
          await apiClient.restartDeployment(node.deployment.id);
          vscode.window.showInformationMessage(`Restarting ${node.serviceName}...`);
          treeProvider.refresh();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          vscode.window.showErrorMessage(`Restart failed: ${msg}`);
        }
      }
    }),

    vscode.commands.registerCommand('railway.viewVariables', async (node) => {
      if (!node?.serviceId || !node?.deployment?.environmentId) {
        vscode.window.showWarningMessage('Select a service with a deployment to manage variables');
        return;
      }
      await VariableEditorPanel.show(apiClient, {
        serviceName: node.serviceName,
        serviceId: node.serviceId,
        projectId: node.projectId,
        environmentId: node.deployment.environmentId,
        environmentName: node.deployment.environmentName ?? 'Unknown',
      });
    }),

    vscode.commands.registerCommand('railway.exportEnv', async (node) => {
      if (!node?.serviceId || !node?.deployment?.environmentId) {
        vscode.window.showWarningMessage('Select a service with a deployment');
        return;
      }
      try {
        const vars = await apiClient.getVariables(node.projectId, node.deployment.environmentId, node.serviceId);
        const content = Object.entries(vars).sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`).join('\n');
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file('.env'),
          filters: { 'Environment files': ['env'], 'All files': ['*'] },
        });
        if (uri) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
          vscode.window.showInformationMessage(`Exported ${Object.keys(vars).length} variables to ${uri.fsPath}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to export variables: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('railway.linkProject', async (node) => {
      if (node?.projectId) {
        treeProvider.linkProject(node.projectId);
        vscode.window.showInformationMessage(`Linked to project "${node.projectName}"`);
      }
    }),

    vscode.commands.registerCommand('railway.unlinkProject', async () => {
      treeProvider.unlinkProject();
      vscode.window.showInformationMessage('Project unlinked');
    }),

    vscode.commands.registerCommand('railway.logout', async () => {
      await tokenStore.clearAll();
      await vscode.commands.executeCommand('setContext', 'railway.authenticated', false);
      treeProvider.refresh();
      vscode.window.showInformationMessage('Signed out of Railway');
    })
  );
}

export function deactivate() {}
