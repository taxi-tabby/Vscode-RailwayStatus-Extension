import * as vscode from 'vscode';
import { RailwayApiClient, type LogEntry } from '../api/client';

export class LogViewer implements vscode.Disposable {
  private channels = new Map<string, vscode.OutputChannel>();

  constructor(private apiClient: RailwayApiClient) {}

  async showLogs(serviceName: string, deploymentId: string): Promise<void> {
    const channelName = `Railway: ${serviceName}`;
    let channel = this.channels.get(channelName);
    if (!channel) {
      channel = vscode.window.createOutputChannel(channelName);
      this.channels.set(channelName, channel);
    }

    channel.clear();
    channel.show(true);
    channel.appendLine(`=== Build Logs ===\n`);

    try {
      const buildLogs = await this.apiClient.getBuildLogs(deploymentId);
      this.appendLogs(channel, buildLogs);
    } catch {
      channel.appendLine('(no build logs available)');
    }

    channel.appendLine(`\n=== Runtime Logs ===\n`);

    try {
      const deployLogs = await this.apiClient.getDeploymentLogs(deploymentId);
      this.appendLogs(channel, deployLogs);
    } catch {
      channel.appendLine('(no runtime logs available)');
    }
  }

  private appendLogs(channel: vscode.OutputChannel, logs: LogEntry[]): void {
    if (logs.length === 0) {
      channel.appendLine('(empty)');
      return;
    }
    for (const log of logs) {
      const ts = new Date(log.timestamp).toLocaleTimeString();
      const severity = log.severity ? `[${log.severity}] ` : '';
      channel.appendLine(`${ts} ${severity}${log.message}`);
    }
  }

  dispose(): void {
    for (const channel of this.channels.values()) {
      channel.dispose();
    }
    this.channels.clear();
  }
}
