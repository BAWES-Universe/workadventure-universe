# Mobile service worker push and update handling

This document covers the web/PWA slice of the BAWES Universe mobile bounty. It is intentionally scoped to the production service worker and does not add native Android/iOS credentials or backend delivery storage.

## What is covered

- New service workers activate immediately with `self.skipWaiting()`.
- Activated workers call `clients.claim()` so open tabs are controlled without waiting for a full browser restart.
- The page can send `{ type: "SKIP_WAITING" }` to the worker when a future UI wants to trigger immediate activation.
- Web push payloads are parsed as JSON when possible and fall back to text bodies for simple payloads.
- Notifications use safe defaults for title, icon, badge, tag, and same-origin target URL.
- Notification clicks close the notification, focus an existing matching Universe tab when possible, or open the target URL.

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

The checker guards against regressing the production service worker back to placeholder update or push handlers.
