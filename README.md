# Railway Status

View your [Railway](https://railway.com) deployment statuses directly in VS Code.

## Features

- **Sidebar TreeView** — Browse Workspace > Project > Service hierarchy
- **Deployment Status** — See real-time status with icons (Success, Building, Failed, etc.)
- **OAuth Sign-in** — Authenticate via browser with Railway's OAuth 2.0
- **API Token Fallback** — Or paste an API token directly
- **Quick Actions** — Open in browser, copy service URL, refresh

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Click the Railway icon in the activity bar
3. Sign in with Railway OAuth or enter an API token

### OAuth Setup

To use OAuth sign-in, you need to register an OAuth app in your Railway workspace:

1. Go to your Railway workspace Settings > Developer
2. Create a new OAuth application
3. Set the redirect URI to `http://localhost` (the extension uses a random port)
4. Copy the Client ID
5. In VS Code settings, set `railwayStatus.oauthClientId` to your Client ID

### API Token

Alternatively, create a token at [railway.com/account/tokens](https://railway.com/account/tokens) and use the "Railway: Set API Token" command.

## Commands

| Command | Description |
|---------|-------------|
| Railway: Sign in with Railway | Start OAuth authentication |
| Railway: Set API Token | Enter an API token manually |
| Railway: Refresh | Reload deployment data |
| Railway: Open in Browser | Open project/service on railway.com |
| Railway: Copy Service URL | Copy the deployed URL |
| Railway: Sign Out | Clear stored credentials |

## License

MIT
