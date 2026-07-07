export const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2';

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

export const POLLING_ACTIVE_INTERVAL = 10_000;  // 10s
export const POLLING_IDLE_INTERVAL = 30_000;    // 30s

export const ACTIVE_DEPLOYMENT_STATUSES = new Set([
  'BUILDING', 'DEPLOYING', 'INITIALIZING', 'QUEUED',
  'WAITING', 'NEEDS_APPROVAL', 'REMOVING',
]);

export const STATUS_ICONS: Record<string, string> = {
  SUCCESS: 'pass-filled',
  BUILDING: 'sync~spin',
  DEPLOYING: 'rocket',
  FAILED: 'error',
  CRASHED: 'warning',
  SLEEPING: 'debug-pause',
  QUEUED: 'watch',
  REMOVED: 'trash',
  REMOVING: 'trash',
  INITIALIZING: 'loading~spin',
  WAITING: 'watch',
  SKIPPED: 'debug-step-over',
  NEEDS_APPROVAL: 'bell',
};
