import { expect, test, vi } from "vitest";
import {
    type CapacitorPushNotificationsPlugin,
    bindNativeNotificationTapListener,
    buildPushEndpointUrl,
    registerPushNotifications,
    resolveSafeNotificationUrl,
    urlBase64ToUint8Array,
} from "../MobilePushNotificationBridge";

/**
 * Verifies native Android/iOS Capacitor push registration, same-origin notification tap
 * URL routing, and explicit opt-in Web Push subscription.
 */

test("registers an Android FCM token via the Capacitor PushNotifications plugin", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ registration: { id: "reg-android-01" } }),
    } as Response);

    const mockPlugin: CapacitorPushNotificationsPlugin = {
        requestPermissions: async () => ({ receive: "granted" }),
        register: async () => undefined,
        addListener: async (eventName, cb) => {
            if (eventName === "registration") {
                setTimeout(() => cb({ value: "fcm-token-xyz-12345" }), 0);
            }
            return { remove: async () => undefined };
        },
    };

    const result = await registerPushNotifications({
        apiBaseUrl: "https://universe.bawes.net",
        nativePlatform: "android",
        nativePlugin: mockPlugin,
        userId: "user-android",
        roomId: "room-main",
    });

    expect(result).toEqual({
        registered: true,
        platform: "android",
        registrationId: "reg-android-01",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
        "https://universe.bawes.net/api/push/register",
        expect.objectContaining({ method: "POST" })
    );

    fetchSpy.mockRestore();
});

test("returns permission-denied when native push permission is rejected", async () => {
    const mockPlugin: CapacitorPushNotificationsPlugin = {
        requestPermissions: async () => ({ receive: "denied" }),
        register: async () => undefined,
        addListener: async () => ({ remove: async () => undefined }),
    };

    const result = await registerPushNotifications({
        nativePlatform: "ios",
        nativePlugin: mockPlugin,
    });

    expect(result).toEqual({
        registered: false,
        platform: "ios",
        reason: "permission-denied",
    });
});

test("routes native notification taps only to same-origin URLs", async () => {
    let tappedHandler: ((event: unknown) => void) | undefined;
    const mockPlugin: CapacitorPushNotificationsPlugin = {
        requestPermissions: async () => ({ receive: "granted" }),
        register: async () => undefined,
        addListener: async (eventName, cb) => {
            if (eventName === "pushNotificationActionPerformed") {
                tappedHandler = cb;
            }
            return { remove: async () => undefined };
        },
    };

    const navigated: string[] = [];
    await bindNativeNotificationTapListener(mockPlugin, (url) => navigated.push(url));

    tappedHandler?.({ notification: { data: { url: "/@/bawes/universe/lobby" } } });
    tappedHandler?.({ notification: { data: { url: "https://evil.example.com/phish" } } });

    const origin = new URL("https://universe.bawes.net");
    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toContain("/@/bawes/universe/lobby");
    expect(resolveSafeNotificationUrl("/room", origin)).toBe("https://universe.bawes.net/room");
    expect(resolveSafeNotificationUrl("https://other.org/x", origin)).toBeNull();
});

test("converts Base64URL VAPID keys and normalizes API endpoint URLs", () => {
    const bytes = urlBase64ToUint8Array("AQID");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(
        buildPushEndpointUrl({ path: "/api/push/register", apiBaseUrl: "https://universe.bawes.net/" })
    ).toBe("https://universe.bawes.net/api/push/register");
    expect(buildPushEndpointUrl({ path: "/api/push/register" })).toBe("/api/push/register");
});
