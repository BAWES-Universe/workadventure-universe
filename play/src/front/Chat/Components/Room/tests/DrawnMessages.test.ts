import { describe, expect, it, vi } from "vitest";
import {
    drawEveryHeldMessage,
    drawnFrom,
    drawnStart,
    screenfulCount,
    onDrawEveryMessage,
    SHORT_MESSAGE_PX,
} from "../DrawnMessages";

const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];

describe("screenfulCount", () => {
    it("draws enough short messages to fill the screen", () => {
        expect(screenfulCount(SHORT_MESSAGE_PX * 20)).toBe(20);
        expect(screenfulCount(SHORT_MESSAGE_PX * 20 + 1)).toBe(21);
    });

    it("draws at least one", () => {
        expect(screenfulCount(0)).toBe(1);
    });
});

describe("drawnFrom", () => {
    it("starts from the newest messages", () => {
        expect(drawnFrom(ids, undefined, 3)).toBe("f");
    });

    it("draws everything when the chat holds no more than that", () => {
        expect(drawnFrom(ids, undefined, 8)).toBeUndefined();
        expect(drawnFrom(ids, undefined, 20)).toBeUndefined();
    });

    it("adds older messages above the oldest drawn", () => {
        expect(drawnFrom(ids, "f", 2)).toBe("d");
        expect(drawnFrom(ids, "e", 3)).toBe("b");
    });

    it("ends once the oldest message is reached", () => {
        expect(drawnFrom(ids, "c", 2)).toBeUndefined();
        expect(drawnFrom(ids, "d", 3)).toBeUndefined();
    });

    it("draws everything when the oldest drawn message is gone", () => {
        expect(drawnFrom(ids, "gone", 2)).toBeUndefined();
    });
});

describe("drawnStart", () => {
    it("starts at the oldest drawn message", () => {
        expect(drawnStart(ids, "f")).toBe(5);
    });

    it("starts at the beginning when everything is drawn", () => {
        expect(drawnStart(ids, undefined)).toBe(0);
    });

    it("starts at the beginning when the oldest drawn message is gone", () => {
        expect(drawnStart(ids, "gone")).toBe(0);
    });

    it("keeps its place when older messages come in above", () => {
        expect(drawnStart(["older", ...ids], "f")).toBe(6);
    });
});

describe("drawEveryHeldMessage", () => {
    it("asks every chat on screen to draw all it holds, until it is taken back", async () => {
        const draw = vi.fn(() => Promise.resolve());
        const stop = onDrawEveryMessage(draw);
        await drawEveryHeldMessage();
        expect(draw).toHaveBeenCalledTimes(1);
        stop();
        await drawEveryHeldMessage();
        expect(draw).toHaveBeenCalledTimes(1);
    });
});
