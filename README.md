# Railway Status

View and manage your [Railway](https://railway.com) deployments directly in VS Code.

## Features

- **4-tier Tree View** — Workspace > Project > Environment > Service hierarchy
- **Deployment Status** — Real-time status icons (Success, Building, Failed, Crashed, etc.)
- **Status Bar** — At-a-glance deploying/failed/running counts with color-coded background
- **Deployment Notifications** — Toast alerts when deployments succeed or fail
- **Redeploy / Restart** — Inline buttons and context menu with confirmation dialogs
- **Log Viewer** — View build and runtime logs in a VS Code Output Channel
- **Service Detail Panel** — Click a service to see deployment history with action buttons
- **Environment Variable Editor** — Full add/modify/delete with value masking and batch apply
- **Export .env** — Export environment variables to a `.env` file
- **Project Linking** — Pin a Railway project to your VS Code workspace
- **Persistent Settings** — Sort mode and linked project survive restarts

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Click the Railway icon in the activity bar
3. Choose a sign-in method (see below)
4. Expand a workspace to browse your projects

## Authentication

Two sign-in methods are available. OAuth sessions are refreshed automatically, so you stay signed in without re-authenticating.

### Sign in with Railway (recommended)

Browser-based device login using the OAuth 2.0 Device Authorization Grant — the same flow as `railway login --browserless`. No Railway CLI install and no OAuth app registration required.

1. Click **"Sign in with Railway"**
2. Your browser opens to `railway.com/activate` with the pairing code pre-filled (the code is also copied to your clipboard)
3. Approve in the browser — Google / Microsoft / GitHub SSO are all handled by Railway
4. VS Code receives the token and keeps the session alive: the access token is refreshed automatically before it expires (via a stored refresh token), and it survives VS Code restarts

If a session ever becomes unrecoverable (refresh token revoked), you'll be prompted to sign in again with a single click.

### API Token (fallback)

For restricted networks or automation where the browser flow isn't usable:

1. Go to [railway.com/account/tokens](https://railway.com/account/tokens)
2. Create a new token
3. In VS Code, click **"Use API Token"** and paste it

## Commands

| Command | Description |
|---------|-------------|
| Railway: Sign in with Railway | Browser device login (recommended) |
| Railway: Set API Token | Enter an API token manually (fallback) |
| Railway: Refresh | Reload deployment data |
| Railway: Redeploy | Redeploy the latest deployment |
| Railway: Restart | Restart the current deployment |
| Railway: View Logs | Show build/runtime logs in Output Channel |
| Railway: View Variables | Open environment variable editor |
| Railway: Export .env File | Export variables to a `.env` file |
| Railway: Open in Browser | Open project/service on railway.com |
| Railway: Copy Service URL | Copy the deployed URL |
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
