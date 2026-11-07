import { expect, test } from "vitest";
import { isMatchingServiceToken } from "../src/Controller/PushNotificationController";
import { readBooleanEnv, readOptionalEnv, resolvePushEnvironment } from "../src/Enum/PushEnvironmentVariable";
import {
    type PushHttpOutboundRequest,
    PushNotificationService,
} from "../src/Services/PushNotificationService";

/**
 * Verifies device registration, secret redaction, target resolution (`all`, `user:{id}`, `room:{id}`),
 * and multi-channel dispatch across Web Push (VAPID), Android (FCM), and iOS (APNs).
 */

test("registers a web push subscription without exposing subscription secrets", () => {
    const service = new PushNotificationService({});
    const registration = service.register({
        platform: "web",
        userId: "user-1",
        roomId: "room-1",
        subscription: {
            endpoint: "https://push.example.com/subscriptions/1",
            keys: { p256dh: "p256dh-secret", auth: "auth-secret" },
        },
    });

    expect(registration.id).toHaveLength(64);
    expect(registration.platform).toBe("web");
    expect(registration.userId).toBe("user-1");
    expect(JSON.stringify(registration)).not.toContain("p256dh-secret");
    expect(JSON.stringify(registration)).not.toContain("auth-secret");
});

test("updates an existing registration for the same native token and supports unregister", () => {
    const service = new PushNotificationService({});
    const first = service.register({
        platform: "android",
        token: "native-token-123456",
        userId: "user-1",
    });
    const second = service.register({
        platform: "android",
        token: "native-token-123456",
        userId: "user-2",
        roomId: "room-lobby",
    });

    expect(second.id).toBe(first.id);
    expect(second.userId).toBe("user-2");
    expect(second.roomId).toBe("room-lobby");
    expect(service.listPublicRegistrations()).toHaveLength(1);
    expect(service.unregister(first.id)).toBe(true);
    expect(service.listPublicRegistrations()).toHaveLength(0);
});

test("matches all, user, and room targets in dry-run mode", async () => {
    const service = new PushNotificationService({});
    service.register({
        platform: "ios",
        token: "native-token-abcdef",
        userId: "user-1",
        roomId: "room-a",
    });
    service.register({
        platform: "web",
        userId: "user-2",
        roomId: "room-a",
        subscription: {
            endpoint: "https://push.example.com/subscriptions/2",
            keys: { p256dh: "p256dh", auth: "auth" },
        },
    });

    const allResult = await service.send({ target: "all", title: "Hello", body: "World" }, true);
    const userResult = await service.send({ target: "user:user-1", title: "Hello", body: "World" }, true);
    const roomResult = await service.send({ target: "room:room-a", title: "Hello", body: "World" }, true);

    expect(allResult).toMatchObject({ dryRun: true, matched: 2, sent: 0 });
    expect(userResult.matched).toBe(1);
    expect(roomResult.matched).toBe(2);
});

test("dispatches Web Push, Android FCM, and iOS APNs notifications when providers are configured", async () => {
    const outboundCalls: PushHttpOutboundRequest[] = [];
    const service = new PushNotificationService({
        vapidPublicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
        vapidPrivateKey: "UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls",
        vapidSubject: "mailto:ops@universe.bawes.net",
        fcmServerKey: "fcm-server-secret",
        apnsAuthToken: "apns-jwt-token",
        apnsBundleId: "net.bawes.universe",
        httpSender: async (req) => {
            outboundCalls.push(req);
            return { status: 201 };
        },
    });

    service.register({
        platform: "web",
        userId: "u-web",
        subscription: {
            endpoint: "https://push.example.com/sub/web-1",
            keys: { p256dh: "k1", auth: "a1" },
        },
    });
    service.register({ platform: "android", token: "fcm-device-token-01", userId: "u-android" });
    service.register({ platform: "ios", token: "apns-device-token-01", userId: "u-ios" });

    const result = await service.send(
        { target: "all", title: "Event", body: "Bot message", url: "/@/bawes/universe/lobby" },
        false
    );

    expect(result).toEqual({ dryRun: false, matched: 3, sent: 3, failed: 0, evicted: 0 });
    expect(outboundCalls).toHaveLength(3);
    expect(outboundCalls[0].headers.Authorization).toContain("vapid t=");
    expect(outboundCalls[1].headers.Authorization).toBe("key=fcm-server-secret");
    expect(outboundCalls[2].headers["apns-topic"]).toBe("net.bawes.universe");
});

test("evicts stale registrations when upstream gateway responds with HTTP 410 Gone", async () => {
    const service = new PushNotificationService({
        fcmServerKey: "fcm-server-secret",
        httpSender: async () => ({ status: 410 }),
    });

    service.register({ platform: "android", token: "stale-fcm-token-99", userId: "u-stale" });
    const result = await service.send({ target: "all", title: "Ping", body: "Check" }, false);

    expect(result).toEqual({ dryRun: false, matched: 1, sent: 0, failed: 1, evicted: 1 });
    expect(service.listPublicRegistrations()).toHaveLength(0);
});

test("reports delivery-provider-not-configured and validates token helpers", async () => {
    const service = new PushNotificationService({});
    service.register({ platform: "ios", token: "native-token-abcdef", userId: "user-1" });

    const result = await service.send({ target: "all", title: "Hello", body: "Body" }, false);
    expect(result.skippedReason).toBe("delivery-provider-not-configured");
    expect(isMatchingServiceToken("secret-1", "secret-1")).toBe(true);
    expect(isMatchingServiceToken("secret-1", "secret-2")).toBe(false);
    expect(readOptionalEnv("  val  ")).toBe("val");
    expect(readBooleanEnv("true", false)).toBe(true);
    expect(resolvePushEnvironment({ PUSH_NOTIFICATIONS_DRY_RUN: "true" }).dryRun).toBe(true);
});
