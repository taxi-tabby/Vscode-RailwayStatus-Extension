import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRelativeTime } from './timeFormat';

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for times less than 60 seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:01:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:30Z')).toBe('just now');
  });

  it('returns minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:05:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('5m ago');
  });

  it('returns hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T15:00:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('3h ago');
  });

  it('returns days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-18T12:00:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('3d ago');
  });

  it('returns "1m ago" for exactly 60 seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:01:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('1m ago');
  });
});
