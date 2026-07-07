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
    this.status.tooltip = `Railway linked: ${linked.name}\n클릭하여 빠른 작업 열기`;
    this.status.show();
  }

  /** 링크 해제: 기억된 서비스/환경 대상까지 정리한다. */
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
      vscode.window.showInformationMessage('먼저 트리에서 프로젝트를 링크하세요.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      [
        { label: '$(terminal) Railway 터미널 열기', id: 'terminal' },
        { label: '$(terminal-bash) SSH 접속', id: 'ssh' },
        { label: '$(symbol-variable) 변수 편집기', id: 'variables' },
        { label: '$(export) .env 내보내기', id: 'export' },
        { label: '$(globe) 대시보드 열기', id: 'dashboard' },
        { label: '$(pinned-dirty) 서비스/환경 변경', id: 'change' },
        { label: '$(circle-slash) 링크 해제', id: 'unlink' },
      ],
      { title: `Railway: ${linked.name}`, placeHolder: '작업 선택' },
    );
    if (!pick) { return; }
    switch (pick.id) {
      case 'terminal': return this.openTerminal();
      case 'ssh': return this.ssh();
      case 'variables': return this.openVariables();
      case 'export': return this.exportEnv();
      case 'dashboard': return this.openDashboard();
      case 'change': return this.changeTarget();
      case 'unlink':
        this.unlink();
        vscode.window.showInformationMessage('프로젝트 링크를 해제했습니다.');
        return;
    }
  }

  async openTerminal(): Promise<void> {
    const t = await this.resolveTarget();
    if (!t) { return; }
    let vars: Record<string, string>;
    try {
      vars = await this.api.getVariables(t.projectId, t.environmentId, t.serviceId);
    } catch (err) {
      vscode.window.showErrorMessage(`변수 조회 실패: ${msg(err)}`);
      return;
    }
    const term = vscode.window.createTerminal({
      name: `Railway ${t.serviceName} (${t.environmentName})`,
      env: vars,
    });
    term.show();
    const count = Object.keys(vars).length;
    if (count === 0) {
      vscode.window.showWarningMessage(
        `${t.serviceName} (${t.environmentName})에 주입할 변수가 없습니다. 서비스/환경 선택이 맞는지 확인하세요.`,
      );
    } else {
      vscode.window.showInformationMessage(`Railway 변수 ${count}개를 주입한 터미널을 열었습니다.`);
    }
  }

  async ssh(): Promise<void> {
    if (!(await detectRailwayCli())) {
      const choice = await vscode.window.showWarningMessage(
        'railway CLI를 찾지 못했습니다(미설치이거나 PATH에 없음). 설치 후 다시 시도하세요.',
        'CLI 설치 가이드',
      );
      if (choice === 'CLI 설치 가이드') {
        vscode.env.openExternal(vscode.Uri.parse(RAILWAY_CLI_DOCS));
      }
      return;
    }
    const t = await this.resolveTarget();
    if (!t) { return; }
    if (hasUnsafeShellChars(t.serviceName) || hasUnsafeShellChars(t.environmentName)) {
      vscode.window.showErrorMessage(
        '서비스/환경 이름에 셸에서 안전하지 않은 문자가 있어 SSH 명령을 자동 구성할 수 없습니다. 터미널에서 직접 railway ssh를 실행하세요.',
      );
      return;
    }
    const term = vscode.window.createTerminal(`Railway SSH: ${t.serviceName}`);
    term.show();
    term.sendText(buildSshCommand({
      projectId: t.projectId, serviceName: t.serviceName, environmentName: t.environmentName,
    }));
    vscode.window.showInformationMessage(
      'SSH는 railway CLI 자체 로그인(railway login)을 사용합니다. 미로그인 시 터미널 안내를 따르세요.',
    );
  }

  async exportEnv(): Promise<void> {
    const t = await this.resolveTarget();
    if (!t) { return; }
    let vars: Record<string, string>;
    try {
      vars = await this.api.getVariables(t.projectId, t.environmentId, t.serviceId);
    } catch (err) {
      vscode.window.showErrorMessage(`변수 조회 실패: ${msg(err)}`);
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
      vscode.window.showErrorMessage(`.env 내보내기 실패: ${msg(err)}`);
      return;
    }
    vscode.window.showInformationMessage(
      `${Object.keys(vars).length}개 변수를 ${uri.fsPath} 에 내보냈습니다.`,
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
      vscode.window.showErrorMessage('대시보드를 브라우저에서 열지 못했습니다.');
    }
  }

  async changeTarget(): Promise<void> {
    const t = await this.resolveTarget(true);
    if (t) {
      vscode.window.showInformationMessage(`대상: ${t.serviceName} (${t.environmentName})`);
    }
  }

  // ─── target 해소 (서비스/환경 QuickPick + 기억) ───
  private async resolveTarget(forcePick = false): Promise<Target | undefined> {
    const linked = this.tree.getLinkedProject();
    if (!linked) {
      vscode.window.showInformationMessage('먼저 트리에서 프로젝트를 링크하세요.');
      return undefined;
    }
    let detail: { services: NamedItem[]; environments: NamedItem[] };
    try {
      detail = await this.api.getProjectDetail(linked.id);
    } catch (err) {
      vscode.window.showErrorMessage(`프로젝트 정보 조회 실패: ${msg(err)}`);
      return undefined;
    }
    const env = await this.pick('env', linked.id, detail.environments, '환경 선택', forcePick);
    if (!env) { return undefined; }
    const svc = await this.pick('service', linked.id, detail.services, '서비스 선택', forcePick);
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
        `링크된 프로젝트에 ${kind === 'env' ? '환경' : '서비스'}이(가) 없습니다.`,
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
