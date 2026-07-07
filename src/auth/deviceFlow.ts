import {
  RAILWAY_OAUTH_DEVICE_AUTH_URL,
  RAILWAY_OAUTH_TOKEN_URL,
  RAILWAY_OAUTH_CLIENT_ID,
  RAILWAY_OAUTH_SCOPES,
  RAILWAY_DEVICE_GRANT_TYPE,
  RAILWAY_REFRESH_GRANT_TYPE,
  DEVICE_POLL_DEFAULT_INTERVAL_MS,
  DEVICE_POLL_SLOW_DOWN_STEP_MS,
} from '../constants';

export type DeviceAuthErrorCode =
  | 'access_denied' | 'expired_token' | 'invalid_grant'
  | 'network' | 'unknown';

export class DeviceAuthError extends Error {
  constructor(public code: DeviceAuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DeviceAuthError';
  }
}

export class DeviceAuthCancelled extends Error {
  constructor() { super('cancelled'); this.name = 'DeviceAuthCancelled'; }
}

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  intervalMs: number;
  expiresAt: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const defaultDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function form(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
}

function parseTokenSet(raw: unknown, now: () => number): TokenSet {
  const j = (raw ?? {}) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!j.access_token) {
    throw new DeviceAuthError('unknown', 'token 응답에 access_token 없음');
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: now() + (j.expires_in ?? 3600) * 1000,
  };
}

export async function requestDeviceCode(now: () => number = Date.now): Promise<DeviceCodeResponse> {
  let res: Response;
  try {
    res = await fetch(RAILWAY_OAUTH_DEVICE_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: RAILWAY_OAUTH_CLIENT_ID, scope: RAILWAY_OAUTH_SCOPES }),
    });
  } catch (e) {
    throw new DeviceAuthError('network', `device code 요청 실패: ${errMessage(e)}`);
  }
  if (!res.ok) {
    throw new DeviceAuthError('unknown', `device code 요청 실패 (HTTP ${res.status})`);
  }
  const j = (await res.json()) as {
    device_code: string; user_code: string; verification_uri: string;
    verification_uri_complete?: string; interval?: number; expires_in: number;
  };
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri,
    verificationUriComplete: j.verification_uri_complete,
    intervalMs: j.interval != null ? j.interval * 1000 : DEVICE_POLL_DEFAULT_INTERVAL_MS,
    expiresAt: now() + j.expires_in * 1000,
  };
}

export async function pollForToken(
  deviceCode: string,
  intervalMs: number,
  expiresAt: number,
  signal: AbortSignal,
  delay: (ms: number) => Promise<void> = defaultDelay,
  now: () => number = Date.now,
): Promise<TokenSet> {
  let interval = intervalMs;
  for (;;) {
    if (signal.aborted) { throw new DeviceAuthCancelled(); }
    if (now() >= expiresAt) { throw new DeviceAuthError('expired_token'); }

    let res: Response | undefined;
    try {
      res = await fetch(RAILWAY_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          grant_type: RAILWAY_DEVICE_GRANT_TYPE,
          device_code: deviceCode,
          client_id: RAILWAY_OAUTH_CLIENT_ID,
        }),
        signal,
      });
    } catch (e) {
      if (signal.aborted) { throw new DeviceAuthCancelled(); }
      // 일시적 네트워크 오류: 대기 후 재시도
    }

    if (res) {
      if (res.ok) { return parseTokenSet(await res.json(), now); }
      const err = await readError(res);
      if (err === 'slow_down') { interval += DEVICE_POLL_SLOW_DOWN_STEP_MS; }
      else if (err === 'authorization_pending') { /* 계속 폴링 */ }
      else if (err === 'access_denied') { throw new DeviceAuthError('access_denied'); }
      else if (err === 'expired_token') { throw new DeviceAuthError('expired_token'); }
      else { throw new DeviceAuthError('unknown', `token 폴링 실패: ${err}`); }
    }

    await delay(interval);
  }
}

export async function refreshAccessToken(
  refreshToken: string,
  now: () => number = Date.now,
): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetch(RAILWAY_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        grant_type: RAILWAY_REFRESH_GRANT_TYPE,
        refresh_token: refreshToken,
        client_id: RAILWAY_OAUTH_CLIENT_ID,
      }),
    });
  } catch (e) {
    throw new DeviceAuthError('network', `토큰 갱신 실패: ${errMessage(e)}`);
  }
  if (!res.ok) {
    const err = await readError(res);
    throw new DeviceAuthError(err === 'invalid_grant' ? 'invalid_grant' : 'unknown', err);
  }
  return parseTokenSet(await res.json(), now);
}

export function describeDeviceAuthError(err: unknown): string {
  if (err instanceof DeviceAuthError) {
    switch (err.code) {
      case 'access_denied': return '로그인이 거부되었습니다.';
      case 'expired_token': return '코드가 만료되었습니다. 다시 시도하세요.';
      case 'invalid_grant': return '세션이 만료되었습니다. 다시 로그인하세요.';
      case 'network': return '네트워크 오류로 Railway에 연결하지 못했습니다.';
      default: return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
