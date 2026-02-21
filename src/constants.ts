export const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
export const RAILWAY_OAUTH_AUTH_URL = 'https://backboard.railway.com/oauth/auth';
export const RAILWAY_OAUTH_TOKEN_URL = 'https://backboard.railway.com/oauth/token';

export const OAUTH_SCOPES = 'openid email profile offline_access';
export const OAUTH_CALLBACK_PATH = '/callback';

export const SECRET_KEY_ACCESS_TOKEN = 'railway.accessToken';
export const SECRET_KEY_REFRESH_TOKEN = 'railway.refreshToken';
export const SECRET_KEY_API_TOKEN = 'railway.apiToken';
export const SECRET_KEY_TOKEN_EXPIRES_AT = 'railway.tokenExpiresAt';

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
