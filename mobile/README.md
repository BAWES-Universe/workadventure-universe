# BAWES Universe — Mobile App

Native Android and iOS wrapper for [universe.bawes.net](https://universe.bawes.net) built with [Capacitor](https://capacitorjs.com/).

## Architecture

```text
mobile/
├── capacitor.config.ts   ← Points shell at universe.bawes.net
├── package.json          ← Capacitor deps + scripts
├── Gemfile               ← Fastlane (shared by Android + iOS)
├── fastlane/             ← Added in #4 (Android) and #5 (iOS)
├── android/              ← Added in PR #4
└── ios/                  ← Added in PR #5
```

**The app is a thin native shell.** All game logic, iframes, video (LiveKit), and bot interactions live on the server at `universe.bawes.net`. This means:
- Game updates ship instantly without app store review
- Only native-layer changes (push notifications, deep links, icons) require a new app release
- iframe websites, video calls, and all WA scripting API features work as-is

## Prerequisites

```bash
node >= 18
npm >= 9
ruby >= 3.2   # for Fastlane
bundler       # gem install bundler
```

## Setup

```bash
cd mobile
npm install
bundle install
```

Verify the environment:
```bash
npx cap doctor
```

## Syncing after platform setup

Once `android/` or `ios/` folders are added (PRs #4 and #5), sync with:

```bash
npm run sync          # sync all platforms
npm run sync:android  # Android only
npm run sync:ios      # iOS only
```

## Development workflow

1. Make changes to the web app at `universe.bawes.net` — no sync needed for web-only changes
2. For native config changes (permissions, deep links, icons): edit platform folders → `npm run sync` → test on device
3. For new Capacitor plugin additions: `npm install @capacitor/plugin-name` → update `capacitor.config.ts` if needed → `npm run sync`

## Push Notifications

The shell is pre-configured for push notifications via `@capacitor/push-notifications`.

- **Android**: Requires `GOOGLE_SERVICES_JSON` secret (from Firebase Console) — see PR #4
- **iOS**: Requires APNs certificate — see PR #5
- Notification payloads are handled by the web app's existing service worker (`play/public/notification-service-worker.js`)

## LiveKit Video / iframe compatibility

The WebView configuration is set to:
- `cleartext: false` — HTTPS only (required for getUserMedia / camera + mic)
- `androidScheme: https` — ensures WebRTC and cookies work correctly on Android
- `contentInset: always` — iOS safe area respected so game UI is not obscured by notch

Camera and microphone permission requests are handled natively by each platform. See platform READMEs in `android/` and `ios/` once those PRs land.

## Update architecture

The native app does not use CodePush, Appflow Live Updates, or any OTA tool that swaps native code after App Store or Play Store review. The WebView loads `https://universe.bawes.net`, so web content, game logic, iframes, and bot UI updates are delivered by the live server. Native releases are only required for shell changes such as permissions, Capacitor plugins, deep links, icons, signing, or platform manifests.

The web app checks `/api/version` at launch when it runs inside Capacitor. The endpoint returns:

```json
{
  "webVersion": "2026.05.15",
  "minNativeVersion": "1.0.0",
  "latestNativeVersion": "1.2.0",
  "updateUrl": {
    "android": "https://play.google.com/store/apps/details?id=net.bawes.universe",
    "ios": "https://apps.apple.com/app/id..."
  }
}
```

- If the installed native version is lower than `minNativeVersion`, the web app shows a blocking update modal.
- If the installed native version is lower than `latestNativeVersion`, the web app shows a dismissible update banner.
- Store links come from `MOBILE_ANDROID_UPDATE_URL` and `MOBILE_IOS_UPDATE_URL` on the back service.
- Web-only deploys are handled by the service worker update banner: a new `service-worker-prod.js` activates and asks the player to reload without interrupting active gameplay.

## Fastlane

Fastlane lanes are defined in `fastlane/Fastfile` (added in PRs #4 and #5).

```bash
bundle exec fastlane android build    # Build signed Android APK/AAB
bundle exec fastlane android deploy   # Deploy to Play Store internal track
bundle exec fastlane ios beta         # Build + upload to TestFlight
```

Platform lanes should increment build numbers before signing and uploading so CI never submits duplicate builds:

```ruby
increment_build_number(xcodeproj: "ios/App/App.xcodeproj")
# Android versionCode is managed in the Android Gradle config added with PR #4.
```

## Secrets required (GitHub Actions)

See `.github/workflows/android-build.yml` and `.github/workflows/ios-build.yml` for the full list. Summary:

| Secret | Used by |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Android signing |
| `ANDROID_STORE_PASSWORD` | Android signing |
| `ANDROID_KEY_ALIAS` | Android signing |
| `ANDROID_KEY_PASSWORD` | Android signing |
| `GOOGLE_PLAY_JSON_KEY` | Play Store upload |
| `GOOGLE_SERVICES_JSON` | Firebase / push notifications |
| `APPLE_ID` | iOS / TestFlight |
| `APPLE_TEAM_ID` | iOS signing |
| `MATCH_PASSWORD` | Fastlane Match cert encryption |
| `MATCH_GIT_BASIC_AUTHORIZATION` | Fastlane Match cert repo access |
| `ASC_KEY_ID` | App Store Connect API |
| `ASC_ISSUER_ID` | App Store Connect API |
| `ASC_KEY_CONTENT` | App Store Connect API |

## Branching rules

All mobile work branches from and merges to `universe`.

| Branch | Owns |
|---|---|
| `feat/mobile-capacitor-scaffold` | `mobile/` root (this PR) |
| `feat/mobile-android` | `mobile/android/`, `.github/workflows/android-build.yml` |
| `feat/mobile-ios` | `mobile/ios/`, `.github/workflows/ios-build.yml` |
