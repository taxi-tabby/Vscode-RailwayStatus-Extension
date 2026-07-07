import { spawn } from 'node:child_process';

/**
 * The command string is sendText'd into whatever interactive shell the terminal uses
 * (Windows PowerShell/cmd, POSIX sh). Escaping rules differ per shell, so reject
 * characters that cannot be quoted safely across all of them.
 * (e.g. PowerShell expands `$`/backtick inside double quotes and does not support `\"`.)
 */
export function hasUnsafeShellChars(s: string): boolean {
  return /["`$\r\n]/.test(s);
}

/**
 * Wrap names in double quotes only (slug-like names, including spaces, work in
 * PowerShell, cmd and sh). Callers must pass names already filtered by hasUnsafeShellChars.
 */
export function buildSshCommand(t: {
  projectId: string; serviceName: string; environmentName: string;
}): string {
  return `railway ssh --project ${t.projectId} --service "${t.serviceName}" --environment "${t.environmentName}"`;
}

/** Whether the railway CLI is on PATH (`railway --version`). */
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
