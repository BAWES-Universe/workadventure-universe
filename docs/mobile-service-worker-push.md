# Mobile service worker push and update handling

This document covers the web/PWA slice of the BAWES Universe mobile bounty. It is scoped to the site service worker at `play/public/service-worker.js` and does not add native Android/iOS credentials or backend delivery storage.

Universe now has one worker for the whole site. The old prod, dev, and notification workers are gone, and this worker does not cache the game. Chat notification clicks still focus the open tab and open that chat.

## What is covered

- New service workers activate immediately with `self.skipWaiting()`.
- Activated workers call `clients.claim()` so open tabs are controlled without waiting for a full browser restart.
- The page can send `{ type: "SKIP_WAITING" }` to the worker when a future UI wants to trigger immediate activation.
- Web push payloads are read once as text, parsed as JSON when possible, and otherwise shown as the text body.
- Notifications use safe defaults for title, icon, badge, tag, and same-origin target URL.
- A push notification click closes the notification, focuses an existing matching Universe tab when possible, or opens the target URL.
- A chat notification click still focuses the tab that raised it (or the first open tab) and posts `openChat` on the `message` channel.

## Expected push payload

```json
{
  "title": "BAWES Universe",
  "body": "A new event is waiting for you.",
  "url": "https://universe.bawes.net/",
  "icon": "/static/images/favicons/favicon-96x96.png",
  "badge": "/static/images/favicons/favicon-96x96.png",
  "tag": "bawes-universe"
}
```

Only `body` is required for useful output. Missing optional fields fall back to Universe defaults.
External notification URLs are intentionally ignored and fall back to the Universe origin.

## What remains for native/server work

- Store browser/native push subscriptions or FCM/APNs tokens per authenticated user.
- Add a protected server-side send endpoint for admin, bot, or room event triggers.
- Add native Android and iOS platform credential wiring once platform folders and secrets are available.
- Test Android, iOS, and browser push delivery against real credentials.

## Verification

```bash
node scripts/check-universe-service-worker.mjs
```

The checker guards the service worker: push and update handling stay in place, chat clicks still open the room, and the worker does not go back to caching the game or to the old placeholder handlers.
