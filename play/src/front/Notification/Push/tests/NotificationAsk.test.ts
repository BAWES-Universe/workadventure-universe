import { describe, expect, it, vi } from "vitest";
import { ASK_AGAIN_AFTER_MS, ASK_AGAIN_WHEN_BLOCKED_AFTER_MS, replyMoment, shouldAsk } from "../NotificationAsk";
import { blockedSteps, cardStartState } from "../NotificationCardState";
import type { PushDeviceInfo } from "../PushDevice";

vi.mock("../NotificationCard.svelte", () => ({ default: {} }));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { getPushDeviceId: () => null } }));
vi.mock("../../../Stores/PopupStore", () => ({ popupStore: {} }));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: {} }));
vi.mock("../../../Network/ServiceWorker", () => ({ SERVICE_WORKER_URL: "/service-worker.js" }));

const NOW = Date.parse("2026-10-25T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("when the card asks", () => {
    it("asks the first time, then holds 4 hours after Not now", () => {
        expect(shouldAsk(NOW, null, "ready", "default")).toBe(true);
        expect(shouldAsk(NOW, ago(ASK_AGAIN_AFTER_MS - 1000), "ready", "default")).toBe(false);
        expect(shouldAsk(NOW, ago(ASK_AGAIN_AFTER_MS), "ready", "default")).toBe(true);
    });

    it("holds 14 days once the browser blocked us", () => {
        expect(shouldAsk(NOW, ago(ASK_AGAIN_AFTER_MS), "ready", "denied")).toBe(false);
        expect(shouldAsk(NOW, ago(ASK_AGAIN_WHEN_BLOCKED_AFTER_MS), "ready", "denied")).toBe(true);
    });

    it("never asks where they are already on, or where the browser has no notifications", () => {
        expect(shouldAsk(NOW, null, "ready", "granted")).toBe(false);
        expect(shouldAsk(NOW, null, "unsupported", undefined)).toBe(false);
    });

    it("still offers the Home Screen way on an iPhone tab", () => {
        expect(shouldAsk(NOW, null, "iphone-tab", undefined)).toBe(true);
    });

    it("treats an unreadable last time as never asked", () => {
        expect(shouldAsk(NOW, "not a date", "ready", "default")).toBe(true);
    });
});

describe("the reply moment", () => {
    it("is a moment when writing to a bot", () => {
        expect(replyMoment({ isBot: true, place: { kind: "here" } }, "Nova")).toEqual({
            kind: "reply",
            name: "Nova",
            bot: true,
        });
    });

    it.each(["offline", "chatOnly"] as const)("is a moment when they are %s", (kind) => {
        expect(replyMoment({ isBot: false, place: { kind } }, "Sara")).toEqual({
            kind: "reply",
            name: "Sara",
            bot: false,
        });
    });

    it("is not a moment when they are in Universe to answer now", () => {
        expect(replyMoment({ isBot: false, place: { kind: "here" } }, "Sara")).toBeUndefined();
        expect(replyMoment({ isBot: false, place: { kind: "talking" } }, "Sara")).toBeUndefined();
    });

    it("is not a moment without a name to show", () => {
        expect(replyMoment({ isBot: true, place: { kind: "offline" } }, "")).toBeUndefined();
    });
});

const device = (overrides: Partial<PushDeviceInfo>): PushDeviceInfo => ({
    kind: "computer",
    browser: "chrome",
    os: "windows",
    installed: false,
    ...overrides,
});

describe("what the card shows first", () => {
    it("shows the Home Screen way on an iPhone tab, the steps when blocked, else the question", () => {
        expect(cardStartState("iphone-tab", undefined)).toBe("iphone");
        expect(cardStartState("ready", "denied")).toBe("blocked");
        expect(cardStartState("ready", "default")).toBe("ask");
    });

    it.each([
        [device({ os: "iphone", kind: "phone", browser: "safari", installed: true }), "iphoneApp"],
        [device({ browser: "firefox" }), "firefox"],
        [device({ os: "android", kind: "phone" }), "android"],
        [device({ os: "mac", browser: "safari" }), "safari"],
        [device({}), "desktop"],
    ])("gives the three unblock steps of this browser (%#)", (info, group) => {
        expect(blockedSteps(info)).toEqual([
            { group, key: "step1" },
            { group, key: "step2" },
            { group, key: "step3" },
        ]);
    });
});
