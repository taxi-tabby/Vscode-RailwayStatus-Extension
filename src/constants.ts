export const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
export const RAILWAY_CLI_LOGIN_URL = 'https://railway.com/cli-login';

export const SECRET_KEY_ACCESS_TOKEN = 'railway.accessToken';
export const SECRET_KEY_API_TOKEN = 'railway.apiToken';

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
