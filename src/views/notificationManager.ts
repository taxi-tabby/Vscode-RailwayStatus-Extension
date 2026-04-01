import * as vscode from 'vscode';

export interface DeploymentChange {
  serviceName: string;
  projectId: string;
  oldStatus?: string;
  newStatus: string;
}

export class NotificationManager {
  private get enabled(): boolean {
    return vscode.workspace.getConfiguration('railway').get<boolean>('notifications', true);
  }

  notify(changes: DeploymentChange[]): void {
    if (!this.enabled) { return; }

    for (const change of changes) {
      if (change.newStatus === 'SUCCESS' && change.oldStatus && change.oldStatus !== 'SUCCESS') {
        vscode.window.showInformationMessage(
          `Railway: ${change.serviceName} deployed successfully`
        );
      } else if (change.newStatus === 'FAILED' || change.newStatus === 'CRASHED') {
        vscode.window
          .showErrorMessage(
            `Railway: ${change.serviceName} ${change.newStatus.toLowerCase()}`,
            'Open in Browser'
          )
          .then((choice) => {
            if (choice === 'Open in Browser') {
              vscode.env.openExternal(
                vscode.Uri.parse(`https://railway.com/project/${change.projectId}`)
              );
            }
          });
      }
    }
  }
}
