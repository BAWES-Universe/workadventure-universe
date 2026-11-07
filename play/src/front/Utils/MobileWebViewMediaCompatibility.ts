/**
 * Mobile WebView media and iframe compatibility utilities for Universe (Android WebView and iOS WKWebView).
 *
 * Capacitor shells host Universe inside Chromium WebView on Android and WKWebView on iOS. Without explicit
 * permissions policies on embedded iframes and inline playback attributes on HTMLVideoElements, mobile WebViews
 * either block camera/microphone delegation to embedded tools (Orbit, BigBlueButton, Jitsi, CoWebsites) or force
 * LiveKit/WebRTC video streams into native full-screen media players that obscure the 2D virtual world.
 */

export type UniverseNativePlatform = "android" | "ios" | "web";

export const UNIVERSE_APP_HEADER_NAME = "X-Universe-App";
export const UNIVERSE_APP_QUERY_PARAM = "universeApp";

/**
 * Default Permissions-Policy directives required on embedded CoWebsite and modal iframes so Android WebView
 * WebChromeClient.onPermissionRequest and iOS WKWebView media capture delegation forward camera, microphone,
 * fullscreen, autoplay, and clipboard access to embedded applications.
 */
export const DEFAULT_WEBVIEW_IFRAME_ALLOW_DIRECTIVES: readonly string[] = [
    "camera",
    "microphone",
    "fullscreen",
    "display-capture",
    "autoplay",
    "clipboard-read",
    "clipboard-write",
];

export const DEFAULT_WEBVIEW_IFRAME_ALLOW_POLICY = DEFAULT_WEBVIEW_IFRAME_ALLOW_DIRECTIVES.join("; ");

export interface CapacitorBridgeLike {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
}

export interface WebViewEnvironmentContext {
    Capacitor?: CapacitorBridgeLike;
    navigator?: {
        userAgent?: string;
    };
    location?: {
        protocol?: string;
    };
}

export interface IframeCompatibilityConfig {
    iframeElement: HTMLIFrameElement | null | undefined;
    customAllowPolicy?: string | null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "10.0.2.2"]);
const SAFE_IFRAME_PROTOCOLS = new Set(["https:", "blob:"]);

function resolveDefaultEnvironment(): WebViewEnvironmentContext {
    if (typeof window === "undefined") {
        return {};
    }
    return window as unknown as WebViewEnvironmentContext;
}

function normalizePlatformName(rawPlatform: string | undefined): UniverseNativePlatform | undefined {
    const normalized = rawPlatform?.trim().toLowerCase();
    if (normalized === "android" || normalized === "ios") {
        return normalized;
    }
    return undefined;
}

function detectPlatformFromCapacitor(bridge: CapacitorBridgeLike | undefined): UniverseNativePlatform | undefined {
    if (!bridge) {
        return undefined;
    }
    const platform = normalizePlatformName(bridge.getPlatform?.());
    if (!platform) {
        return undefined;
    }
    const explicitlyWeb = bridge.isNativePlatform?.() === false;
    return explicitlyWeb ? "web" : platform;
}

function isAndroidWebViewUserAgent(ua: string): boolean {
    if (!ua.includes("android")) {
        return false;
    }
    return ua.includes("; wv)") || ua.includes(" wv ") || ua.includes("capacitor");
}

function isIosWkWebViewUserAgent(ua: string): boolean {
    const isAppleMobile = ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod");
    if (!isAppleMobile) {
        return false;
    }
    return ua.includes("capacitor") || (ua.includes("applewebkit") && !ua.includes("safari/"));
}

function detectPlatformFromUserAgent(userAgent: string | undefined): UniverseNativePlatform {
    const ua = (userAgent ?? "").toLowerCase();
    if (isAndroidWebViewUserAgent(ua)) {
        return "android";
    }
    if (isIosWkWebViewUserAgent(ua)) {
        return "ios";
    }
    return "web";
}

/**
 * Identifies whether Universe is executing inside the Android or iOS native Capacitor WebView shell.
 * Feature availability must never be gated on this value; it is strictly used for native context telemetry
 * (`X-Universe-App` header / `universeApp` query parameter) and platform diagnostics.
 */
export function detectUniverseNativeAppPlatform(env?: WebViewEnvironmentContext): UniverseNativePlatform {
    const targetEnv = env ?? resolveDefaultEnvironment();
    const capacitorPlatform = detectPlatformFromCapacitor(targetEnv.Capacitor);
    if (capacitorPlatform) {
        return capacitorPlatform;
    }
    return detectPlatformFromUserAgent(targetEnv.navigator?.userAgent);
}

/**
 * Builds the `X-Universe-App: android|ios` request header dictionary when running inside a native WebView shell,
 * or an empty object in standard desktop/mobile browsers so backend services can identify native app traffic.
 */
export function getUniverseAppHeaders(env?: WebViewEnvironmentContext): Record<string, string> {
    const platform = detectUniverseNativeAppPlatform(env);
    if (platform === "web") {
        return {};
    }
    return { [UNIVERSE_APP_HEADER_NAME]: platform };
}

/**
 * Appends `?universeApp=android|ios` to HTTP(S) URLs when running inside a native mobile WebView so embedded
 * first-party services (such as Orbit or room APIs) can detect native shell context during initial navigation.
 */
export function appendUniverseAppQueryParam(urlInput: string | URL, env?: WebViewEnvironmentContext): string {
    const platform = detectUniverseNativeAppPlatform(env);
    const rawString = urlInput.toString();
    if (platform === "web") {
        return rawString;
    }
    try {
        const parsed = new URL(rawString);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return rawString;
        }
        if (!parsed.searchParams.has(UNIVERSE_APP_QUERY_PARAM)) {
            parsed.searchParams.set(UNIVERSE_APP_QUERY_PARAM, platform);
        }
        return parsed.toString();
    } catch {
        return rawString;
    }
}

function extractDirectiveFeatureName(directiveToken: string): string {
    const trimmed = directiveToken.trim().toLowerCase();
    const spaceIndex = trimmed.indexOf(" ");
    return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
}

/**
 * Merges caller-supplied iframe `allow` directives with the baseline mobile WebView permissions policy.
 * Preserves origin wildcards (such as `camera *`) and extra directives (such as `screen-wake-lock *`) while
 * guaranteeing that camera, microphone, fullscreen, autoplay, and clipboard permissions are never omitted.
 */
export function resolveWebViewIframeAllowPolicy(customAllowPolicy?: string | null): string {
    const rawTokens = (customAllowPolicy ?? "")
        .split(";")
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
    if (rawTokens.length === 0) {
        return DEFAULT_WEBVIEW_IFRAME_ALLOW_POLICY;
    }
    const presentFeatures = new Set(rawTokens.map(extractDirectiveFeatureName));
    const missingDirectives = DEFAULT_WEBVIEW_IFRAME_ALLOW_DIRECTIVES.filter(
        (directive) => !presentFeatures.has(directive)
    );
    return [...rawTokens, ...missingDirectives].join("; ");
}

/**
 * Applies mobile WebView permissions (`allow` policy) to an HTMLIFrameElement so embedded CoWebsites and modals
 * can request camera, microphone, fullscreen, and clipboard access inside Android WebView and iOS WKWebView.
 */
export function configureWebViewIframe(config: IframeCompatibilityConfig): void {
    const { iframeElement, customAllowPolicy } = config;
    if (!iframeElement) {
        return;
    }
    const resolvedPolicy = resolveWebViewIframeAllowPolicy(customAllowPolicy);
    iframeElement.allow = resolvedPolicy;
    iframeElement.setAttribute("allow", resolvedPolicy);
}

/**
 * Enforces inline playback and autoplay readiness on an HTMLVideoElement so iOS WKWebView and Android WebView
 * render LiveKit and WebRTC video streams directly inside the game canvas instead of launching a native fullscreen
 * media player overlay.
 */
export function configureInlineVideoElement(videoElement: HTMLVideoElement | null | undefined): void {
    if (!videoElement) {
        return;
    }
    videoElement.playsInline = true;
    videoElement.autoplay = true;
    videoElement.setAttribute("playsinline", "");
    videoElement.setAttribute("webkit-playsinline", "true");
}

function isLoopbackHost(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(lower) || lower.endsWith(".localhost");
}

function isAllowedHttpIframeUrl(hostname: string, pageProtocol: string): boolean {
    if (pageProtocol === "http:") {
        return true;
    }
    return isLoopbackHost(hostname);
}

/**
 * Validates that a candidate iframe URL will not be blocked as mixed content inside an HTTPS or Capacitor WebView.
 * Plain HTTP origins are rejected when the host page runs over HTTPS unless the target is a local loopback address
 * (including `10.0.2.2` used by the Android Emulator host bridge).
 */
export function isWebViewSafeIframeUrl(candidateUrl: string | URL, pageProtocol = "https:"): boolean {
    try {
        const parsed = new URL(candidateUrl.toString());
        if (SAFE_IFRAME_PROTOCOLS.has(parsed.protocol) || parsed.href === "about:blank") {
            return true;
        }
        if (parsed.protocol !== "http:") {
            return false;
        }
        return isAllowedHttpIframeUrl(parsed.hostname, pageProtocol);
    } catch {
        return false;
    }
}
