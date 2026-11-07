/**
 * Unit tests for mobile WebView media, iframe permissions policy, and native app context utilities.
 *
 * Verifies that Universe's embedded iframes and LiveKit/WebRTC video elements receive the required attributes for
 * Android Chromium WebView and iOS WKWebView without gating any browser or app features on user-agent detection.
 */

import { describe, expect, it } from "vitest";
import {
    DEFAULT_WEBVIEW_IFRAME_ALLOW_POLICY,
    UNIVERSE_APP_HEADER_NAME,
    appendUniverseAppQueryParam,
    configureInlineVideoElement,
    configureWebViewIframe,
    detectUniverseNativeAppPlatform,
    getUniverseAppHeaders,
    isWebViewSafeIframeUrl,
    resolveWebViewIframeAllowPolicy,
    type WebViewEnvironmentContext,
} from "../MobileWebViewMediaCompatibility";

function createCapacitorEnv(platform: string, nativePlatform = true): WebViewEnvironmentContext {
    return {
        Capacitor: {
            getPlatform: () => platform,
            isNativePlatform: () => nativePlatform,
        },
    };
}

function createUserAgentEnv(userAgent: string): WebViewEnvironmentContext {
    return {
        navigator: {
            userAgent,
        },
    };
}

describe("detectUniverseNativeAppPlatform and headers", () => {
    it("identifies Android and iOS Capacitor native shells from the Capacitor bridge", () => {
        const androidEnv = createCapacitorEnv("android", true);
        const iosEnv = createCapacitorEnv("ios", true);
        const webEnv = createCapacitorEnv("android", false);

        expect(detectUniverseNativeAppPlatform(androidEnv)).toBe("android");
        expect(detectUniverseNativeAppPlatform(iosEnv)).toBe("ios");
        expect(detectUniverseNativeAppPlatform(webEnv)).toBe("web");
    });

    it("falls back to Android WebView and iOS WKWebView user-agent signatures when bridge is absent", () => {
        const androidWv = createUserAgentEnv(
            "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36"
        );
        const iosWkWebView = createUserAgentEnv(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
        );
        const mobileSafari = createUserAgentEnv(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
        );

        expect(detectUniverseNativeAppPlatform(androidWv)).toBe("android");
        expect(detectUniverseNativeAppPlatform(iosWkWebView)).toBe("ios");
        expect(detectUniverseNativeAppPlatform(mobileSafari)).toBe("web");
    });

    it("emits X-Universe-App headers and universeApp query parameters only in native app contexts", () => {
        const androidEnv = createCapacitorEnv("android", true);
        const webEnv = createCapacitorEnv("web", false);

        expect(getUniverseAppHeaders(androidEnv)).toEqual({ [UNIVERSE_APP_HEADER_NAME]: "android" });
        expect(getUniverseAppHeaders(webEnv)).toEqual({});

        expect(appendUniverseAppQueryParam("https://universe.bawes.net/admin/login", androidEnv)).toBe(
            "https://universe.bawes.net/admin/login?universeApp=android"
        );
        expect(appendUniverseAppQueryParam("https://universe.bawes.net/admin/login", webEnv)).toBe(
            "https://universe.bawes.net/admin/login"
        );
    });
});

describe("resolveWebViewIframeAllowPolicy and configureWebViewIframe", () => {
    it("returns the full mobile WebView permissions policy when no custom policy is supplied", () => {
        expect(resolveWebViewIframeAllowPolicy()).toBe(DEFAULT_WEBVIEW_IFRAME_ALLOW_POLICY);
        expect(resolveWebViewIframeAllowPolicy("")).toBe(DEFAULT_WEBVIEW_IFRAME_ALLOW_POLICY);
        expect(resolveWebViewIframeAllowPolicy(null)).toBe(DEFAULT_WEBVIEW_IFRAME_ALLOW_POLICY);
    });

    it("merges missing WebView permissions while preserving custom wildcard directives", () => {
        const bbbPolicy =
            "microphone *; camera *; display-capture *; clipboard-read *; clipboard-write *; screen-wake-lock *;";
        const resolved = resolveWebViewIframeAllowPolicy(bbbPolicy);

        expect(resolved).toContain("microphone *");
        expect(resolved).toContain("camera *");
        expect(resolved).toContain("screen-wake-lock *");
        expect(resolved).toContain("fullscreen");
        expect(resolved).toContain("autoplay");
    });

    it("configures HTMLIFrameElement allow property and attribute for WebView delegation", () => {
        const iframe = document.createElement("iframe");
        configureWebViewIframe({ iframeElement: iframe, customAllowPolicy: "fullscreen" });

        expect(iframe.getAttribute("allow")).toContain("camera");
        expect(iframe.getAttribute("allow")).toContain("microphone");
        expect(iframe.getAttribute("allow")).toContain("fullscreen");
        expect(iframe.getAttribute("allow")).toContain("autoplay");
    });
});

describe("configureInlineVideoElement and isWebViewSafeIframeUrl", () => {
    it("enforces inline playback and autoplay attributes on HTMLVideoElement for iOS WKWebView", () => {
        const video = document.createElement("video");
        configureInlineVideoElement(video);

        expect(video.playsInline).toBe(true);
        expect(video.autoplay).toBe(true);
        expect(video.hasAttribute("playsinline")).toBe(true);
        expect(video.getAttribute("webkit-playsinline")).toBe("true");
    });

    it("rejects mixed-content HTTP iframe URLs under HTTPS while allowing loopback and Android emulator host", () => {
        expect(isWebViewSafeIframeUrl("https://universe.bawes.net/room", "https:")).toBe(true);
        expect(isWebViewSafeIframeUrl("http://insecure.example.com/embed", "https:")).toBe(false);
        expect(isWebViewSafeIframeUrl("http://localhost:8080/embed", "https:")).toBe(true);
        expect(isWebViewSafeIframeUrl("http://10.0.2.2:3000/embed", "https:")).toBe(true);
        expect(isWebViewSafeIframeUrl("http://insecure.example.com/embed", "http:")).toBe(true);
    });
});
