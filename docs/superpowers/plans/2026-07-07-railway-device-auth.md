# Railway Device Auth 단일화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Railway 인증을 OAuth 2.0 Device Authorization Grant(RFC 8628) 네이티브 재구현으로 단일화하고, refresh token 자동 갱신으로 세션이 끊기지 않게 한다.

**Architecture:** 순수 프로토콜(`deviceFlow.ts`) + 저장소(`tokenStore.ts`, vscode 비의존) + 토큰 오케스트레이션(`sessionManager.ts`, vscode 비의존) 3개의 테스트 가능한 코어를, VS Code 어댑터(`railwayAuth.ts`)와 API 클라이언트(`client.ts`)가 소비한다. 인증 수단은 Device 로그인(기본) + 수동 API 토큰(폴백) 2가지.

**Tech Stack:** TypeScript(CommonJS, strict), VS Code Extension API, vitest, esbuild. 전역 `fetch`/`AbortController`(Node 18+, 확장 호스트에서 사용 가능).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-07-railway-device-auth-design.md` (검증된 엔드포인트/응답 포함).
- Device auth: `POST https://backboard.railway.com/oauth/device/auth`, Token: `POST https://backboard.railway.com/oauth/token`.
- Public client_id: `rlwy_oaci_onEklvmksh1hRUiCo7E2zX12` (env `RAILWAY_OAUTH_CLIENT_ID` override).
- Scopes: `openid email profile offline_access workspace:admin project:admin ssh_keys`.
- Device code 응답에 `interval` 필드가 **없음** → 폴링 기본 5초.
- 미승인 폴링 = HTTP 400 body `{"error":"authorization_pending"}` (HTTP status가 아니라 body의 `error`로 분기).
- 테스트는 소스 옆 `*.test.ts`, `vscode` 모듈은 import/목킹하지 않음(비의존 계층만 테스트).
- 커밋 메시지에 `Co-Authored-By` 트레일러 금지(전역 지침).
- 브랜치: `feat/railway-device-auth`.
- 각 task 종료 시 `npm run lint`(tsc --noEmit)와 `npm test`가 green이어야 함(명시된 경우).

## File Structure

- `src/constants.ts` — 수정: device flow 상수/secret 키 추가, scope 값 변경(Task 1); 콜백 상수 제거(Task 5).
- `src/auth/deviceFlow.ts` — 신규: RFC 8628 프로토콜(순수). `src/auth/deviceFlow.test.ts`.
- `src/auth/tokenStore.ts` — 수정: `SecretStorageLike` + OAuth 토큰셋 메서드. `src/auth/tokenStore.test.ts`.
- `src/auth/sessionManager.ts` — 신규: 유효 토큰/자동 갱신 오케스트레이션(순수). `src/auth/sessionManager.test.ts`.
- `src/auth/railwayAuth.ts` — 재작성: Device 로그인 UI + API 토큰 폴백(vscode 어댑터).
- `src/api/client.ts` — 수정: `getToken`/`forceRefresh` 주입 + 401 재시도. `src/api/client.test.ts`.
- `src/extension.ts` — 수정: sessionManager 생성/배선, loginWithCli 제거, 로그인 에러 처리.
- `package.json` — 수정: loginWithCli 명령·oauthClientId 설정 제거, viewsWelcome 갱신.

---

### Task 1: 상수 추가 (device flow)

**Files:**
- Modify: `src/constants.ts`

**Interfaces:**
- Produces: `RAILWAY_OAUTH_DEVICE_AUTH_URL`, `RAILWAY_OAUTH_CLIENT_ID`, `RAILWAY_OAUTH_SCOPES`(값 변경), `RAILWAY_DEVICE_GRANT_TYPE`, `RAILWAY_REFRESH_GRANT_TYPE`, `DEVICE_POLL_DEFAULT_INTERVAL_MS`, `DEVICE_POLL_SLOW_DOWN_STEP_MS`, `TOKEN_REFRESH_BUFFER_MS`, `SECRET_KEY_REFRESH_TOKEN`, `SECRET_KEY_TOKEN_EXPIRES_AT`.
- `RAILWAY_OAUTH_AUTH_URL`, `OAUTH_CALLBACK_PORT`, `OAUTH_CALLBACK_PATH`는 이 task에서 **제거하지 않음**(Task 5에서 사용처 제거 후 삭제 — 중간 컴파일 유지).

- [ ] **Step 1: constants.ts 상단 OAuth 블록 교체**

기존:
```ts
export const RAILWAY_OAUTH_AUTH_URL = 'https://backboard.railway.com/oauth/auth';
export const RAILWAY_OAUTH_TOKEN_URL = 'https://backboard.railway.com/oauth/token';
export const RAILWAY_OAUTH_SCOPES = 'openid';
export const OAUTH_CALLBACK_PORT = 9876;
export const OAUTH_CALLBACK_PATH = '/callback';

export const SECRET_KEY_ACCESS_TOKEN = 'railway.accessToken';
export const SECRET_KEY_API_TOKEN = 'railway.apiToken';
```
교체 후:
```ts
// ─── OAuth Device Authorization Grant (RFC 8628) ───
export const RAILWAY_OAUTH_DEVICE_AUTH_URL = 'https://backboard.railway.com/oauth/device/auth';
export const RAILWAY_OAUTH_TOKEN_URL = 'https://backboard.railway.com/oauth/token';
export const RAILWAY_OAUTH_CLIENT_ID =
  process.env.RAILWAY_OAUTH_CLIENT_ID?.trim() || 'rlwy_oaci_onEklvmksh1hRUiCo7E2zX12';
export const RAILWAY_OAUTH_SCOPES =
  'openid email profile offline_access workspace:admin project:admin ssh_keys';
export const RAILWAY_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
export const RAILWAY_REFRESH_GRANT_TYPE = 'refresh_token';
export const DEVICE_POLL_DEFAULT_INTERVAL_MS = 5_000;
export const DEVICE_POLL_SLOW_DOWN_STEP_MS = 5_000;
export const TOKEN_REFRESH_BUFFER_MS = 60_000;

// 콜백 상수는 Task 5(railwayAuth 재작성)에서 사용처 제거 후 삭제
export const RAILWAY_OAUTH_AUTH_URL = 'https://backboard.railway.com/oauth/auth';
export const OAUTH_CALLBACK_PORT = 9876;
export const OAUTH_CALLBACK_PATH = '/callback';

export const SECRET_KEY_ACCESS_TOKEN = 'railway.accessToken';
export const SECRET_KEY_API_TOKEN = 'railway.apiToken';
export const SECRET_KEY_REFRESH_TOKEN = 'railway.refreshToken';
export const SECRET_KEY_TOKEN_EXPIRES_AT = 'railway.tokenExpiresAt';
```

- [ ] **Step 2: 컴파일 확인**

Run: `npm run lint`
Expected: 에러 없음(PASS). 기존 railwayAuth가 여전히 옛 상수를 참조하지만 모두 존재하므로 통과.

- [ ] **Step 3: 커밋**

```bash
git add src/constants.ts
git commit -m "feat(auth): device grant 상수 추가"
```

---

### Task 2: deviceFlow.ts — RFC 8628 프로토콜 (TDD)

**Files:**
- Create: `src/auth/deviceFlow.ts`
- Test: `src/auth/deviceFlow.test.ts`

**Interfaces:**
- Consumes: Task 1 상수.
- Produces:
  - `interface DeviceCodeResponse { deviceCode; userCode; verificationUri; verificationUriComplete?; intervalMs; expiresAt }`
  - `interface TokenSet { accessToken; refreshToken?; expiresAt }`
  - `class DeviceAuthError extends Error { code: DeviceAuthErrorCode }`
  - `class DeviceAuthCancelled extends Error`
  - `requestDeviceCode(now?): Promise<DeviceCodeResponse>`
  - `pollForToken(deviceCode, intervalMs, expiresAt, signal, delay?, now?): Promise<TokenSet>`
  - `refreshAccessToken(refreshToken, now?): Promise<TokenSet>`
  - `describeDeviceAuthError(err): string`

- [ ] **Step 1: 실패 테스트 작성 — `src/auth/deviceFlow.test.ts`**

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/auth/deviceFlow.test.ts`
Expected: FAIL — `deviceFlow` 모듈/함수 없음.

- [ ] **Step 3: 구현 — `src/auth/deviceFlow.ts`**

```ts
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

function parseTokenSet(j: {
  access_token?: string; refresh_token?: string; expires_in?: number;
}, now: () => number): TokenSet {
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/auth/deviceFlow.test.ts`
Expected: PASS (모든 케이스).

- [ ] **Step 5: 커밋**

```bash
git add src/auth/deviceFlow.ts src/auth/deviceFlow.test.ts
git commit -m "feat(auth): device grant 프로토콜(deviceFlow) 구현 + 테스트"
```

---

### Task 3: tokenStore.ts — SecretStorageLike + OAuth 토큰셋 (TDD)

**Files:**
- Modify: `src/auth/tokenStore.ts`
- Test: `src/auth/tokenStore.test.ts`

**Interfaces:**
- Produces:
  - `interface SecretStorageLike { get(k): PromiseLike<string|undefined>; store(k,v): PromiseLike<void>; delete(k): PromiseLike<void> }`
  - `TokenStore` 메서드: `getAccessToken`, `getRefreshToken`, `getApiToken`, `getExpiresAt(): Promise<number|undefined>`, `storeOAuthTokens({accessToken, refreshToken?, expiresAt})`, `storeAccessToken`, `storeApiToken`, `clearOAuthTokens`, `clearAll`, `hasAnyToken`.
- Consumes: Task 1 secret 키 상수.
- 참고: `context.secrets`(vscode.SecretStorage)는 구조적으로 `SecretStorageLike`에 대입 가능(extension.ts 무수정 컴파일).

- [ ] **Step 1: 실패 테스트 작성 — `src/auth/tokenStore.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TokenStore, type SecretStorageLike } from './tokenStore';

class FakeSecrets implements SecretStorageLike {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k); }
  async store(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
}

describe('TokenStore', () => {
  let store: TokenStore;
  beforeEach(() => { store = new TokenStore(new FakeSecrets()); });

  it('stores and reads OAuth token set incl. numeric expiresAt', async () => {
    await store.storeOAuthTokens({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1234567890 });
    expect(await store.getAccessToken()).toBe('AT');
    expect(await store.getRefreshToken()).toBe('RT');
    expect(await store.getExpiresAt()).toBe(1234567890);
  });

  it('getExpiresAt returns undefined when unset', async () => {
    expect(await store.getExpiresAt()).toBeUndefined();
  });

  it('clearOAuthTokens removes oauth keys but keeps api token', async () => {
    await store.storeOAuthTokens({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1 });
    await store.storeApiToken('API');
    await store.clearOAuthTokens();
    expect(await store.getAccessToken()).toBeUndefined();
    expect(await store.getRefreshToken()).toBeUndefined();
    expect(await store.getExpiresAt()).toBeUndefined();
    expect(await store.getApiToken()).toBe('API');
  });

  it('clearAll removes everything', async () => {
    await store.storeOAuthTokens({ accessToken: 'AT', expiresAt: 1 });
    await store.storeApiToken('API');
    await store.clearAll();
    expect(await store.hasAnyToken()).toBe(false);
  });

  it('hasAnyToken true with only api token', async () => {
    await store.storeApiToken('API');
    expect(await store.hasAnyToken()).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/auth/tokenStore.test.ts`
Expected: FAIL — `storeOAuthTokens`/`getExpiresAt`/`clearOAuthTokens` 없음, `SecretStorageLike` export 없음.

- [ ] **Step 3: 구현 — `src/auth/tokenStore.ts` 전체 교체**

```ts
import {
  SECRET_KEY_ACCESS_TOKEN,
  SECRET_KEY_API_TOKEN,
  SECRET_KEY_REFRESH_TOKEN,
  SECRET_KEY_TOKEN_EXPIRES_AT,
} from '../constants';

/** vscode.SecretStorage의 구조적 부분집합 (테스트를 위해 vscode 의존 제거) */
export interface SecretStorageLike {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export class TokenStore {
  constructor(private secrets: SecretStorageLike) {}

  async getAccessToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_ACCESS_TOKEN);
  }

  async getRefreshToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_REFRESH_TOKEN);
  }

  async getApiToken(): Promise<string | undefined> {
    return await this.secrets.get(SECRET_KEY_API_TOKEN);
  }

  async getExpiresAt(): Promise<number | undefined> {
    const raw = await this.secrets.get(SECRET_KEY_TOKEN_EXPIRES_AT);
    if (raw === undefined) { return undefined; }
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  async storeOAuthTokens(t: {
    accessToken: string; refreshToken?: string; expiresAt: number;
  }): Promise<void> {
    await this.secrets.store(SECRET_KEY_ACCESS_TOKEN, t.accessToken);
    if (t.refreshToken) {
      await this.secrets.store(SECRET_KEY_REFRESH_TOKEN, t.refreshToken);
    }
    await this.secrets.store(SECRET_KEY_TOKEN_EXPIRES_AT, String(t.expiresAt));
  }

  async storeAccessToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_ACCESS_TOKEN, token);
  }

  async storeApiToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_API_TOKEN, token);
  }

  async clearOAuthTokens(): Promise<void> {
    await this.secrets.delete(SECRET_KEY_ACCESS_TOKEN);
    await this.secrets.delete(SECRET_KEY_REFRESH_TOKEN);
    await this.secrets.delete(SECRET_KEY_TOKEN_EXPIRES_AT);
  }

  async clearAll(): Promise<void> {
    await this.clearOAuthTokens();
    await this.secrets.delete(SECRET_KEY_API_TOKEN);
  }

  async hasAnyToken(): Promise<boolean> {
    const access = await this.getAccessToken();
    const api = await this.getApiToken();
    return !!(access || api);
  }
}
```

- [ ] **Step 4: 테스트 + 전체 컴파일 확인**

Run: `npm test -- src/auth/tokenStore.test.ts`
Expected: PASS.
Run: `npm run lint`
Expected: PASS (extension.ts의 `new TokenStore(context.secrets)`는 구조적으로 호환).

- [ ] **Step 5: 커밋**

```bash
git add src/auth/tokenStore.ts src/auth/tokenStore.test.ts
git commit -m "feat(auth): tokenStore에 OAuth 토큰셋/SecretStorageLike 추가 + 테스트"
```

---

### Task 4: sessionManager.ts — 유효 토큰/자동 갱신 (TDD)

**Files:**
- Create: `src/auth/sessionManager.ts`
- Test: `src/auth/sessionManager.test.ts`

**Interfaces:**
- Consumes: `TokenStore`(Task 3), `refreshAccessToken`/`TokenSet`/`DeviceAuthError`(Task 2), `TOKEN_REFRESH_BUFFER_MS`(Task 1).
- Produces: `class SessionManager { getValidAccessToken(): Promise<string|undefined>; forceRefresh(): Promise<string|undefined> }`, 생성자 `(store, refresh=refreshAccessToken, now=Date.now)`.

- [ ] **Step 1: 실패 테스트 작성 — `src/auth/sessionManager.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { TokenStore, type SecretStorageLike } from './tokenStore';
import { SessionManager } from './sessionManager';
import { DeviceAuthError, type TokenSet } from './deviceFlow';
import { TOKEN_REFRESH_BUFFER_MS } from '../constants';

class FakeSecrets implements SecretStorageLike {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k); }
  async store(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
}
const makeStore = () => new TokenStore(new FakeSecrets());

describe('SessionManager.getValidAccessToken', () => {
  it('returns access token when not near expiry', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1_000_000 });
    const refresh = vi.fn<[string], Promise<TokenSet>>();
    const sm = new SessionManager(store, refresh, () => 1_000_000 - TOKEN_REFRESH_BUFFER_MS - 1);
    expect(await sm.getValidAccessToken()).toBe('AT');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when near expiry and stores new tokens', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 1_000_000 });
    const refresh = vi.fn(async (): Promise<TokenSet> => ({ accessToken: 'NEW', refreshToken: 'RT2', expiresAt: 9_000_000 }));
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    expect(await sm.getValidAccessToken()).toBe('NEW');
    expect(refresh).toHaveBeenCalledWith('RT');
    expect(await store.getAccessToken()).toBe('NEW');
    expect(await store.getRefreshToken()).toBe('RT2');
  });

  it('preserves old refresh token when refresh omits it', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 });
    const refresh = vi.fn(async (): Promise<TokenSet> => ({ accessToken: 'NEW', expiresAt: 9_000_000 }));
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    await sm.getValidAccessToken();
    expect(await store.getRefreshToken()).toBe('RT');
  });

  it('clears oauth tokens and falls back to api token on invalid_grant', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 });
    await store.storeApiToken('API');
    const refresh = vi.fn(async (): Promise<TokenSet> => { throw new DeviceAuthError('invalid_grant'); });
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    expect(await sm.getValidAccessToken()).toBe('API');
    expect(await store.getAccessToken()).toBeUndefined();
  });

  it('keeps existing access token on network error during refresh', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 });
    const refresh = vi.fn(async (): Promise<TokenSet> => { throw new DeviceAuthError('network'); });
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    expect(await sm.getValidAccessToken()).toBe('OLD');
    expect(await store.getAccessToken()).toBe('OLD');
  });

  it('falls back to api token when no oauth tokens', async () => {
    const store = makeStore();
    await store.storeApiToken('API');
    const sm = new SessionManager(store, vi.fn<[string], Promise<TokenSet>>(), () => 0);
    expect(await sm.getValidAccessToken()).toBe('API');
  });

  it('dedupes concurrent refreshes into one call', async () => {
    const store = makeStore();
    await store.storeOAuthTokens({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 });
    let calls = 0;
    const refresh = vi.fn(async (): Promise<TokenSet> => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { accessToken: 'NEW', refreshToken: 'RT2', expiresAt: 9_000_000 };
    });
    const sm = new SessionManager(store, refresh, () => 1_000_000);
    const [a, b] = await Promise.all([sm.getValidAccessToken(), sm.getValidAccessToken()]);
    expect([a, b]).toEqual(['NEW', 'NEW']);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/auth/sessionManager.test.ts`
Expected: FAIL — `SessionManager` 없음.

- [ ] **Step 3: 구현 — `src/auth/sessionManager.ts`**

```ts
import { TokenStore } from './tokenStore';
import { refreshAccessToken, DeviceAuthError, type TokenSet } from './deviceFlow';
import { TOKEN_REFRESH_BUFFER_MS } from '../constants';

export class SessionManager {
  private inflight?: Promise<string | undefined>;

  constructor(
    private store: TokenStore,
    private refresh: (refreshToken: string) => Promise<TokenSet> = refreshAccessToken,
    private now: () => number = Date.now,
  ) {}

  async getValidAccessToken(): Promise<string | undefined> {
    const access = await this.store.getAccessToken();
    if (access) {
      const exp = await this.store.getExpiresAt();
      if (exp === undefined || exp - this.now() > TOKEN_REFRESH_BUFFER_MS) {
        return access;
      }
      const refreshed = await this.doRefresh();
      if (refreshed) { return refreshed; }
      // 갱신 실패: invalid_grant면 토큰이 지워졌고, 네트워크 오류면 유지됨
      const still = await this.store.getAccessToken();
      if (still) { return still; }
    } else if (await this.store.getRefreshToken()) {
      const refreshed = await this.doRefresh();
      if (refreshed) { return refreshed; }
    }
    // OAuth 경로 소진 → API 토큰 폴백
    return await this.store.getApiToken();
  }

  async forceRefresh(): Promise<string | undefined> {
    return this.doRefresh();
  }

  private doRefresh(): Promise<string | undefined> {
    if (!this.inflight) {
      this.inflight = this.performRefresh().finally(() => { this.inflight = undefined; });
    }
    return this.inflight;
  }

  private async performRefresh(): Promise<string | undefined> {
    const rt = await this.store.getRefreshToken();
    if (!rt) { return undefined; }
    try {
      const set = await this.refresh(rt);
      await this.store.storeOAuthTokens({
        accessToken: set.accessToken,
        refreshToken: set.refreshToken ?? rt, // 응답에 없으면 기존 유지
        expiresAt: set.expiresAt,
      });
      return set.accessToken;
    } catch (e) {
      if (e instanceof DeviceAuthError && e.code === 'invalid_grant') {
        await this.store.clearOAuthTokens();
      }
      // network/unknown → 토큰 보존
      return undefined;
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/auth/sessionManager.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/auth/sessionManager.ts src/auth/sessionManager.test.ts
git commit -m "feat(auth): 자동 갱신 SessionManager 구현 + 테스트"
```

---

### Task 5: railwayAuth.ts 재작성 + extension 배선(1) + 콜백 상수 제거

**Files:**
- Modify(전체 교체): `src/auth/railwayAuth.ts`
- Modify: `src/extension.ts` (sessionManager 생성, authProvider 3-인자, loginWithCli 등록 제거, 로그인 에러 처리)
- Modify: `src/constants.ts` (콜백 상수 3개 제거)

**Interfaces:**
- Consumes: `deviceFlow`(Task 2), `TokenStore`(Task 3), `SessionManager`(Task 4).
- Produces: `RailwayAuthProvider` 생성자 `(context, tokenStore, sessionManager)`, `createSession`(device flow), `loginWithToken`(폴백 유지). `loginWithCli`/OAuth-app/PKCE/콜백서버 **제거**.
- 이 task에서 `RailwayApiClient` 생성자는 **변경하지 않음**(옛 `getAccessToken`/`getApiToken` 유지 → Task 6에서 변경).

- [ ] **Step 1: `src/auth/railwayAuth.ts` 전체 교체**

```ts
import * as vscode from 'vscode';
import { requestDeviceCode, pollForToken, type TokenSet } from './deviceFlow';
import { RAILWAY_GRAPHQL_ENDPOINT } from '../constants';
import { TokenStore } from './tokenStore';
import { SessionManager } from './sessionManager';

const AUTH_PROVIDER_ID = 'railway';
const AUTH_PROVIDER_LABEL = 'Railway';

export class RailwayAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private tokenStore: TokenStore,
    private sessionManager: SessionManager,
  ) {
    this._disposables.push(
      vscode.authentication.registerAuthenticationProvider(
        AUTH_PROVIDER_ID, AUTH_PROVIDER_LABEL, this,
        { supportsMultipleAccounts: false },
      ),
    );
  }

  async getSessions(_scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    const token = await this.sessionManager.getValidAccessToken();
    return token ? [this.buildSession(token)] : [];
  }

  // ─── Device Authorization Grant (browserless) ───
  async createSession(_scopes: string[]): Promise<vscode.AuthenticationSession> {
    const device = await requestDeviceCode();
    const url = device.verificationUriComplete ?? device.verificationUri;
    await vscode.env.clipboard.writeText(device.userCode);
    await vscode.env.openExternal(vscode.Uri.parse(url));

    const tokenSet = await vscode.window.withProgress<TokenSet>(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Railway 로그인 대기 중 — 브라우저에서 코드 [${device.userCode}] 승인 (클립보드에 복사됨)`,
        cancellable: true,
      },
      async (_progress, cancelToken) => {
        const ac = new AbortController();
        cancelToken.onCancellationRequested(() => ac.abort());
        return pollForToken(device.deviceCode, device.intervalMs, device.expiresAt, ac.signal);
      },
    );

    await this.tokenStore.storeOAuthTokens(tokenSet);
    const session = this.buildSession(tokenSet.accessToken);
    this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
    return session;
  }

  async removeSession(_sessionId: string): Promise<void> {
    await this.tokenStore.clearAll();
    this._onDidChangeSessions.fire({ added: [], removed: [], changed: [] });
  }

  // ─── API Token (수동 폴백) ───
  async loginWithToken(): Promise<void> {
    const token = await vscode.window.showInputBox({
      title: 'Railway: API Token',
      prompt: 'Railway API 토큰을 붙여넣으세요 (Account 또는 Workspace 토큰)',
      placeHolder: 'e.g. rlwy_xxxxxxxxxxxxxxxxxxxx',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : 'Token cannot be empty'),
    });
    if (!token) { return; }

    const trimmed = token.trim();
    const valid = await this.validateToken(trimmed);
    if (!valid) {
      vscode.window.showErrorMessage(
        'Railway: 유효하지 않은 API 토큰입니다. railway.com/account/tokens 에서 확인하세요.',
      );
      return;
    }
    await this.tokenStore.storeApiToken(trimmed);
    this._onDidChangeSessions.fire({ added: [this.buildSession(trimmed)], removed: [], changed: [] });
    vscode.window.showInformationMessage('Railway: API 토큰으로 로그인되었습니다');
  }

  // ─── Helpers ───
  private buildSession(token: string): vscode.AuthenticationSession {
    return {
      id: 'railway-session',
      accessToken: token,
      account: { id: 'railway-user', label: 'Railway User' },
      scopes: [],
    };
  }

  private async validateToken(token: string): Promise<boolean> {
    try {
      const res = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ query: '{ me { id } }' }),
      });
      if (res.status === 401 || res.status === 403) { return false; }
      if (!res.ok) { return false; }
      const json = (await res.json()) as { data?: { me?: { id: string } } };
      return !!json.data?.me?.id;
    } catch {
      return true; // 네트워크 오류: 통과시킴
    }
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
  }
}
```

- [ ] **Step 2: `src/extension.ts` — import 추가**

기존 import 블록에 추가:
```ts
import { SessionManager } from './auth/sessionManager';
import { DeviceAuthCancelled, describeDeviceAuthError } from './auth/deviceFlow';
```

- [ ] **Step 3: `src/extension.ts` — authProvider 생성부 수정**

기존:
```ts
  const tokenStore = new TokenStore(context.secrets);
  const authProvider = new RailwayAuthProvider(context, tokenStore);
```
교체:
```ts
  const tokenStore = new TokenStore(context.secrets);
  const sessionManager = new SessionManager(tokenStore);
  const authProvider = new RailwayAuthProvider(context, tokenStore, sessionManager);
```
(이 task에서는 `apiClient` 생성 블록은 그대로 둔다 — Task 6에서 수정.)

- [ ] **Step 4: `src/extension.ts` — railway.login 에러 처리 수정**

기존:
```ts
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        vscode.window.showErrorMessage(`Railway sign-in failed: ${message}`);
      }
```
교체:
```ts
      } catch (err) {
        if (err instanceof DeviceAuthCancelled) { return; }
        vscode.window.showErrorMessage(`Railway 로그인 실패: ${describeDeviceAuthError(err)}`);
      }
```

- [ ] **Step 5: `src/extension.ts` — loginWithCli 명령 등록 블록 제거**

아래 블록 전체를 삭제:
```ts
    vscode.commands.registerCommand('railway.loginWithCli', async () => {
      await authProvider.loginWithCli();
      const hasCliToken = await tokenStore.hasAnyToken();
      if (hasCliToken) {
        await vscode.commands.executeCommand('setContext', 'railway.authenticated', true);
        treeProvider.refresh();
      }
    }),
```

- [ ] **Step 6: `src/constants.ts` — 콜백 상수 제거**

아래 3줄 삭제:
```ts
export const RAILWAY_OAUTH_AUTH_URL = 'https://backboard.railway.com/oauth/auth';
export const OAUTH_CALLBACK_PORT = 9876;
export const OAUTH_CALLBACK_PATH = '/callback';
```
(주석 `// 콜백 상수는 Task 5...` 도 함께 삭제.)

- [ ] **Step 7: 전체 컴파일 + 빌드 확인**

Run: `npm run lint`
Expected: PASS (에러 없음).
Run: `npm run build`
Expected: 빌드 성공(`dist/extension.js` 생성).

- [ ] **Step 8: 기존 테스트 회귀 확인**

Run: `npm test`
Expected: PASS (deviceFlow/tokenStore/sessionManager/timeFormat 모두 통과).

- [ ] **Step 9: 커밋**

```bash
git add src/auth/railwayAuth.ts src/extension.ts src/constants.ts
git commit -m "feat(auth): railwayAuth를 device flow로 재작성, CLI/OAuth앱 경로 제거"
```

---

### Task 6: client.ts — getToken/forceRefresh + 401 재시도 (TDD) + extension 배선(2)

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/extension.ts` (apiClient 생성부)
- Test: `src/api/client.test.ts`

**Interfaces:**
- Produces: `RailwayApiClient` 생성자 옵션 `{ getToken: () => Promise<string|undefined>; forceRefresh: () => Promise<string|undefined>; onAuthFailure: () => void }`.
- Consumes: `sessionManager.getValidAccessToken`/`forceRefresh`(Task 4).

- [ ] **Step 1: 실패 테스트 작성 — `src/api/client.test.ts`**

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/api/client.test.ts`
Expected: FAIL — 생성자 옵션 불일치(`getToken` 없음).

- [ ] **Step 3: `src/api/client.ts` — 생성자/필드/request 수정**

기존 필드 + 생성자 블록:
```ts
  private getAccessToken: () => Promise<string | undefined>;
  private getApiToken: () => Promise<string | undefined>;
  private onAuthFailure: () => void;

  constructor(options: {
    getAccessToken: () => Promise<string | undefined>;
    getApiToken: () => Promise<string | undefined>;
    onAuthFailure: () => void;
  }) {
    this.getAccessToken = options.getAccessToken;
    this.getApiToken = options.getApiToken;
    this.onAuthFailure = options.onAuthFailure;
  }

  private async getToken(): Promise<string | undefined> {
    return (await this.getAccessToken()) ?? (await this.getApiToken());
  }
```
교체:
```ts
  private getToken: () => Promise<string | undefined>;
  private forceRefresh: () => Promise<string | undefined>;
  private onAuthFailure: () => void;

  constructor(options: {
    getToken: () => Promise<string | undefined>;
    forceRefresh: () => Promise<string | undefined>;
    onAuthFailure: () => void;
  }) {
    this.getToken = options.getToken;
    this.forceRefresh = options.forceRefresh;
    this.onAuthFailure = options.onAuthFailure;
  }
```

그리고 `request` 메서드를 교체:
```ts
  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const token = await this.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    let response = await this.doFetch(query, variables, token);

    if (response.status === 401) {
      const newToken = await this.forceRefresh();
      if (newToken) {
        response = await this.doFetch(query, variables, newToken);
      }
      if (response.status === 401) {
        this.onAuthFailure();
        throw new Error('Authentication expired');
      }
    }

    if (!response.ok) {
      throw new Error(`Railway API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      throw new Error(`GraphQL error: ${json.errors[0].message}`);
    }
    if (!json.data) {
      throw new Error('No data in GraphQL response');
    }
    return json.data;
  }

  private doFetch(
    query: string,
    variables: Record<string, unknown> | undefined,
    token: string,
  ): Promise<Response> {
    return fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
  }
```

- [ ] **Step 4: `src/extension.ts` — apiClient 생성부 수정**

기존:
```ts
  const apiClient = new RailwayApiClient({
    getAccessToken: () => tokenStore.getAccessToken(),
    getApiToken: () => tokenStore.getApiToken(),
    onAuthFailure: () => {
```
교체(콜백 본문은 유지):
```ts
  const apiClient = new RailwayApiClient({
    getToken: () => sessionManager.getValidAccessToken(),
    forceRefresh: () => sessionManager.forceRefresh(),
    onAuthFailure: () => {
```

- [ ] **Step 5: 테스트 + 컴파일 확인**

Run: `npm test -- src/api/client.test.ts`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/api/client.ts src/api/client.test.ts src/extension.ts
git commit -m "feat(auth): API 클라이언트 401 자동 갱신 재시도 + sessionManager 배선"
```

---

### Task 7: package.json 매니페스트 정리

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `railway.login`, `railway.loginWithToken` 명령(유지).
- 제거: `railway.loginWithCli` 명령, `railway.oauthClientId` 설정.

- [ ] **Step 1: `railway.loginWithCli` 명령 블록 제거**

`contributes.commands`에서 아래 삭제:
```json
      {
        "command": "railway.loginWithCli",
        "title": "Import from Railway CLI",
        "category": "Railway"
      },
```

- [ ] **Step 2: `railway.oauthClientId` 설정 제거**

`contributes.configuration.properties`에서 아래 삭제:
```json
        "railway.oauthClientId": {
          "type": "string",
          "default": "",
          "description": "(Optional) OAuth Client ID from your Railway OAuth app. Create at: Workspace Settings > Developer > New OAuth App (type: Native, redirect URI: http://127.0.0.1:9876/callback). Not needed if using API Token."
        },
```

- [ ] **Step 3: `viewsWelcome` 내용 교체**

기존 `contents` 값을 교체:
```json
        "contents": "Railway에 로그인하여 프로젝트를 확인하세요.\n[Railway로 로그인](command:railway.login)\n[API 토큰 사용](command:railway.loginWithToken)\n\n토큰은 [railway.com/account/tokens](https://railway.com/account/tokens) 에서 발급하세요.",
```

- [ ] **Step 4: JSON 유효성 + 빌드 확인**

Run: `node -e "require('./package.json'); console.log('ok')"`
Expected: `ok` (JSON 파싱 성공).
Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add package.json
git commit -m "feat(auth): 매니페스트에서 CLI 임포트/OAuth앱 설정 제거, 로그인 안내 단순화"
```

---

### Task 8: 최종 검증 (Definition of Done)

**Files:** 없음(검증 전용).

- [ ] **Step 1: 전체 lint/test/build**

Run: `npm run lint`
Expected: PASS.
Run: `npm test`
Expected: 모든 테스트 PASS.
Run: `npm run build`
Expected: 빌드 성공.

- [ ] **Step 2: 수동 E2E — Device 로그인 (실제 브라우저)**

1. VS Code에서 F5(Extension Development Host) 실행.
2. Railway 뷰 → "Railway로 로그인" 클릭.
3. 브라우저가 `railway.com/activate?user_code=...`로 열리고, 알림에 코드 표시 + 클립보드 복사 확인.
4. 브라우저에서 승인.
5. 확인: 알림이 사라지고 트리에 워크스페이스/프로젝트가 표시됨.
6. 확인 사항(스펙 §3.3 미검증 항목): 승인 성공 시 토큰이 저장되고 이후 API 호출 성공.

- [ ] **Step 3: 수동 E2E — 자동 갱신**

- SecretStorage의 `railway.tokenExpiresAt`를 과거 값으로 만들거나, 임시로 `TOKEN_REFRESH_BUFFER_MS`를 크게 하여 만료 임박 상태를 유도.
- 트리 새로고침 시 **재로그인 없이** refresh가 일어나고 데이터가 갱신되는지 확인.

- [ ] **Step 4: 수동 E2E — 재시작 지속성 & API 토큰 폴백**

- Extension Host 재시작 후 로그인 상태 유지 확인.
- 로그아웃 후 "API 토큰 사용"으로 유효 토큰 입력 → 정상 동작 확인.

- [ ] **Step 5: 문서 갱신(README/CHANGELOG)**

- README의 인증 안내를 Device 로그인 중심으로 갱신, 기존 OAuth앱/CLI 임포트/MS 야매 방법 안내 제거 또는 대체.
- CHANGELOG에 이번 변경 기록.

- [ ] **Step 6: 커밋**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: device flow 인증으로 문서 갱신"
```

---

## Self-Review

- **Spec coverage:** §4 상수→Task1/5, §5.1 deviceFlow→Task2, §5.2 tokenStore→Task3, §5.3 railwayAuth→Task5, §5.3.1 sessionManager→Task4, §5.4 client→Task6, §5.5 extension→Task5/6, §5.6 package.json→Task7, §6 데이터흐름→Task5/6, §7 에러매트릭스→Task2(폴링/refresh)+Task6(401), §8 테스트→Task2/3/4/6, §9 DoD→Task8. 커버리지 갭 없음.
- **Placeholder scan:** TODO/TBD 없음. 모든 코드 스텝에 완전한 코드 포함.
- **Type consistency:** `TokenSet`/`DeviceCodeResponse`(deviceFlow) → sessionManager/railwayAuth에서 동일 사용. `getValidAccessToken`/`forceRefresh` 이름이 SessionManager 정의 및 client/extension 소비처에서 일치. `SecretStorageLike`가 tokenStore/sessionManager 테스트에서 동일 시그니처. `describeDeviceAuthError`/`DeviceAuthCancelled` export가 extension에서 소비. 불일치 없음.
