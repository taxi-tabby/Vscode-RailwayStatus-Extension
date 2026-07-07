import { describe, it, expect } from 'vitest';
import { buildSshCommand, hasUnsafeShellChars } from './railwayCli';

describe('buildSshCommand', () => {
  it('builds railway ssh with project id and quoted names', () => {
    expect(buildSshCommand({ projectId: 'abc-123', serviceName: 'web', environmentName: 'production' }))
      .toBe('railway ssh --project abc-123 --service "web" --environment "production"');
  });
  it('quotes names with spaces', () => {
    expect(buildSshCommand({ projectId: 'p', serviceName: 'web api', environmentName: 'prod env' }))
      .toBe('railway ssh --project p --service "web api" --environment "prod env"');
  });
});

describe('hasUnsafeShellChars', () => {
  it('is false for typical slug-like names', () => {
    expect(hasUnsafeShellChars('web api')).toBe(false);
    expect(hasUnsafeShellChars('production-2')).toBe(false);
  });
  it('is true for names that break cross-shell quoting', () => {
    expect(hasUnsafeShellChars('a"b')).toBe(true);   // double quote
    expect(hasUnsafeShellChars('a$b')).toBe(true);   // PowerShell expansion
    expect(hasUnsafeShellChars('a`b')).toBe(true);   // backtick
    expect(hasUnsafeShellChars('a\nb')).toBe(true);  // newline
  });
});
