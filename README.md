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

Three sign-in methods are available. All tokens are validated before saving.

### API Token (simplest)

1. Go to [railway.com/account/tokens](https://railway.com/account/tokens)
2. Create a new token
3. In VS Code, click **"Use API Token"** and paste it

### Import from Railway CLI

If you have the [Railway CLI](https://docs.railway.com/guides/cli) installed and logged in:

1. Run `railway login` in your terminal (if not already logged in)
2. In VS Code, click **"Import from Railway CLI"**
3. The extension reads `~/.railway/config.json` automatically

### OAuth (advanced)

Requires registering an OAuth app in Railway:

1. Go to [railway.com/workspace/developer](https://railway.com/workspace/developer)
2. Click **New OAuth App**
   - Type: **Native**
   - Redirect URI: `http://127.0.0.1:9876/callback`
3. Copy the **Client ID**
4. In VS Code settings, set `railway.oauthClientId` to the Client ID
5. Click **"Sign in with OAuth"**

## Commands

| Command | Description |
|---------|-------------|
| Railway: Set API Token | Enter an API token manually |
| Railway: Import from Railway CLI | Import credentials from CLI config |
| Railway: Sign in with OAuth | Start OAuth authentication (requires setup) |
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
| `railway.oauthClientId` | | (Optional) OAuth Client ID for OAuth sign-in |
| `railway.autoRefresh` | `true` | Auto-refresh deployment statuses for expanded projects |
| `railway.autoRefreshActiveInterval` | `10` | Polling interval (seconds) during active deployments |
| `railway.autoRefreshIdleInterval` | `30` | Polling interval (seconds) when stable |
| `railway.notifications` | `true` | Show notifications on deployment status changes |

## License

MIT
