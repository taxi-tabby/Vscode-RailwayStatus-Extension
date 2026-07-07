import { spawn } from 'node:child_process';

/**
 * 명령 문자열이 임의의 대화형 셸(Windows PowerShell/cmd, POSIX sh)로 sendText 되므로,
 * 셸마다 이스케이프 규칙이 달라 안전하게 인용할 수 없는 문자를 사전에 차단한다.
 * (예: PowerShell은 큰따옴표 안에서 `$`/백틱을 확장하고, `\"` 이스케이프를 지원하지 않음)
 */
export function hasUnsafeShellChars(s: string): boolean {
  return /["`$\r\n]/.test(s);
}

/**
 * 이름은 큰따옴표로만 감싼다(공백 포함 slug형 이름은 PowerShell·cmd·sh 모두에서 동작).
 * 호출측에서 hasUnsafeShellChars로 걸러진 안전한 이름이라고 가정한다.
 */
export function buildSshCommand(t: {
  projectId: string; serviceName: string; environmentName: string;
}): string {
  return `railway ssh --project ${t.projectId} --service "${t.serviceName}" --environment "${t.environmentName}"`;
}

/** railway CLI가 PATH에 있는지 (`railway --version`) */
export function detectRailwayCli(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn('railway', ['--version'], { shell: true, stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}
