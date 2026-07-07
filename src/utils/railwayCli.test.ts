import { describe, it, expect } from 'vitest';
import { buildSshCommand } from './railwayCli';

describe('buildSshCommand', () => {
  it('builds railway ssh with project id and quoted names', () => {
    expect(buildSshCommand({ projectId: 'abc-123', serviceName: 'web', environmentName: 'production' }))
      .toBe('railway ssh --project abc-123 --service "web" --environment "production"');
  });
  it('quotes names with spaces', () => {
    expect(buildSshCommand({ projectId: 'p', serviceName: 'web api', environmentName: 'prod env' }))
      .toBe('railway ssh --project p --service "web api" --environment "prod env"');
  });
  it('escapes double quotes in names', () => {
    expect(buildSshCommand({ projectId: 'p', serviceName: 'a"b', environmentName: 'e' }))
      .toBe('railway ssh --project p --service "a\\"b" --environment "e"');
  });
});
