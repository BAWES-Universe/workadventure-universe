# Admin API Extension Module

This extension module integrates your Admin API with WorkAdventure. It automatically opens a modal with your Admin API dashboard after authentication and adds a button to reopen it.

## Features

-   **Automatic Modal Opening**: Opens your Admin API dashboard in a modal after user authentication
-   **Action Bar Button**: Adds a button to the action bar apps menu to reopen the dashboard
-   **Unified Authentication**: Uses the same OIDC access token from WorkAdventure authentication
-   **No External Scripts Required**: Everything is self-contained in the extension module

## Setup

### 1. Register the Module

In your Admin API's `/api/room/access` response, include the module in the metadata:

```typescript
{
    // ... other response fields
    metadata: {
        modules: ["admin-api"]; // This matches the folder name
    }
}
```

### 2. Configure Environment Variable

Set the `ADMIN_URL` environment variable in WorkAdventure to point to your Admin API dashboard URL:

```bash
ADMIN_URL=https://your-admin-api.com
```

This URL should be the base URL of your Admin API (where your dashboard is hosted).

### 3. Admin API Dashboard Endpoint

Your Admin API should have an `/admin/login` endpoint that:

1. Sends an `orbit-auth-ready-v2` message to the exact WorkAdventure origin
2. Accepts an `orbit-auth-token-v2` response only from that origin and the parent window
3. Verifies the OIDC access token with your OIDC provider
4. Exchanges it for an opaque, server-backed admin session
5. Displays the dashboard interface

Example endpoint:

```
GET /admin/login?playUri=<room_url>
```

### 4. Session Management

Your Admin API should:

-   Verify the OIDC access token on first load
-   Create an opaque server-backed session and keep its ID in sessionStorage
-   Allow users to reopen the modal without re-authenticating
-   Handle token refresh if needed

## How It Works

1. **User Authentication**: When a user authenticates in WorkAdventure, the extension module is initialized
2. **Token Extraction**: The module extracts the OIDC access token from the JWT stored in localStorage
3. **Modal Opening**: After a short delay (1.5s), the module automatically opens a modal with your Admin API dashboard
4. **Button Addition**: A button is added to the action bar apps menu
5. **Reopening**: Users can click the button to reopen the modal at any time

## Technical Details

### Token Flow

1. User authenticates via OIDC in WorkAdventure
2. WorkAdventure stores a JWT token in localStorage containing the OIDC `accessToken` in its payload
3. The extension module parses the JWT to extract the `accessToken`
4. The iframe requests authentication with a one-time nonce using `postMessage`
5. WorkAdventure returns the token only to the configured admin origin
6. Your Admin API verifies the token and creates an opaque session

The OIDC token is never put in the iframe URL, browser history, or referrer.

### Modal Configuration

The modal is configured with:

-   **Position**: Center of the screen
-   **Fullscreen**: Enabled
-   **API Access**: Enabled (allows the iframe to use WorkAdventure scripting API)
-   **Permissions**: Fullscreen allowed

### Button Location

The button is added to the `actionBarAppsMenu` zone, which appears in the apps menu of the action bar.

## Customization

### Changing Button Appearance

The button is removed from the apps menu. The Orbit button in the main action bar is the only access point for the admin dashboard.

### Changing Modal Behavior

Modify the `openAdminModal` function in `index.ts` to:

-   Change the modal position (`center`, `left`, `right`)
-   Adjust the auto-open delay
-   Modify the dashboard URL structure

### Disabling Auto-Open

To disable automatic modal opening, remove or comment out the `setTimeout` call in `initializeAdminIntegration`:

```typescript
// Auto-open after a short delay
// setTimeout(() => {
//     openAdminModal(options);
// }, 1500);
```

## Troubleshooting

### Modal Doesn't Open

-   Check that `ADMIN_URL` is set correctly
-   Verify the user is authenticated (`localUserStore.isLogged()`)
-   Check browser console for errors
-   Ensure the OIDC access token is present in the JWT

### Button Doesn't Appear

-   Verify the module is registered in your Admin API's metadata
-   Check that the user is authenticated
-   Look for errors in the browser console

### Token Issues

-   Ensure your OIDC provider is configured correctly
-   Verify the token is being extracted from the JWT payload
-   Check that your Admin API can verify the token

## Files

-   `index.ts` - Main extension module implementation
-   `iframeAuth.ts` - Versioned iframe handshake validation and URL construction
-   `README.md` - This documentation

## Notes

-   The extension module uses WorkAdventure's internal APIs directly
-   No external scripts need to be hosted
-   The module is self-contained and won't interfere with upstream WorkAdventure updates
-   The `admin-api` folder is tracked in git (not ignored) so you can version control your customizations
