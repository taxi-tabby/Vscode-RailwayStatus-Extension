import { describe, it, expect, vi, afterEach } from 'vitest';
import { RailwayApiClient } from './client';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const resp = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => body,
});

describe('RailwayApiClient auth handling', () => {
  it('retries once after 401 using forceRefresh', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(resp(401, {}))
      .mockResolvedValueOnce(resp(200, { data: { me: { workspaces: [] } } }));
    vi.stubGlobal('fetch', fetchFn);
    const onAuthFailure = vi.fn();
    const client = new RailwayApiClient({
      getToken: async () => 'OLD',
      forceRefresh: async () => 'NEW',
      onAuthFailure,
    });
    expect(await client.getWorkspaces()).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(onAuthFailure).not.toHaveBeenCalled();
    const secondAuth = (fetchFn.mock.calls[1][1] as { headers: Record<string, string> }).headers.Authorization;
    expect(secondAuth).toBe('Bearer NEW');
  });

  it('calls onAuthFailure when refresh fails on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(401, {})));
    const onAuthFailure = vi.fn();
    const client = new RailwayApiClient({
      getToken: async () => 'OLD',
      forceRefresh: async () => undefined,
      onAuthFailure,
    });
    await expect(client.getWorkspaces()).rejects.toThrow(/Authentication expired/);
    expect(onAuthFailure).toHaveBeenCalledOnce();
  });

  it('throws Not authenticated when no token', async () => {
    const client = new RailwayApiClient({
      getToken: async () => undefined,
      forceRefresh: async () => undefined,
      onAuthFailure: vi.fn(),
    });
    await expect(client.getWorkspaces()).rejects.toThrow(/Not authenticated/);
  });
});
