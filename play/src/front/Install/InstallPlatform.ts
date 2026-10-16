/**
 * Which way into "install the app" this browser has. Chrome, Edge and Android browsers install from their own
 * window, which only they can open (see InstallApp); Apple's browsers have no install button at all, so for them
 * the game shows a short guide that points at the right buttons.
 */

/** The guides, one per place the buttons are. */
export type InstallGuide =
    /** iPhone, Safari: Share is behind "⋯" since iOS 26 (and at the bottom before it). */
    | "iphone-safari"
    /** iPad, Safari: Share is at the top right. */
    | "ipad-safari"
    /** iPhone and iPad, Chrome: Share is at the top right. */
    | "ios-chrome"
    /** iPhone and iPad, inside Instagram, WhatsApp and the like, or in a browser other than Safari and Chrome: no way in, so open Safari. */
    | "open-in-safari"
    /** Mac, Safari 17 and later: File > Add to Dock. */
    | "mac-safari"
    /**
     * Chrome, Edge and Android browsers after the player cancelled their install window (it cannot open twice): one
     * guide per browser that names its own buttons. Phones have no arrow (the bar can be at the top or the bottom);
     * computers point at the install icon in the address bar.
     */
    | "browser-chrome-android"
    | "browser-edge-android"
    | "browser-samsung-android"
    | "browser-other-android"
    | "browser-chrome-desktop"
    | "browser-edge-desktop"
    | "browser-other-desktop";

export interface InstallEnvironment {
    userAgent: string;
    platform: string;
    maxTouchPoints: number;
    /** `(display-mode: standalone)` (or window-controls-overlay): the page runs as an installed app. Not fullscreen: F11 in a browser tab matches that too. */
    displayModeInstalled: boolean;
    /** Safari's own flag for a home screen app. */
    navigatorStandalone: boolean;
    /** Brave hides itself in the user agent, but has `navigator.brave`. */
    brave?: boolean;
    /** The game runs inside Universe's own native app (a Capacitor web view), which is already an app. */
    nativeShell?: boolean;
}

/** Whether the game already runs as an installed app (a home screen app, or the native Universe app). */
export function isInstalledApp(env: InstallEnvironment): boolean {
    return env.displayModeInstalled || env.navigatorStandalone || env.nativeShell === true;
}

// Browsers that wrap a page in their own window (Instagram, Facebook, WhatsApp, TikTok, Snapchat, ...).
const IN_APP_BROWSER =
    /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|Bytedance|Twitter|LinkedInApp|Pinterest|GSA\/|Messenger|WhatsApp/i;

/** The guide to show in this browser, or undefined when it has none (the browser installs from its own window, or cannot install). */
export function installGuideFor(env: InstallEnvironment): InstallGuide | undefined {
    const ua = env.userAgent;
    // iPadOS 13 and later says it is a Mac, but a Mac has no touch screen.
    const isIpad = /iPad/.test(ua) || (env.platform === "MacIntel" && env.maxTouchPoints > 1);
    const isIphone = /iPhone|iPod/.test(ua);

    if (isIpad || isIphone) {
        if (IN_APP_BROWSER.test(ua)) return "open-in-safari";
        if (/CriOS/.test(ua)) return "ios-chrome";
        // Firefox, Edge, Opera and DuckDuckGo on iOS, and any web view that does not say it is Safari.
        if (/FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua) || !/Safari\//.test(ua)) return "open-in-safari";
        return isIpad ? "ipad-safari" : "iphone-safari";
    }

    if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\/|Firefox/.test(ua)) {
        // "Add to Dock" came with Safari 17 (macOS Sonoma).
        const version = /Version\/(\d+)/.exec(ua);
        if (version !== null && Number(version[1]) >= 17) return "mac-safari";
    }

    return undefined;
}

/** The environment of the browser running the game. */
export function currentInstallEnvironment(): InstallEnvironment {
    const matches = (query: string): boolean => window.matchMedia?.(query).matches === true;
    return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        displayModeInstalled:
            matches("(display-mode: standalone)") || matches("(display-mode: window-controls-overlay)"),
        navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
        brave: (navigator as Navigator & { brave?: unknown }).brave !== undefined,
        nativeShell:
            (
                window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }
            ).Capacitor?.isNativePlatform?.() === true,
    };
}

/** The guide for the browser's own menu, for when its install window was cancelled and cannot open again. */
export function browserMenuGuideFor(env: InstallEnvironment): Extract<InstallGuide, `browser-${string}`> {
    const ua = env.userAgent;
    const platform = /Android/.test(ua) ? "android" : "desktop";
    let browser: "chrome" | "edge" | "samsung" | "other";
    if (/EdgA\/|Edg\//.test(ua)) browser = "edge";
    else if (/SamsungBrowser\//.test(ua)) browser = "samsung";
    // Opera, Brave and the rest differ in their menus: one general guide.
    else if (/OPR\//.test(ua) || env.brave === true || !/Chrome\//.test(ua)) browser = "other";
    else browser = "chrome";
    if (platform === "android") return `browser-${browser}-android`;
    // Samsung Internet is a phone browser only.
    return browser === "samsung" ? "browser-other-desktop" : `browser-${browser}-desktop`;
}
