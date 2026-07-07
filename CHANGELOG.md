# Changelog

## 0.5.1

### Changed
- All user-facing strings are now in English for consistency.

### Removed
- The linked-project "Railway environment terminal" (env-injected terminal) action — low value.

### Fixed
- SSH now checks the target service is running first. It blocks with a clear message when the service is sleeping or has no running instance (SSH is only reachable while the service is running).

## 0.5.0

### Added
- **Linked project actions** — after linking a project you can (service/environment are chosen and remembered per action):
  - **Railway environment terminal** — open a VS Code terminal with the linked service/environment variables injected, to run your local app against Railway config (`railway shell` equivalent, no CLI required). *(Removed in 0.5.1.)*
  - **SSH** — run `railway ssh` for the linked project/service/environment via the railway CLI (install guide shown if missing).
  - **Status bar + quick actions** — the linked project shows in the status bar; clicking it opens a quick menu (SSH / variables / .env export / dashboard / change target / unlink).
  - **One-touch `.env` export** for the linked service.
- Added terminal/SSH/export/change-target items to the linked project node's context menu.

### Changed
- Extracted the `.env` formatting into a shared `formatDotEnv` util.

## 0.4.0

### Changed
- **Unified authentication on the Device Authorization Grant (RFC 8628)** — a native, in-extension implementation of the same browser device login as `railway login --browserless`. No railway CLI install and no OAuth app registration required.
- Reduced sign-in to two methods: **device login (default) + manual API token (fallback)**.

### Fixed
- **Fixed sessions repeatedly dropping** — the `offline_access` scope yields a refresh token, so the access token is renewed automatically ~60s before expiry and force-refreshed + retried on API 401. Sessions now survive VS Code restarts.
- Signing in through the real browser (railway.com) also resolves the Microsoft-account SSO sign-in issue.

### Removed
- The OAuth-app method (`railway.oauthClientId` setting) and the local callback server (port 9876).
- "Import from Railway CLI" (`~/.railway/config.json` import) — replaced by native device login.

## 0.3.0

### Added
- **Import from Railway CLI** — One-click import of credentials from `~/.railway/config.json`
- **Environment variable editor** — Full CRUD Webview panel with add/modify/delete, value masking toggle, and batch "Apply Changes" with confirmation
- **Interactive service detail panel** — Redeploy, Restart, View Logs, Edit Variables buttons directly in the panel; per-deployment log viewing
- **Inline tree view actions** — Redeploy, Logs, Open icons directly on service nodes; Open Dashboard on project nodes
- **Token validation** — API tokens and CLI tokens are verified against Railway API before saving

### Changed
- API Token is now the primary recommended sign-in method
- OAuth prompt now offers all 3 alternatives (API Token, CLI Import, OAuth setup)
- Welcome view shows all 3 sign-in options with clear descriptions

### Fixed
- Robust error handling for all auth flows (expired CLI tokens, invalid API tokens, port conflicts, network errors)
- OAuth callback server now handles `EADDRINUSE` gracefully
- Timeout cleanup improved (timer cleared on auth completion)

## 0.2.1

### Fixed
- OAuth now uses user-registered Railway OAuth app instead of CLI-only Client ID
- Fixed port 9876 for OAuth callback to match registered redirect URI

### Changed
- Added `railway.oauthClientId` setting for user's own OAuth app Client ID
- Show setup guide when OAuth Client ID is not configured

## 0.2.0

### Fixed
- OAuth login now uses Railway's official OAuth 2.0 + PKCE flow (matching the CLI), fixing "Error logging in to CLI" issue

### Added
- **Environment level in tree view** — 4-tier hierarchy: Workspace > Project > Environment > Service (Production sorted first)
- **Status bar item** — Shows deploying/failed/running counts at a glance, color-coded background
- **Deployment notifications** — Toast alerts on deploy success/failure (configurable via `railway.notifications`)
- **Redeploy / Restart** — Context menu actions on service nodes with confirmation dialog
- **Log viewer** — View build and runtime logs in a VS Code Output Channel
- **Service detail panel** — Click a service to open a Webview with deployment history and environment variables
- **Environment variable management** — View, copy, add variables, and export to `.env` file
- **Project linking** — Pin a Railway project to the current VS Code workspace (persisted per workspace)
- **Persistent settings** — Sort mode is now saved across restarts

## 0.1.0

- Initial release
- OAuth 2.0 + PKCE authentication
- API token fallback authentication
- Sidebar TreeView with Workspace > Project > Service hierarchy
- Deployment status icons
- Refresh, Open in Browser, Copy URL commands
