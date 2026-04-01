import * as vscode from 'vscode';

export class RailwayStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = 'railwayStatus.focus';
    this.item.name = 'Railway Status';
  }

  update(counts: { deploying: number; failed: number; success: number }): void {
    const parts: string[] = ['$(rocket) Railway:'];

    if (counts.deploying > 0) {
      parts.push(`${counts.deploying} deploying`);
    }
    if (counts.failed > 0) {
      parts.push(`${counts.failed} failed`);
    }

    if (counts.deploying === 0 && counts.failed === 0) {
      if (counts.success > 0) {
        parts.push(`${counts.success} running`);
      } else {
        this.item.hide();
        return;
      }
    }

    this.item.text = parts.join(' ');
    this.item.tooltip = `Railway: ${counts.success} running, ${counts.deploying} deploying, ${counts.failed} failed`;

    if (counts.failed > 0) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (counts.deploying > 0) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.backgroundColor = undefined;
    }

    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}
