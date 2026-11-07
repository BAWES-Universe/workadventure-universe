import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
    PushNotifications,
    type ActionPerformed,
    type RegistrationError,
    type Token,
} from "@capacitor/push-notifications";

/**
 * Native Capacitor push notification registration and tap navigation listener
 * for Android (FCM) and iOS (APNs). Must be invoked from an explicit user opt-in
 * action rather than on application startup.
 */

export type NativePushFailureReason =
    | "native-platform-unavailable"
    | "permission-denied"
    | "registration-failed"
    | "registration-listener-failed";

export interface NativePushRegistrationOptions {
    apiBaseUrl: string;
    userId?: string;
    roomId?: string;
    deviceId?: string;
    onNotificationTapUrl?: (url: string) => void;
}

export interface NativePushRegistrationResult {
    registered: boolean;
    platform?: "android" | "ios";
    reason?: NativePushFailureReason;
}

export async function registerNativePushNotifications(
    options: NativePushRegistrationOptions
): Promise<NativePushRegistrationResult> {
    const platform = Capacitor.getPlatform();
    if (platform !== "android" && platform !== "ios") {
        return { registered: false, reason: "native-platform-unavailable" };
    }

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") {
        return { registered: false, platform, reason: "permission-denied" };
    }

    if (options.onNotificationTapUrl) {
        await registerNativeTapActionListener(options.onNotificationTapUrl);
    }

    const tokenValue = await waitForNativePushToken();
    if (!tokenValue) {
        return { registered: false, platform, reason: "registration-failed" };
    }

    try {
        await postNativePushToken(options, { token: tokenValue, platform });
        return { registered: true, platform };
    } catch {
        return { registered: false, platform, reason: "registration-failed" };
    }
}

async function waitForNativePushToken(): Promise<string | null> {
    let regHandle: PluginListenerHandle | undefined;
    let errHandle: PluginListenerHandle | undefined;
    try {
        return await new Promise<string | null>((resolve) => {
            void PushNotifications.addListener("registration", (token: Token) => {
                resolve(token.value || null);
            }).then((handle) => {
                regHandle = handle;
            });
            void PushNotifications.addListener("registrationError", (_error: RegistrationError) => {
                resolve(null);
            }).then((handle) => {
                errHandle = handle;
            });
            void PushNotifications.register().catch(() => resolve(null));
        });
    } catch {
        return null;
    } finally {
        await regHandle?.remove();
        await errHandle?.remove();
    }
}

export async function registerNativeTapActionListener(
    onNotificationTapUrl: (url: string) => void
): Promise<PluginListenerHandle> {
    return PushNotifications.addListener("pushNotificationActionPerformed", (action: ActionPerformed) => {
        const rawUrl = (action.notification.data as Record<string, unknown> | undefined)?.url;
        if (typeof rawUrl === "string" && rawUrl.trim()) {
            onNotificationTapUrl(rawUrl.trim());
        }
    });
}

export async function postNativePushToken(
    options: NativePushRegistrationOptions,
    registration: { token: string; platform: "android" | "ios" }
): Promise<void> {
    const base = options.apiBaseUrl.endsWith("/") ? options.apiBaseUrl : `${options.apiBaseUrl}/`;
    const endpoint = new URL("api/push/register", base).toString();
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            platform: registration.platform,
            token: registration.token,
            userId: options.userId,
            roomId: options.roomId,
            deviceId: options.deviceId,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to register native push token (${response.status})`);
    }
}
