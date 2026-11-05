import { describe, expect, it } from "vitest";
import { isSafeAnalyticsId, keepPrivate, maskedNetworkRequest, withoutQueryOrHash } from "../AnalyticsPrivacy";

describe("isSafeAnalyticsId", () => {
    it("accepts Orbit's id and refuses an email, which is also the game's uuid for somebody signed in", () => {
        expect(isSafeAnalyticsId("3f0c9d2e-8a41-4b6a-9d55-0c1e7a2b4f10")).toBe(true);
        expect(isSafeAnalyticsId("sara@example.test")).toBe(false);
        expect(isSafeAnalyticsId("")).toBe(false);
        expect(isSafeAnalyticsId(null)).toBe(false);
        expect(isSafeAnalyticsId(undefined)).toBe(false);
    });
});

describe("withoutQueryOrHash", () => {
    it("keeps where, drops the sign-in code, the token and the hash", () => {
        expect(withoutQueryOrHash("https://play.test/@/uni/world/room?code=abc&token=t#chatRoomId=!r:matrix")).toBe(
            "https://play.test/@/uni/world/room"
        );
    });

    it("returns what is not an address as it was", () => {
        expect(withoutQueryOrHash("not an address")).toBe("not an address");
    });
});

describe("keepPrivate", () => {
    it("cleans every address PostHog adds and removes an email or uuid property", () => {
        const event = keepPrivate({
            properties: {
                $current_url: "https://play.test/@/uni/world/room?token=secret#x",
                $referrer: "https://login.test/cb?code=1",
                email: "sara@example.test",
                uuid: "sara@example.test",
                roomId: "/@/uni/world/room",
            },
            $set: { wa: true, email: "sara@example.test" },
            $set_once: { $initial_current_url: "https://play.test/@/uni/world/room?invite=1" },
        });
        expect(event?.properties).toEqual({
            $current_url: "https://play.test/@/uni/world/room",
            $referrer: "https://login.test/cb",
            roomId: "/@/uni/world/room",
        });
        expect(event?.$set).toEqual({ wa: true });
        expect(event?.$set_once).toEqual({ $initial_current_url: "https://play.test/@/uni/world/room" });
    });

    it("blanks an email that slipped into some other property", () => {
        const event = keepPrivate({ properties: { source: "from sara@example.test today", plain: "hello" } });
        expect(event?.properties).toEqual({ source: "from [email] today", plain: "hello" });
    });

    it("lets a missing event through", () => {
        expect(keepPrivate(null)).toBeNull();
    });
});

describe("maskedNetworkRequest", () => {
    it("keeps the address without its query and drops headers and bodies", () => {
        const masked = maskedNetworkRequest({
            name: "https://play.test/me?token=secret",
            requestHeaders: { authorization: "x" },
            requestBody: "{}",
            responseHeaders: { a: "b" },
            responseBody: '{"email":"a@b.co"}',
            status: 200,
        });
        expect(masked).toEqual({
            name: "https://play.test/me",
            requestHeaders: undefined,
            requestBody: undefined,
            responseHeaders: undefined,
            responseBody: undefined,
            status: 200,
        });
    });
});
