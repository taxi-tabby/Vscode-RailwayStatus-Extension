# Railway 인증 단일화 — OAuth Device Authorization Flow

- 날짜: 2026-07-07
- 상태: 설계 확정(사용자 승인) / 구현 계획 대기
- 대상: `Vscode-RailwayStatus-Extension`

## 1. 배경 & 문제 정의

현재 확장은 인증 수단이 3가지로 파편화되어 있다.

1. **OAuth (authorization_code + PKCE)** — 사용자가 직접 Railway OAuth 앱을 등록하고 `railway.oauthClientId` 설정을 채워야 함. 로컬 콜백 HTTP 서버(`127.0.0.1:9876/callback`) 사용.
2. **API 토큰 수동 입력** — `railway.com/account/tokens`에서 만든 토큰을 붙여넣기.
3. **CLI config 임포트** — `~/.railway/config.json`의 토큰을 읽어옴.

### 근본 원인: "인증이 계속 풀림"

`RailwayAuthProvider.createSession()`(OAuth)와 `loginWithCli()`(CLI 임포트) 모두 **만료되는 `access_token`만 저장하고 `refresh_token`을 저장/사용하지 않는다.** Railway access token이 만료되면 API가 401을 반환하고(`src/api/client.ts`의 `onAuthFailure`), 갱신 수단이 없어 세션이 끊긴 뒤 재로그인을 요구한다. 이것이 "인증이 계속 풀리는" 직접 원인이다.

부수적으로, OAuth 앱 등록 요구와 로컬 콜백 서버 방식은 Microsoft 계정 SSO 등에서 문제가 있었다(git 이력: "ms 인증 문제").

## 2. 목표 / 비목표

**목표**
- `railway login --browserless`의 실제 방식인 **OAuth 2.0 Device Authorization Grant (RFC 8628)**를 확장 내부에 **네이티브 재구현**한다(외부 `railway` CLI 의존성 없음).
- `offline_access` 스코프로 **refresh token**을 받아, 만료 임박 시 자동 갱신하고 401 시 강제 갱신 후 재시도한다 → 세션이 끊기지 않음.
- 인증을 **Device 로그인(기본) + 수동 API 토큰(폴백)** 2가지로 단일화한다.

**비목표**
- SSH 키, 2FA, 프로젝트 링크(`RAILWAY_TOKEN`) 등 CLI의 다른 기능은 다루지 않음.
- 기존에 저장된 API 토큰 사용자의 동작 변경 없음(그대로 유지).

## 3. 프로덕션 검증 결과 (구현 전 실측)

설계의 핵심 가정을 실제 Railway 프로덕션 엔드포인트로 검증했다(2026-07-07, 인증 불필요·비파괴적 호출).

### 3.1 Device code 요청

```
POST https://backboard.railway.com/oauth/device/auth
Content-Type: application/x-www-form-urlencoded
client_id=rlwy_oaci_onEklvmksh1hRUiCo7E2zX12
scope=openid email profile offline_access workspace:admin project:admin ssh_keys
```
→ `200 OK`
```json
{
  "device_code": "OujT63TKZKso-Zki_IzS7li16JJCzv2GoaQeHm6qjvG",
  "user_code": "KGSK-TFWD",
  "verification_uri": "https://railway.com/activate",
  "verification_uri_complete": "https://railway.com/activate?user_code=KGSK-TFWD",
  "expires_in": 600
}
```

**실측으로 확정된 사실**
- 응답에 **`interval` 필드가 없다** → 폴링 기본 간격을 **5초**로 하드코딩해야 한다(RFC 8628 권고 및 CLI 기본값).
- `verification_uri`는 `https://railway.com/activate`, `verification_uri_complete`는 `?user_code=` 쿼리 포함.
- `expires_in`은 600초(10분).

### 3.2 토큰 폴링 (미승인 상태)

```
POST https://backboard.railway.com/oauth/token
Content-Type: application/x-www-form-urlencoded
grant_type=urn:ietf:params:oauth:grant-type:device_code
device_code=<위 device_code>
client_id=rlwy_oaci_onEklvmksh1hRUiCo7E2zX12
```
→ `400 Bad Request`
```json
{"error":"authorization_pending","error_description":"authorization request is still pending as the end-user hasn't yet completed the user interaction steps"}
```

**확정된 사실**: 미승인 시 **HTTP 400 + `error: "authorization_pending"`**. 폴링은 이 에러에서 계속 진행해야 한다(HTTP status가 아니라 body의 `error` 필드로 분기).

### 3.3 미검증 항목(대화형 승인 필요 → 구현 시 수동 확인)
- 승인 완료 시 200 응답의 정확한 필드(`access_token`, `refresh_token`, `expires_in`, `token_type`).
- `slow_down`, `access_denied`, `expired_token` 실제 발생 케이스.
- refresh_token grant 응답.

→ RFC 8628 표준과 Railway CLI 소스(`src/oauth.rs`)를 근거로 구현하되, **구현 후 실제 브라우저 승인으로 end-to-end 1회 검증**을 완료 기준에 포함한다(§9).

## 4. 상수 변경 (`src/constants.ts`)

추가:
```ts
export const RAILWAY_OAUTH_DEVICE_AUTH_URL = 'https://backboard.railway.com/oauth/device/auth';
export const RAILWAY_OAUTH_CLIENT_ID =
  process.env.RAILWAY_OAUTH_CLIENT_ID?.trim() || 'rlwy_oaci_onEklvmksh1hRUiCo7E2zX12';
export const RAILWAY_OAUTH_SCOPES =
  'openid email profile offline_access workspace:admin project:admin ssh_keys';
export const RAILWAY_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
export const RAILWAY_REFRESH_GRANT_TYPE = 'refresh_token';
export const DEVICE_POLL_DEFAULT_INTERVAL_MS = 5_000;
export const DEVICE_POLL_SLOW_DOWN_STEP_MS = 5_000;
export const TOKEN_REFRESH_BUFFER_MS = 60_000; // 만료 60초 전 선제 갱신

export const SECRET_KEY_REFRESH_TOKEN = 'railway.refreshToken';
export const SECRET_KEY_TOKEN_EXPIRES_AT = 'railway.tokenExpiresAt';
```
`RAILWAY_OAUTH_TOKEN_URL`(`https://backboard.railway.com/oauth/token`)는 유지.

제거:
```ts
RAILWAY_OAUTH_AUTH_URL      // authorization_code 방식 폐기
OAUTH_CALLBACK_PORT         // 로컬 콜백 서버 불필요
OAUTH_CALLBACK_PATH
RAILWAY_OAUTH_SCOPES = 'openid'   // 위의 확장 스코프로 대체
```

## 5. 컴포넌트 설계

### 5.1 `src/auth/deviceFlow.ts` (신규) — 순수 프로토콜 계층

VS Code API에 의존하지 않는 순수 함수 모듈. `fetch`만 사용하여 단위 테스트가 쉽다.

```ts
export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  intervalMs: number;   // 응답에 interval 없으면 DEVICE_POLL_DEFAULT_INTERVAL_MS
  expiresInMs: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;    // Date.now() + expires_in*1000 (ms epoch)
}

// POST /oauth/device/auth
export async function requestDeviceCode(): Promise<DeviceCodeResponse>;

// POST /oauth/token (device_code grant), interval 폴링, signal로 취소
export async function pollForToken(
  deviceCode: string, intervalMs: number, expiresAt: number, signal: AbortSignal,
): Promise<TokenSet>;

// POST /oauth/token (refresh_token grant)
export async function refreshAccessToken(refreshToken: string): Promise<TokenSet>;
```

**폴링 규칙** (body의 `error` 필드 기준):
- `authorization_pending` → `intervalMs` 대기 후 재시도.
- `slow_down` → `intervalMs += DEVICE_POLL_SLOW_DOWN_STEP_MS` 후 재시도.
- `access_denied` → `DeviceAuthError('access_denied')` throw.
- `expired_token` 또는 `Date.now() >= expiresAt` → `DeviceAuthError('expired_token')` throw.
- 200 → `TokenSet` 반환.
- `signal.aborted` → `DeviceAuthCancelled` throw.

에러는 코드 분기가 가능하도록 `DeviceAuthError { code: 'access_denied' | 'expired_token' | 'invalid_grant' | 'network' | 'unknown' }` 형태의 판별 가능한 타입으로 던진다.

### 5.2 `src/auth/tokenStore.ts` (확장)

```ts
async storeOAuthTokens(t: { accessToken: string; refreshToken?: string; expiresAt: number }): Promise<void>;
async getRefreshToken(): Promise<string | undefined>;
async getExpiresAt(): Promise<number | undefined>;   // 저장은 문자열, 파싱해서 number 반환
// 기존: getAccessToken, getApiToken, storeAccessToken, storeApiToken, hasAnyToken
// clearAll(): 신규 키(refreshToken, tokenExpiresAt)까지 삭제하도록 수정
```
`storeApiToken`/`getApiToken`은 그대로(폴백 유지). API 토큰 저장 시에는 refresh/expiresAt를 쓰지 않는다.

### 5.3 `src/auth/railwayAuth.ts` (재작성)

`RailwayAuthProvider`는 VS Code AuthenticationProvider + UI 오케스트레이션만 담당하고, 프로토콜은 `deviceFlow.ts`에 위임한다.

- `createSession()`:
  1. `requestDeviceCode()`.
  2. `vscode.env.clipboard.writeText(userCode)` + `vscode.env.openExternal(verificationUriComplete ?? verificationUri)`.
  3. `vscode.window.withProgress({ location: Notification, cancellable: true }, ...)`로 "브라우저에서 `KGSK-TFWD` 코드를 승인하세요" 표시. 취소 토큰 → `AbortController`.
  4. `pollForToken(...)` 완료 → `tokenStore.storeOAuthTokens(...)` → `onDidChangeSessions.fire({added:[session]})` → session 반환.
  5. 실패(만료/거부/취소)는 §7 규칙대로 안내.
- `getValidAccessToken(now = Date.now): Promise<string | undefined>` — **중앙 접근자**:
  1. OAuth access token 있고 `expiresAt - now > TOKEN_REFRESH_BUFFER_MS` → 그대로 반환.
  2. 만료 임박/만료 + refresh token 있음 → `refreshAccessToken()` → 저장 → 새 access token 반환. (동시 호출 중복 갱신 방지를 위해 in-flight refresh Promise를 캐시.)
  3. refresh 실패가 `invalid_grant` → OAuth 토큰 clear, `undefined` 반환. 네트워크 오류 → 기존 토큰 유지하고 그대로 반환(세션 보존).
  4. OAuth 토큰 없음 → API 토큰 반환(없으면 `undefined`).
- `forceRefresh(): Promise<string | undefined>` — 버퍼와 무관하게 refresh token으로 강제 갱신(API 401 대응용). refresh token 없음/`invalid_grant` → OAuth 토큰 clear 후 `undefined`. 네트워크 오류 → `undefined`(재시도는 호출측 판단). `getValidAccessToken`과 동일한 in-flight Promise 캐시를 공유해 중복 갱신을 막는다.
- `getSessions()` — `getValidAccessToken()` 결과로 세션 구성(없으면 `[]`).
- `loginWithToken()` — 기존 유지(검증 후 `storeApiToken`).
- `removeSession()` / logout — `tokenStore.clearAll()`.

**제거**: `startCallbackServer`, `exchangeCodeForToken`, PKCE 유틸(`generateCodeVerifier/Challenge/State`), `getClientId`, `promptOAuthSetup`, `loginWithCli`, 콜백 HTML 유틸.

### 5.4 `src/api/client.ts` (조정)

생성자 옵션 변경:
```ts
{
  getToken: () => Promise<string | undefined>;        // = authProvider.getValidAccessToken
  forceRefresh: () => Promise<string | undefined>;    // = authProvider.forceRefresh (invalid 시 undefined)
  onAuthFailure: () => void;
}
```
`request()` 흐름:
1. `token = await getToken()`; 없으면 `Not authenticated` throw.
2. 401 → `newToken = await forceRefresh()`; `newToken` 있으면 그 토큰으로 **1회 재시도**.
3. 재시도도 401 또는 `forceRefresh`가 `undefined` → `onAuthFailure()` 후 `Authentication expired` throw.

### 5.5 `src/extension.ts` (조정)

- `apiClient`를 `authProvider.getValidAccessToken` / `authProvider.forceRefresh`에 연결.
- `railway.loginWithCli` 명령 등록 제거.
- `onAuthFailure`: "Railway 세션이 만료되었습니다. 다시 로그인" → `railway.login`(기존 유지).
- activate 시 `hasAnyToken`으로 컨텍스트 설정(기존 유지). 최초 refresh는 첫 API 호출에서 지연 수행.

### 5.6 `package.json` (매니페스트)

- `commands`에서 `railway.loginWithCli` 제거.
- `configuration`에서 `railway.oauthClientId` 제거.
- `viewsWelcome` 내용 교체:
  ```
  Sign in to Railway to view your projects.
  [Sign in with Railway](command:railway.login)
  [Use API Token](command:railway.loginWithToken)
  ```
- `railway.login` title: "Sign in with Railway"(유지). `railway.loginWithToken` title: "Use API Token".

## 6. 데이터 흐름

**로그인(Device):** 사용자가 "Sign in with Railway" → `createSession` → `/oauth/device/auth` → 코드 표시 + 클립보드 복사 + 브라우저 오픈 → 사용자가 railway.com/activate에서 승인(Google/MS/GitHub SSO는 Railway가 처리) → 폴링 200 → `storeOAuthTokens` → 트리 갱신.

**정상 유지("이어서 인증"):** 모든 API 호출은 `getValidAccessToken`을 거친다. 만료 60초 전이면 조용히 refresh하여 세션 무중단. VS Code 재시작 후에도 SecretStorage에서 access/refresh/expiresAt 복원 → 필요 시 refresh. refresh_token 자체가 무효(`invalid_grant`)일 때만 재로그인 유도.

## 7. 에러 처리 매트릭스

| 단계 | 조건 | 처리 |
|---|---|---|
| device code 요청 | 네트워크/4xx/5xx | 오류 메시지 표시, 로그인 중단 |
| 폴링 | `authorization_pending` | interval 대기 후 계속 |
| 폴링 | `slow_down` | interval += 5s 후 계속 |
| 폴링 | `access_denied` | "로그인이 거부되었습니다" |
| 폴링 | `expired_token`/시간초과 | "코드가 만료되었습니다. 다시 시도하세요" |
| 폴링 | 사용자 취소 | 조용히 중단(에러 토스트 없음) |
| refresh | `invalid_grant` | OAuth 토큰 clear → `onAuthFailure`(재로그인 유도) |
| refresh | 네트워크 오류 | **기존 토큰 유지**(세션 날리지 않음), 다음 호출에서 재시도 |
| API 호출 | 401 | forceRefresh 1회 → 재시도 → 실패 시 `onAuthFailure` |

## 8. 테스트 계획 (vitest)

- `deviceFlow.spec.ts` (fetch 목킹):
  - `requestDeviceCode`: §3.1 실측 응답(특히 `interval` 없음 → 5s 기본) 파싱 검증.
  - `pollForToken`: `authorization_pending`(§3.2 실측) → 200 성공 시퀀스, `slow_down` 시 interval 증가, `access_denied`/`expired_token` throw, `expiresAt` 초과 시 throw, `AbortSignal` 취소 throw.
  - `refreshAccessToken`: 200 성공, `invalid_grant` → 판별 가능한 에러.
- `tokenStore.spec.ts`: OAuth 토큰셋 저장/조회/삭제(+`expiresAt` 숫자 파싱), API 토큰, `clearAll`이 신규 키까지 삭제, `hasAnyToken`.
- `getValidAccessToken`: 주입한 `now()`로 (a) 유효→그대로 (b) 만료임박+refresh→갱신 (c) `invalid_grant`→clear+undefined (d) 네트워크오류→기존 유지 (e) OAuth 없음→API 토큰 폴백, 각 분기 검증. 동시 호출 시 refresh 1회만 수행.
- 시간·`fetch`는 주입/목킹으로 결정적 테스트 유지(스크립트가 아닌 확장 런타임이므로 `Date.now()` 사용 가능).

## 9. 완료 기준 (Definition of Done) — "인증이 제대로 동작해야 함"

1. `npm run lint`(tsc noEmit) 통과, `npm test`(vitest) 전부 통과.
2. 확장 실행(F5) 후 "Sign in with Railway"로 **실제 브라우저 승인 → 로그인 성공 → 트리에 프로젝트 표시** end-to-end 1회 성공(§3.3 미검증 항목 실측 확인 포함).
3. access token 만료 시나리오에서 **재로그인 없이 자동 refresh**로 API 호출이 이어짐을 확인(만료 시각을 과거로 조작하거나 짧은 만료로 검증).
4. VS Code 재시작 후 세션이 유지됨(SecretStorage 복원 + 필요 시 refresh).
5. API 토큰 폴백 경로가 여전히 동작.

## 10. 마이그레이션 / 호환성

- 기존 `railway.accessToken`(refresh 없음) 보유자: 만료 시 401 → `onAuthFailure` → Device 로그인 1회 → 이후 자동 유지. (일회성 재로그인, 허용 가능.)
- 기존 API 토큰 보유자: 변화 없음.
- `railway.oauthClientId` 설정을 채워둔 사용자: 설정이 제거되지만 무해(무시됨).

## 11. 보안

- Device flow는 **public client**(secret 없음) 방식으로, `client_id`는 Railway 공개 CLI 클라이언트다. 확장에 하드코딩해도 안전(민감정보 아님).
- 모든 토큰은 VS Code `SecretStorage`(OS 키체인)에 저장. 평문 파일 저장 없음.
- refresh token은 access token과 동일한 SecretStorage에 보관, `clearAll`/logout 시 함께 삭제.
