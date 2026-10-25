import { describe, expect, it, vi } from "vitest";
import {
    IDLE_AFTER_MS,
    REPORT_EVERY_MS,
    mustSend,
    readReport,
    startPushActivity,
    type FrontSignals,
} from "../PushActivity";

const { reportPushActivity } = vi.hoisted(() => ({
    reportPushActivity: vi.fn((_report: unknown, _keepalive?: boolean) => Promise.resolve()),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: { reportPushActivity } }));
vi.mock("../../../Chat/Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return { navChat: writable({ key: "chat" }) };
});
vi.mock("../../../Chat/Stores/SelectRoomStore", async () => {
    const { writable } = await import("svelte/store");
    return { selectedRoomStore: writable(undefined) };
});
vi.mock("../../../Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return { chatVisibilityStore: writable(false) };
});

const NOW = 1_000_000_000;
const signals = (overrides: Partial<FrontSignals> = {}): FrontSignals => ({
    visible: true,
    focused: true,
    lastInputAt: NOW - 1000,
    openChatRoomId: "!dm:chat",
    ...overrides,
});

describe("what a tab reports", () => {
    it("is in front only while shown, focused and used in the last 5 minutes, with the chat open there", () => {
        expect(readReport("tab-1", signals(), NOW)).toEqual({ tabId: "tab-1", front: true, chatRoomId: "!dm:chat" });
        expect(readReport("tab-1", signals({ visible: false }), NOW).front).toBe(false);
        expect(readReport("tab-1", signals({ focused: false }), NOW).front).toBe(false);
        expect(readReport("tab-1", signals({ lastInputAt: NOW - IDLE_AFTER_MS }), NOW)).toEqual({
            tabId: "tab-1",
            front: false,
            chatRoomId: null,
        });
    });
});

describe("when a tab reports", () => {
    const front = { tabId: "tab-1", front: true, chatRoomId: null };
    const back = { tabId: "tab-1", front: false, chatRoomId: null };

    it("says nothing until it is first in front", () => {
        expect(mustSend(null, back, 0, NOW)).toBe(false);
        expect(mustSend(null, front, 0, NOW)).toBe(true);
    });

    it("reports a change at once: to the back, or another chat", () => {
        expect(mustSend(front, back, NOW, NOW)).toBe(true);
        expect(mustSend(front, { ...front, chatRoomId: "!dm:chat" }, NOW, NOW)).toBe(true);
    });

    it("keeps being in front fresh every 30 seconds, and says nothing more while at the back", () => {
        expect(mustSend(front, front, NOW - REPORT_EVERY_MS + 1, NOW)).toBe(false);
        expect(mustSend(front, front, NOW - REPORT_EVERY_MS, NOW)).toBe(true);
        expect(mustSend(back, back, 0, NOW)).toBe(false);
    });
});

describe("a tab closing", () => {
    it("sends going to the back so it survives the page closing, even when hidden comes before pagehide", () => {
        let visibility: DocumentVisibilityState = "visible";
        const visibilitySpy = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
        const focusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true);
        reportPushActivity.mockClear();
        const stop = startPushActivity();
        expect(reportPushActivity).toHaveBeenLastCalledWith(expect.objectContaining({ front: true }), false);

        // Closing: hidden first, then pagehide
        visibility = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pagehide"));
        expect(reportPushActivity).toHaveBeenCalledTimes(2);
        expect(reportPushActivity).toHaveBeenLastCalledWith(expect.objectContaining({ front: false }), true);

        stop();
        visibilitySpy.mockRestore();
        focusSpy.mockRestore();
    });
});

describe("a tab used inside a frame", () => {
    it("stays in front while a call or website frame has the focus, though its input never reaches the page", () => {
        vi.useFakeTimers();
        const visibilitySpy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
        const focusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true);
        const frame = document.createElement("iframe");
        document.body.appendChild(frame);
        frame.focus();
        reportPushActivity.mockClear();
        const stop = startPushActivity();

        // Well past the idle time with no input on the page itself
        vi.advanceTimersByTime(IDLE_AFTER_MS + REPORT_EVERY_MS);
        expect(reportPushActivity).not.toHaveBeenCalledWith(expect.objectContaining({ front: false }), true);
        expect(reportPushActivity).toHaveBeenLastCalledWith(expect.objectContaining({ front: true }), false);

        stop();
        frame.remove();
        visibilitySpy.mockRestore();
        focusSpy.mockRestore();
        vi.useRealTimers();
    });
});
