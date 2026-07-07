import { spawn } from 'node:child_process';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export function buildSshCommand(t: {
  projectId: string; serviceName: string; environmentName: string;
}): string {
  return `railway ssh --project ${t.projectId} --service ${q(t.serviceName)} --environment ${q(t.environmentName)}`;
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
