import { describe, expect, it } from "vitest";
import { PushNotificationService } from "../src/Services/PushNotificationService";

describe("PushNotificationService", () => {
    it("registers a web push subscription without exposing subscription secrets", () => {
        const service = new PushNotificationService();

        const registration = service.register({
            platform: "web",
            userId: "user-1",
            roomId: "room-1",
            subscription: {
                endpoint: "https://push.example.com/subscriptions/1",
                keys: {
                    p256dh: "p256dh",
                    auth: "auth",
                },
            },
        });

        expect(registration.id).toHaveLength(64);
        expect(registration.platform).toBe("web");
        expect(registration.userId).toBe("user-1");
        expect(registration.roomId).toBe("room-1");
        expect(JSON.stringify(registration)).not.toContain("p256dh");
        expect(JSON.stringify(registration)).not.toContain("auth");
    });

    it("updates an existing registration for the same native token", () => {
        const service = new PushNotificationService();

        const first = service.register({
            platform: "android",
            token: "native-token-123456",
            userId: "user-1",
        });
        const second = service.register({
            platform: "android",
            token: "native-token-123456",
            userId: "user-2",
        });

        expect(second.id).toBe(first.id);
        expect(second.createdAt).toBe(first.createdAt);
        expect(second.userId).toBe("user-2");
        expect(service.listPublicRegistrations()).toHaveLength(1);
    });

    it("matches all, user, and room targets in dry-run mode", () => {
        const service = new PushNotificationService();

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
                keys: {
                    p256dh: "p256dh",
                    auth: "auth",
                },
            },
        });

        expect(service.send({ target: "all", title: "Hello", body: "Body" }, true)).toMatchObject({
            dryRun: true,
            matched: 2,
            sent: 0,
        });
        expect(service.send({ target: "user:user-1", title: "Hello", body: "Body" }, true)).toMatchObject({
            matched: 1,
        });
        expect(service.send({ target: "room:room-a", title: "Hello", body: "Body" }, true)).toMatchObject({
            matched: 2,
        });
    });

    it("does not claim delivery until a delivery provider is wired", () => {
        const service = new PushNotificationService();

        service.register({
            platform: "ios",
            token: "native-token-abcdef",
            userId: "user-1",
        });

        expect(service.send({ target: "all", title: "Hello", body: "Body" }, false)).toMatchObject({
            dryRun: false,
            matched: 1,
            sent: 0,
            skippedReason: "delivery-provider-not-configured",
        });
    });
});
