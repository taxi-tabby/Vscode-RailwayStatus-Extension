import * as vscode from 'vscode';
import { RailwayAuthProvider } from './auth/railwayAuth';
import { TokenStore } from './auth/tokenStore';
import { RailwayApiClient } from './api/client';
import { RailwayTreeDataProvider, type SortMode } from './views/treeProvider';
import { ProjectNode, WorkspaceNode } from './views/nodes';

export async function activate(context: vscode.ExtensionContext) {
  const tokenStore = new TokenStore(context.secrets);
  const authProvider = new RailwayAuthProvider(context, tokenStore);

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

  const treeProvider = new RailwayTreeDataProvider(apiClient);
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
    treeProvider.pollingManager,

    vscode.commands.registerCommand('railway.login', async () => {
      try {
        await vscode.authentication.getSession('railway', [], { createIfNone: true });
        await vscode.commands.executeCommand('setContext', 'railway.authenticated', true);
        treeProvider.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        vscode.window.showErrorMessage(`Railway sign-in failed: ${message}`);
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

    vscode.commands.registerCommand('railway.logout', async () => {
      await tokenStore.clearAll();
      await vscode.commands.executeCommand('setContext', 'railway.authenticated', false);
      treeProvider.refresh();
      vscode.window.showInformationMessage('Signed out of Railway');
    })
  );
}

export function deactivate() {}
