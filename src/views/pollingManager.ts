import type { Disposable } from 'vscode';

const TICK_INTERVAL = 5_000; // 5s check cycle

interface TrackedProject {
  workspaceId: string;
  hasActive: boolean;
  lastPollTime: number;
}

export class PollingManager implements Disposable {
  private trackedProjects = new Map<string, TrackedProject>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private isVisible = true;
  private _enabled = true;

  constructor(
    private onPollProject: (projectId: string) => void,
    private activeInterval: number,
    private idleInterval: number,
  ) {}

  start(): void {
    if (this.timer) { return; }
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  addProject(projectId: string, workspaceId: string): void {
    if (!this.trackedProjects.has(projectId)) {
      this.trackedProjects.set(projectId, {
        workspaceId,
        hasActive: false,
        lastPollTime: 0, // poll immediately on next tick
      });
    }
    if (!this.timer && this._enabled) {
      this.start();
    }
  }

  removeProject(projectId: string): void {
    this.trackedProjects.delete(projectId);
    if (this.trackedProjects.size === 0) {
      this.stop();
    }
  }

  removeProjectsByWorkspace(workspaceId: string): void {
    for (const [id, meta] of this.trackedProjects) {
      if (meta.workspaceId === workspaceId) {
        this.trackedProjects.delete(id);
      }
    }
    if (this.trackedProjects.size === 0) {
      this.stop();
    }
  }

  clearAll(): void {
    this.trackedProjects.clear();
    this.stop();
  }

  updateProjectStatus(projectId: string, hasActive: boolean): void {
    const entry = this.trackedProjects.get(projectId);
    if (entry) {
      entry.hasActive = hasActive;
    }
  }

  setViewVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible && this._enabled && this.trackedProjects.size > 0) {
      this.start();
    } else if (!visible) {
      this.stop();
    }
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (enabled && this.isVisible && this.trackedProjects.size > 0) {
      this.start();
    } else if (!enabled) {
      this.stop();
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  dispose(): void {
    this.stop();
    this.trackedProjects.clear();
  }

  private tick(): void {
    if (!this.isVisible || !this._enabled) { return; }

    const now = Date.now();
    for (const [projectId, meta] of this.trackedProjects) {
      const interval = meta.hasActive ? this.activeInterval : this.idleInterval;
      if (now - meta.lastPollTime >= interval) {
        meta.lastPollTime = now;
        this.onPollProject(projectId);
      }
    }
  }
}
