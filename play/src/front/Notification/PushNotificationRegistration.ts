export type PushNotificationRegistrationReason =
    | "notification-api-unavailable"
    | "service-worker-unavailable"
    | "push-manager-unavailable"
    | "permission-denied"
    | "vapid-key-missing"
    | "registration-failed";

export interface PushNotificationRegistrationOptions {
    apiBaseUrl?: string;
    deviceId?: string;
    requestPermission?: boolean;
    roomId?: string;
    serviceWorkerPath?: string;
    userId?: string;
}

export interface PushNotificationRegistrationResult {
    registered: boolean;
    reason?: PushNotificationRegistrationReason;
    registrationId?: string;
}

interface VapidPublicKeyResponse {
    publicKey: string | null;
}

interface PushRegistrationResponse {
    registration?: {
        id?: string;
    };
}

export async function registerWebPushNotifications(
    options: PushNotificationRegistrationOptions = {}
): Promise<PushNotificationRegistrationResult> {
    if (!("Notification" in window)) {
        return { registered: false, reason: "notification-api-unavailable" };
    }

    if (!("serviceWorker" in navigator)) {
        return { registered: false, reason: "service-worker-unavailable" };
    }

    if (!("PushManager" in window)) {
        return { registered: false, reason: "push-manager-unavailable" };
    }

    const permission =
        options.requestPermission === false ? Notification.permission : await Notification.requestPermission();

    if (permission !== "granted") {
        return { registered: false, reason: "permission-denied" };
    }

    try {
        const vapidResponse = await fetch(buildPushApiUrl("/api/push/vapid-public-key", options.apiBaseUrl));
        const vapidPublicKey = ((await vapidResponse.json()) as VapidPublicKeyResponse).publicKey;

        if (!vapidPublicKey) {
            return { registered: false, reason: "vapid-key-missing" };
        }

        const serviceWorkerRegistration = await navigator.serviceWorker.register(
            options.serviceWorkerPath ?? "/notification-service-worker.js"
        );
        const subscription = await serviceWorkerRegistration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });

        const registerResponse = await fetch(buildPushApiUrl("/api/push/register", options.apiBaseUrl), {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                platform: "web",
                subscription: subscription.toJSON(),
                userId: options.userId,
                roomId: options.roomId,
                deviceId: options.deviceId,
            }),
        });

        if (!registerResponse.ok) {
            return { registered: false, reason: "registration-failed" };
        }

        const response = (await registerResponse.json()) as PushRegistrationResponse;

        return {
            registered: true,
            registrationId: response.registration?.id,
        };
    } catch {
        return { registered: false, reason: "registration-failed" };
    }
}

function buildPushApiUrl(path: string, apiBaseUrl?: string): string {
    if (!apiBaseUrl) {
        return path;
    }

    const normalizedBase = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
    const normalizedPath = path.replace(/^\/+/, "");

    return new URL(normalizedPath, normalizedBase).toString();
}

function urlBase64ToUint8Array(value: string): Uint8Array {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const output = new Uint8Array(rawData.length);

    for (let index = 0; index < rawData.length; index += 1) {
        output[index] = rawData.charCodeAt(index);
    }

    return output;
}
