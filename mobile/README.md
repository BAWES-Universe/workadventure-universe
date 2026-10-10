# BAWES Universe — Mobile App

Native Android and iOS wrapper for [universe.bawes.net](https://universe.bawes.net) built with [Capacitor](https://capacitorjs.com/).

## Architecture

```
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

Camera and microphone permission requests are handled natively by each platform. iframe allow policies continue to pass through from the web app (`allowPolicy` / `allow` attributes), so existing WA scripting API and embedded-site behavior stays in the server-rendered app.

Known mobile limitation:
- Screen sharing stays browser-only. Android WebView and WKWebView do not provide a reliable `getDisplayMedia` path for the Universe shell, so the front-end hides the screen-share control when running inside the Capacitor app instead of presenting a broken prompt.

See platform READMEs in `android/` and `ios/` once those PRs land.

## Fastlane

Fastlane lanes are defined in `fastlane/Fastfile` (added in PRs #4 and #5).

```bash
bundle exec fastlane android build    # Build signed Android APK/AAB
bundle exec fastlane android deploy   # Deploy to Play Store internal track
bundle exec fastlane ios beta         # Build + upload to TestFlight
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
