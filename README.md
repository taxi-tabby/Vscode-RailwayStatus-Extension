# Railway Status

View your [Railway](https://railway.com) deployment statuses directly in VS Code.

## Features

- **4-tier Tree View** — Workspace > Project > Environment > Service hierarchy
- **Deployment Status** — Real-time status icons (Success, Building, Failed, Crashed, etc.)
- **Status Bar** — At-a-glance deploying/failed/running counts with color-coded background
- **Deployment Notifications** — Toast alerts when deployments succeed or fail
- **Redeploy / Restart** — Right-click a service to redeploy or restart
- **Log Viewer** — View build and runtime logs in a VS Code Output Channel
- **Service Detail Panel** — Click a service to see deployment history and environment variables
- **Environment Variables** — View, copy, add variables, or export to `.env` file
- **Project Linking** — Pin a Railway project to your VS Code workspace
- **OAuth Sign-in** — Authenticate via browser using Railway's OAuth 2.0 + PKCE
- **API Token Fallback** — Or paste an API token directly
- **Persistent Settings** — Sort mode and linked project survive restarts

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Click the Railway icon in the activity bar
3. Sign in with Railway OAuth or enter an API token
4. Expand a workspace to browse your projects

### Authentication

**OAuth (recommended)** — Click "Sign in with Railway". A browser window opens for Railway's OAuth flow. No extra setup needed.

**API Token** — Create a token at [railway.com/account/tokens](https://railway.com/account/tokens) and use the "Railway: Set API Token" command.

## Commands

| Command | Description |
|---------|-------------|
| Railway: Sign in with Railway | Start OAuth authentication |
| Railway: Set API Token | Enter an API token manually |
| Railway: Refresh | Reload deployment data |
| Railway: Open in Browser | Open project/service on railway.com |
| Railway: Copy Service URL | Copy the deployed URL |
| Railway: Redeploy | Redeploy the latest deployment |
| Railway: Restart | Restart the current deployment |
| Railway: View Logs | Show build/runtime logs in Output Channel |
| Railway: View Variables | Browse and copy environment variables |
| Railway: Add Variable | Add a new environment variable |
| Railway: Export .env File | Export variables to a `.env` file |
| Railway: Link to Workspace | Pin a project to the current VS Code workspace |
| Railway: Unlink Project | Remove the project pin |
| Railway: Sort By... | Sort projects/services by name, created, or updated |
| Railway: Sign Out | Clear stored credentials |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `railway.autoRefresh` | `true` | Auto-refresh deployment statuses for expanded projects |
| `railway.autoRefreshActiveInterval` | `10` | Polling interval (seconds) during active deployments |
| `railway.autoRefreshIdleInterval` | `30` | Polling interval (seconds) when stable |
| `railway.notifications` | `true` | Show notifications on deployment status changes |

## License

MIT
