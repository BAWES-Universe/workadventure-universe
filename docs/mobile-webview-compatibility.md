# Mobile WebView Compatibility: Embedded Iframes & LiveKit Video

This document specifies how `play/` guarantees parity across desktop/mobile browsers, Android Chromium WebView, and iOS `WKWebView` inside the Capacitor mobile shell (`universe.bawes.net`).

---

## 1. Embedded Iframe Permissions Policy (`CoWebsites`, `Orbit`, `BigBlueButton`, `Jitsi`)

Embedded `<iframe>` elements inside `SimpleCowebsiteComponent.svelte`, `BigBlueButtonCowebsiteComponent.svelte`, and `Modal.svelte` resolve their `allow` attribute through `resolveWebViewIframeAllowPolicy()` (`play/src/front/Utils/MobileWebViewMediaCompatibility.ts`).

### Baseline Directives
Every embedded application frame receives the baseline WebView permission set merged with any custom map or module policy:

```html
allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-read; clipboard-write"
```

- **Why this is required in WebViews:** Android `WebChromeClient.onPermissionRequest` and iOS `WKWebView` media capture delegation inspect the child `<iframe>`'s `allow` attribute before forwarding camera, microphone, or clipboard access to embedded tools. Omitting these directives causes silent `NotAllowedError` failures inside embedded meetings or CoWebsites even when the native app holds OS-level camera/microphone permissions.
- **Custom directive preservation:** If a module supplies custom directives (e.g., `BBBFactory` passing `screen-wake-lock *` or wildcard origins `camera *`), `resolveWebViewIframeAllowPolicy()` preserves all caller directives while appending any missing baseline permissions.

---

## 2. LiveKit, WebRTC & Scripting Inline Video Playback

All `<video>` elements (`LivekitVideo.svelte`, `WebRtcVideo.svelte`, `ScriptingVideo.svelte`) apply `configureInlineVideoElement()` alongside declarative `playsinline` and `webkit-playsinline="true"` attributes:

```html
<video autoplay playsinline webkit-playsinline="true" muted />
```

- **iOS `WKWebView` inline rendering:** Without both `playsinline` and `webkit-playsinline="true"` (and the DOM `videoElement.playsInline = true` property set prior to `RemoteVideoTrack.attach()`), iOS WebViews force active video tracks into the native full-screen media player, obscuring the Phaser game canvas and proximity chat UI.
- **Android WebView autoplay readiness:** Enforcing `autoplay` and `playsInline` before track attachment prevents stalled frame rendering when participants enter or leave proximity bubbles or LiveKit rooms.

---

## 3. Mixed-Content & Origin Safety (`isWebViewSafeIframeUrl`)

Capacitor serves the Universe shell over a secure context (`https://universe.bawes.net`). `isWebViewSafeIframeUrl()` validates candidate iframe URLs before embedding:

- **Allowed in HTTPS WebViews:** `https:`, `blob:`, `about:blank`, and local development loopback origins (`localhost`, `127.0.0.1`, `[::1]`, and `10.0.2.2` for the Android Emulator host bridge).
- **Blocked as Mixed Content:** Plain `http:` external origins when the parent shell runs under `https:`.

---

## 4. Native App Context Identification (`X-Universe-App`)

In accordance with Universe architecture rules, **no feature is gated on user-agent strings** (except browser-only `getDisplayMedia` screen sharing, which is unsupported by mobile OS WebViews). When backend services or first-party iframes need to identify native shell traffic for diagnostics or telemetry:

- **Header:** `getUniverseAppHeaders()` returns `{ "X-Universe-App": "android" | "ios" }` inside the Capacitor shell and `{}` in standard web browsers.
- **Query Parameter:** `appendUniverseAppQueryParam(url)` appends `?universeApp=android|ios` to HTTP(S) URLs when executing inside the native WebView.

---

## 5. Verification & Compatibility Matrix

| Feature | Android App (Chromium WebView) | iOS App (WKWebView) | Desktop / Mobile Browser | Notes |
| :--- | :---: | :---: | :---: | :--- |
| **LiveKit video & audio call** | ✅ | ✅ | ✅ | Inline rendering via `playsinline` + `webkit-playsinline="true"` |
| **In-game iframe website (`CoWebsite`)** | ✅ | ✅ | ✅ | Full `allow` policy applied via `resolveWebViewIframeAllowPolicy` |
| **WA Scripting API (`openCoWebsite`, `Modal`)** | ✅ | ✅ | ✅ | `iframeListener` + `MessageChannel` postMessage bridge active |
| **Orbit Admin modal iframe** | ✅ | ✅ | ✅ | `Modal.svelte` delegates full WebView `allow` policy |
| **Screen sharing (`getDisplayMedia`)** | ⚠️ Browser-only | ⚠️ Browser-only | ✅ | Expected mobile OS WebView limitation (documented in `mobile/README.md`) |
| **Chat (`Synapse` / Matrix)** | ✅ | ✅ | ✅ | Works identically across WebView and browser |
