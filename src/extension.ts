import * as vscode from 'vscode';
import { RailwayAuthProvider } from './auth/railwayAuth';
import { TokenStore } from './auth/tokenStore';
import { RailwayApiClient } from './api/client';
import { RailwayTreeDataProvider } from './views/treeProvider';

export async function activate(context: vscode.ExtensionContext) {
  const tokenStore = new TokenStore(context.secrets);
  const authProvider = new RailwayAuthProvider(context, tokenStore);

  const clientId = vscode.workspace
    .getConfiguration('railwayStatus')
    .get<string>('oauthClientId');

  const apiClient = new RailwayApiClient({
    getAccessToken: () => tokenStore.getAccessToken(),
    getApiToken: () => tokenStore.getApiToken(),
    getRefreshToken: () => tokenStore.getRefreshToken(),
    storeToken: (key, value) => tokenStore.storeToken(key, value),
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
    clientId,
  });

  const treeProvider = new RailwayTreeDataProvider(apiClient);
  const treeView = vscode.window.createTreeView('railwayStatus', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Check if already authenticated
  const hasToken = await tokenStore.hasAnyToken();
  await vscode.commands.executeCommand('setContext', 'railway.authenticated', hasToken);
  if (hasToken) {
    treeProvider.refresh();
  }

  // Register commands
  context.subscriptions.push(
    treeView,
    authProvider,

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

    vscode.commands.registerCommand('railway.logout', async () => {
      await tokenStore.clearAll();
      await vscode.commands.executeCommand('setContext', 'railway.authenticated', false);
      treeProvider.refresh();
      vscode.window.showInformationMessage('Signed out of Railway');
    })
  );
}

export function deactivate() {}
