import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  requestDeviceCode, pollForToken, refreshAccessToken,
  DeviceAuthError, DeviceAuthCancelled,
} from './deviceFlow';

const noDelay = () => Promise.resolve();

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    });
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('requestDeviceCode', () => {
  it('parses response and defaults interval to 5000ms when absent', async () => {
    mockFetch([{ status: 200, body: {
      device_code: 'DC', user_code: 'AAAA-BBBB',
      verification_uri: 'https://railway.com/activate',
      verification_uri_complete: 'https://railway.com/activate?user_code=AAAA-BBBB',
      expires_in: 600,
    } }]);
    const r = await requestDeviceCode(() => 1_000_000);
    expect(r.deviceCode).toBe('DC');
    expect(r.userCode).toBe('AAAA-BBBB');
    expect(r.intervalMs).toBe(5000);
    expect(r.expiresAt).toBe(1_000_000 + 600_000);
    expect(r.verificationUriComplete).toContain('user_code=');
  });

  it('uses server interval when provided', async () => {
    mockFetch([{ status: 200, body: {
      device_code: 'DC', user_code: 'X', verification_uri: 'u', interval: 7, expires_in: 600,
    } }]);
    expect((await requestDeviceCode(() => 0)).intervalMs).toBe(7000);
  });
});

describe('pollForToken', () => {
  it('keeps polling on authorization_pending then returns tokens', async () => {
    const fn = mockFetch([
      { status: 400, body: { error: 'authorization_pending' } },
      { status: 400, body: { error: 'authorization_pending' } },
      { status: 200, body: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } },
    ]);
    const set = await pollForToken('DC', 10, Number.MAX_SAFE_INTEGER, new AbortController().signal, noDelay, () => 0);
    expect(set).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 3_600_000 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('increases interval on slow_down', async () => {
    const delays: number[] = [];
    mockFetch([
      { status: 400, body: { error: 'slow_down' } },
      { status: 200, body: { access_token: 'AT', expires_in: 3600 } },
    ]);
    await pollForToken('DC', 5000, Number.MAX_SAFE_INTEGER, new AbortController().signal,
      (ms) => { delays.push(ms); return Promise.resolve(); }, () => 0);
    expect(delays[0]).toBe(10000);
  });

  it('throws access_denied', async () => {
    mockFetch([{ status: 400, body: { error: 'access_denied' } }]);
    await expect(pollForToken('DC', 10, Number.MAX_SAFE_INTEGER, new AbortController().signal, noDelay, () => 0))
      .rejects.toMatchObject({ code: 'access_denied' });
  });

  it('throws expired_token when past expiresAt', async () => {
    mockFetch([]);
    await expect(pollForToken('DC', 10, 0, new AbortController().signal, noDelay, () => 1000))
      .rejects.toBeInstanceOf(DeviceAuthError);
  });

  it('throws DeviceAuthCancelled when signal already aborted', async () => {
    mockFetch([]);
    const ac = new AbortController(); ac.abort();
    await expect(pollForToken('DC', 10, Number.MAX_SAFE_INTEGER, ac.signal, noDelay, () => 0))
      .rejects.toBeInstanceOf(DeviceAuthCancelled);
  });
});

describe('refreshAccessToken', () => {
  it('returns new token set on success', async () => {
    mockFetch([{ status: 200, body: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 } }]);
    expect(await refreshAccessToken('RT', () => 0)).toEqual({ accessToken: 'AT2', refreshToken: 'RT2', expiresAt: 3_600_000 });
  });

  it('throws invalid_grant DeviceAuthError', async () => {
    mockFetch([{ status: 400, body: { error: 'invalid_grant' } }]);
    await expect(refreshAccessToken('RT', () => 0)).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});
