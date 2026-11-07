# Push Notifications (Native Mobile + Web Push)

BAWES Universe supports multi-channel push notifications delivered to:

- **Android** via Firebase Cloud Messaging (`FCM`) and `@capacitor/push-notifications`
- **iOS** via Apple Push Notification service (`APNs`) and `@capacitor/push-notifications`
- **Browser PWA** via the W3C Web Push protocol (`VAPID`) and `play/public/notification-service-worker.js` / `play/public/service-worker.js`

---

## Architecture Overview

1. **Client Opt-In & Registration**:
   - Push permissions are never requested on page load. Users are prompted only from an explicit opt-in action (`NotificationAsk.ts` / `NotificationCard.svelte` or `registerPushNotifications()`).
   - **Native Mobile (`mobile/src/pushNotifications.ts` & `play/src/front/Notification/MobilePushNotificationBridge.ts`)**:
     - Requests native notification permission via `@capacitor/push-notifications`.
     - Listens for the `registration` event and submits `{ platform: 'android' | 'ios', token, userId, roomId, deviceId }` to `POST /api/push/register`.
     - Listens for `pushNotificationActionPerformed` so tapping a notification navigates the WebView to the same-origin room or chat URL in `notification.data.url`.
   - **Browser Web Push (`play/src/front/Notification/MobilePushNotificationBridge.ts` & `play/src/front/Notification/Push/PushDevice.ts`)**:
     - Fetches the server's public key from `GET /api/push/vapid-public-key`.
     - Subscribes the active service worker (`play/public/notification-service-worker.js`) via `PushManager.subscribe`.
     - Registers the subscription with `POST /api/push/register`.
     - When a notification arrives while the tab is backgrounded or closed, `notification-service-worker.js` displays the alert (muting system audio if an active foreground window already rings for the chat) and routes taps (`notificationclick`) to the target room URL.

2. **Server-Side Dispatch (`back/src/Services/PushNotificationService.ts` & `back/src/Controller/PushNotificationController.ts`)**:
   - `GET /api/push/vapid-public-key`: Returns `{ publicKey }` for browser `PushManager` subscriptions.
   - `POST /api/push/register`: Validates and stores native FCM/APNs tokens or Web Push subscriptions, returning a deterministic SHA-256 registration ID without exposing raw tokens or encryption keys.
   - `DELETE /api/push/register/:id`: Removes an existing registration.
   - `POST /api/push/send`: Protected by `PUSH_SERVICE_TOKEN` (`Authorization: Bearer <PUSH_SERVICE_TOKEN>` or `x-push-service-token`). Accepts:
     ```json
     {
       "target": "all | user:{id} | room:{roomId}",
       "title": "New message from Aria",
       "body": "Join the townhall in the main lobby",
       "url": "/@/bawes/universe/lobby",
       "chatRoomId": "!room:matrix.bawes.net"
     }
     ```
   - Automatically evicts stale registrations when an upstream gateway responds with HTTP `404` or `410 Gone`.

3. **Bot Event Triggers (`bots/server/PushNotificationClient.ts`)**:
   - Bots can trigger push notifications for direct messages (`notifyUser`), room events (`notifyRoom`), or global broadcasts (`notifyAll`) through `PushNotificationClient` or the service-guarded `POST /api/bots/notifications/send` router.

---

## Required Environment Variables (`.env.template`)

| Variable | Service | Description |
|---|---|---|
| `PUSH_API_URL` | `bots` | Base URL of the `back` service hosting `/api/push/send` (defaults to `http://localhost:8080`) |
| `PUSH_SERVICE_TOKEN` | `back`, `bots` | Shared secret token authorizing `POST /api/push/send` requests |
| `PUSH_VAPID_PUBLIC_KEY` | `back`, `play` | Base64URL-encoded P-256 public key for browser Web Push subscriptions |
| `PUSH_VAPID_PRIVATE_KEY` | `back` | Base64URL-encoded P-256 private key used to sign VAPID JWT headers |
| `PUSH_VAPID_SUBJECT` | `back` | Contact URI for VAPID tokens (e.g., `mailto:admin@universe.bawes.net`) |
| `FCM_SERVER_KEY` | `back` | Firebase Cloud Messaging server key for Android push delivery |
| `FCM_API_URL` | `back` | Optional FCM endpoint override (defaults to `https://fcm.googleapis.com/fcm/send`) |
| `APNS_AUTH_TOKEN` | `back` | Optional APNs bearer JWT token for direct iOS HTTP/2 push delivery |
| `APNS_BUNDLE_ID` | `back` | iOS bundle identifier (`net.bawes.universe`) sent in the `apns-topic` header |
| `APNS_HOST` | `back` | Optional APNs host override (defaults to `https://api.push.apple.com`) |
| `PUSH_NOTIFICATIONS_DRY_RUN` | `back` | When `true`, validates and matches target registrations without calling upstream gateways |

### Native Mobile Secrets (GitHub Actions / Fastlane)

- **Android**: Store `google-services.json` from Firebase Console in the `GOOGLE_SERVICES_JSON` GitHub Actions secret (injected into `mobile/android/app/google-services.json` during the Android CI build).
- **iOS**: Configure the Push Notifications capability and APNs signing key in Xcode / Fastlane Match (PR `#5`).

---

## Verification & Testing

```bash
# Run backend push service unit tests
npx vitest run PushNotificationService.test.ts

# Run bot push client unit tests
npx vitest run PushNotificationClient.test.ts

# Run frontend mobile/web push bridge unit tests
npx vitest run MobilePushNotificationBridge.test.ts
```
