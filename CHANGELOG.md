# Changelog

## 0.4.0

### Changed
- **인증을 Device Authorization Grant(RFC 8628)로 단일화** — `railway login --browserless`와 동일한 브라우저 device 로그인을 확장 내부에 네이티브 구현. Railway CLI 설치나 OAuth 앱 등록이 필요 없음.
- 인증 수단을 **Device 로그인(기본) + 수동 API 토큰(폴백)** 두 가지로 정리.

### Fixed
- **"인증이 계속 풀리는" 문제 해결** — `offline_access` 스코프로 refresh token을 저장하고, 만료 60초 전 자동 갱신 + API 401 시 강제 갱신 후 재시도. 세션이 VS Code 재시작 후에도 유지됨.
- 브라우저(railway.com)에서 직접 로그인하므로 Microsoft 계정 SSO 인증 문제도 해소.

### Removed
- OAuth 앱 등록 방식(`railway.oauthClientId` 설정)과 로컬 콜백 서버(포트 9876) 제거.
- "Import from Railway CLI"(`~/.railway/config.json` 임포트) 방식 제거 — 네이티브 device 로그인으로 대체.

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
