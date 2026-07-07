import { describe, it, expect } from 'vitest';
import { formatDotEnv } from './dotenv';

describe('formatDotEnv', () => {
  it('sorts keys ascending and formats KEY=value', () => {
    expect(formatDotEnv({ B: '2', A: '1' })).toBe('A=1\nB=2');
  });
  it('returns empty string for no vars', () => {
    expect(formatDotEnv({})).toBe('');
  });
  it('preserves raw values including = and spaces', () => {
    expect(formatDotEnv({ URL: 'postgres://a:b@h/db?x=1' })).toBe('URL=postgres://a:b@h/db?x=1');
  });
});
