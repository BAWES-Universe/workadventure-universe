import { describe, expect, it } from "vitest";
import type { MeetMessage } from "../MeetExchange";
import { classifyMeetMessage, MeetExchange } from "../MeetExchange";

const ME = "me-uuid";
const message = (overrides: Partial<MeetMessage>): MeetMessage => ({
    isMyMessage: false,
    type: "proximity",
    sender: { uuid: "other" },
    ...overrides,
});

describe("classifyMeetMessage", () => {
    it("counts my proximity text as my side", () => {
        expect(classifyMeetMessage(message({ isMyMessage: true, sender: { uuid: ME } }), ME)).toBe("mine");
    });

    it("counts someone else's message, text or media, as their side", () => {
        expect(classifyMeetMessage(message({}), ME)).toBe("theirs");
        expect(classifyMeetMessage(message({ type: "image" }), ME)).toBe("theirs");
        expect(classifyMeetMessage(message({ sender: { uuid: "bot-7" } }), ME)).toBe("theirs");
    });

    it("never counts my other tabs, unknown senders or local markers", () => {
        expect(classifyMeetMessage(message({ sender: { uuid: ME } }), ME)).toBe("ignore");
        expect(classifyMeetMessage(message({ sender: { uuid: "0" } }), ME)).toBe("ignore");
        expect(classifyMeetMessage(message({ sender: {} }), ME)).toBe("ignore");
        expect(classifyMeetMessage(message({ isMyMessage: true, type: "outcoming", session: {} }), ME)).toBe("ignore");
        expect(classifyMeetMessage(message({ type: "incoming", session: {} }), ME)).toBe("ignore");
        expect(classifyMeetMessage(message({ isMyMessage: true, notSent: true }), ME)).toBe("ignore");
    });
});

describe("MeetExchange", () => {
    it("completes once both sides spoke in the same session, in either order", () => {
        const exchange = new MeetExchange();
        exchange.enterSession("s1");
        expect(exchange.record("theirs", "s1")).toBe(false);
        expect(exchange.progress).toBe("idle");
        expect(exchange.record("mine", "s1")).toBe(true);
        expect(exchange.progress).toBe("exchanged");
        expect(exchange.record("theirs", "s1")).toBe(false);
    });

    it("reports a hello sent while waiting for a reply", () => {
        const exchange = new MeetExchange();
        exchange.enterSession("s1");
        exchange.record("mine", "s1");
        expect(exchange.progress).toBe("sent");
    });

    it("never pairs across sessions", () => {
        const exchange = new MeetExchange();
        exchange.enterSession("s1");
        exchange.record("mine", "s1");
        exchange.enterSession("s2");
        expect(exchange.progress).toBe("idle");
        expect(exchange.record("theirs", "s2")).toBe(false);
        expect(exchange.record("mine", "s1")).toBe(false);
    });

    it("counts nothing outside a bubble or after a reset", () => {
        const exchange = new MeetExchange();
        expect(exchange.record("mine", undefined)).toBe(false);
        exchange.enterSession("s1");
        exchange.record("mine", "s1");
        exchange.reset();
        expect(exchange.progress).toBe("idle");
        expect(exchange.currentSession).toBeUndefined();
    });
});
