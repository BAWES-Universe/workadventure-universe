/**
 * MobilePushNotificationBridge unifies native Capacitor push registration (Android FCM
 * and iOS APNs via the injected WebView plugin) with browser Web Push subscriptions
 * (`notification-service-worker.js`). Permission prompts are never triggered on page load;
 * registration occurs strictly on explicit user opt-in.
 */

export type PushRegistrationFailureReason =
    | "notification-api-unavailable"
    | "service-worker-unavailable"
    | "push-manager-unavailable"
    | "native-plugin-unavailable"
    | "permission-denied"
    | "vapid-key-missing"
    | "registration-failed";

export interface CapacitorPushTokenEvent {
    value: string;
}

export interface CapacitorPushActionEvent {
    notification?: {
        data?: Record<string, unknown>;
    };
}

export interface CapacitorPluginListenerHandle {
    remove: () => Promise<void>;
}

export interface CapacitorPushNotificationsPlugin {
    requestPermissions: () => Promise<{ receive: string }>;
    register: () => Promise<void>;
    addListener: (
        eventName: "registration" | "registrationError" | "pushNotificationActionPerformed",
        listenerFunc: (event: unknown) => void
    ) => Promise<CapacitorPluginListenerHandle>;
}

export interface PushBridgeOptions {
    apiBaseUrl?: string;
    userId?: string;
    roomId?: string;
    deviceId?: string;
    requestPermission?: boolean;
    serviceWorkerPath?: string;
    nativePlatform?: "android" | "ios" | "native";
    nativePlugin?: CapacitorPushNotificationsPlugin;
    onNavigate?: (url: string) => void;
}

export interface PushBridgeRegistrationResult {
    registered: boolean;
    platform: "web" | "android" | "ios" | "native";
    registrationId?: string;
    reason?: PushRegistrationFailureReason;
}

interface GlobalCapacitorWindow {
    Capacitor?: {
        isNativePlatform?: () => boolean;
        getPlatform?: () => string;
        Plugins?: {
            PushNotifications?: CapacitorPushNotificationsPlugin;
        };
    };
}

const DEFAULT_SW_PATH = "/notification-service-worker.js";

/**
 * Validates that a notification tap target resolves to the current application origin
 * so external origins cannot hijack notification tap navigation.
 */
export function resolveSafeNotificationUrl(rawUrl: unknown, originUrl?: URL): string | null {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
        return null;
    }
    const base =
        originUrl ??
        new URL(typeof window !== "undefined" ? window.location.origin : "https://universe.bawes.net");
    try {
        const parsed = new URL(rawUrl, base.origin);
        return parsed.origin === base.origin ? parsed.href : null;
    } catch {
        return null;
    }
}

/**
 * Converts a URL-safe Base64 VAPID public key into the Uint8Array required by PushManager.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
    const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

export function buildPushEndpointUrl(endpoint: { path: string; apiBaseUrl?: string }): string {
    if (!endpoint.apiBaseUrl) {
        return endpoint.path;
    }
    const normalizedBase = endpoint.apiBaseUrl.endsWith("/") ? endpoint.apiBaseUrl : `${endpoint.apiBaseUrl}/`;
    return new URL(endpoint.path.replace(/^\/+/, ""), normalizedBase).toString();
}

function detectNativePlatform(options: PushBridgeOptions): "android" | "ios" | "native" | null {
    if (options.nativePlatform) {
        return options.nativePlatform;
    }
    const cap = typeof window !== "undefined" ? (window as unknown as GlobalCapacitorWindow).Capacitor : undefined;
    if (!cap?.isNativePlatform?.()) {
        return null;
    }
    const platform = cap.getPlatform?.();
    if (platform === "android" || platform === "ios") {
        return platform;
    }
    return "native";
}

function resolveNativePlugin(options: PushBridgeOptions): CapacitorPushNotificationsPlugin | undefined {
    if (options.nativePlugin) {
        return options.nativePlugin;
    }
    const cap = typeof window !== "undefined" ? (window as unknown as GlobalCapacitorWindow).Capacitor : undefined;
    return cap?.Plugins?.PushNotifications;
}

/**
 * Registers the current device for push notifications using Capacitor native push on
 * Android/iOS or Web Push via the service worker in browser environments.
 */
export async function registerPushNotifications(
    options: PushBridgeOptions = {}
): Promise<PushBridgeRegistrationResult> {
    const nativePlatform = detectNativePlatform(options);
    if (nativePlatform) {
        return registerNativeCapacitorPush({ ...options, nativePlatform });
    }
    return registerBrowserWebPush(options);
}

/**
 * Registers native Android (FCM) or iOS (APNs) push notifications via Capacitor
 * and binds tap navigation listeners when `onNavigate` is provided.
 */
export async function registerNativeCapacitorPush(
    options: PushBridgeOptions = {}
): Promise<PushBridgeRegistrationResult> {
    const platform = options.nativePlatform ?? "native";
    const plugin = resolveNativePlugin(options);
    if (!plugin) {
        return { registered: false, platform, reason: "native-plugin-unavailable" };
    }

    const permission = await plugin.requestPermissions();
    if (permission.receive !== "granted") {
        return { registered: false, platform, reason: "permission-denied" };
    }

    if (options.onNavigate) {
        await bindNativeNotificationTapListener(plugin, options.onNavigate);
    }

    const token = await awaitNativeToken(plugin);
    if (!token) {
        return { registered: false, platform, reason: "registration-failed" };
    }

    return submitPushRegistration(
        {
            platform,
            token,
            userId: options.userId,
            roomId: options.roomId,
            deviceId: options.deviceId,
        },
        options
    );
}

async function awaitNativeToken(plugin: CapacitorPushNotificationsPlugin): Promise<string | null> {
    let regHandle: CapacitorPluginListenerHandle | undefined;
    let errHandle: CapacitorPluginListenerHandle | undefined;
    try {
        return await new Promise<string | null>((resolve) => {
            void plugin
                .addListener("registration", (event) => {
                    const token = (event as CapacitorPushTokenEvent | undefined)?.value;
                    resolve(typeof token === "string" && token ? token : null);
                })
                .then((handle) => {
                    regHandle = handle;
                });
            void plugin
                .addListener("registrationError", () => {
                    resolve(null);
                })
                .then((handle) => {
                    errHandle = handle;
                });
            void plugin.register().catch(() => resolve(null));
        });
    } finally {
        await regHandle?.remove();
        await errHandle?.remove();
    }
}

/**
 * Listens for native notification taps (`pushNotificationActionPerformed`) and navigates
 * to the target URL when it belongs to the same origin.
 */
export async function bindNativeNotificationTapListener(
    plugin: CapacitorPushNotificationsPlugin,
    onNavigate: (url: string) => void
): Promise<CapacitorPluginListenerHandle> {
    const originUrl = new URL(typeof window !== "undefined" ? window.location.origin : "https://universe.bawes.net");
    return plugin.addListener("pushNotificationActionPerformed", (event) => {
        const action = event as CapacitorPushActionEvent | undefined;
        const safeUrl = resolveSafeNotificationUrl(action?.notification?.data?.url, originUrl);
        if (safeUrl) {
            onNavigate(safeUrl);
        }
    });
}

/**
 * Subscribes the browser's active service worker to Web Push using the server's VAPID
 * public key and sends the subscription to `/api/push/register`.
 */
export async function registerBrowserWebPush(
    options: PushBridgeOptions = {}
): Promise<PushBridgeRegistrationResult> {
    const availabilityError = checkBrowserPushSupport();
    if (availabilityError) {
        return { registered: false, platform: "web", reason: availabilityError };
    }

    const permission =
        options.requestPermission === false ? Notification.permission : await Notification.requestPermission();
    if (permission !== "granted") {
        return { registered: false, platform: "web", reason: "permission-denied" };
    }

    const vapidKeyBytes = await fetchVapidPublicKeyBytes(options);
    if (!vapidKeyBytes) {
        return { registered: false, platform: "web", reason: "vapid-key-missing" };
    }

    const subscription = await subscribeServiceWorkerPush(options, vapidKeyBytes);
    if (!subscription) {
        return { registered: false, platform: "web", reason: "registration-failed" };
    }

    return submitPushRegistration(
        {
            platform: "web",
            subscription,
            userId: options.userId,
            roomId: options.roomId,
            deviceId: options.deviceId,
        },
        options
    );
}

function checkBrowserPushSupport(): PushRegistrationFailureReason | null {
    if (typeof window === "undefined" || !("Notification" in window)) {
        return "notification-api-unavailable";
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
        return "service-worker-unavailable";
    }
    if (!("PushManager" in window)) {
        return "push-manager-unavailable";
    }
    return null;
}

async function fetchVapidPublicKeyBytes(options: PushBridgeOptions): Promise<Uint8Array | null> {
    try {
        const url = buildPushEndpointUrl({ path: "/api/push/vapid-public-key", apiBaseUrl: options.apiBaseUrl });
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        const data = (await response.json()) as { publicKey?: unknown };
        if (typeof data.publicKey !== "string" || !data.publicKey) {
            return null;
        }
        return urlBase64ToUint8Array(data.publicKey);
    } catch {
        return null;
    }
}

async function subscribeServiceWorkerPush(
    options: PushBridgeOptions,
    vapidKeyBytes: Uint8Array
): Promise<PushSubscriptionJSON | null> {
    try {
        const registration = await navigator.serviceWorker.register(options.serviceWorkerPath ?? DEFAULT_SW_PATH);
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKeyBytes,
        });
        return subscription.toJSON();
    } catch {
        return null;
    }
}

async function submitPushRegistration(
    payload: Record<string, unknown> & { platform: "web" | "android" | "ios" | "native" },
    options: PushBridgeOptions
): Promise<PushBridgeRegistrationResult> {
    try {
        const url = buildPushEndpointUrl({ path: "/api/push/register", apiBaseUrl: options.apiBaseUrl });
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            return { registered: false, platform: payload.platform, reason: "registration-failed" };
        }
        const body = (await response.json()) as { registration?: { id?: string } };
        return {
            registered: true,
            platform: payload.platform,
            registrationId: body.registration?.id,
        };
    } catch {
        return { registered: false, platform: payload.platform, reason: "registration-failed" };
    }
}
