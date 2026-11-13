import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getBrickComputer: vi.fn<(brickId: string) => Promise<unknown>>(),
    brickComputerAction:
        vi.fn<(brickId: string, action: string, shown?: { what: string; where: string }) => Promise<unknown>>(),
    dismissBrickComputerNotice: vi.fn<(brickId: string, jobId: string) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: game }));

import {
    brickComputerAction,
    brickComputerOf,
    brickComputers,
    dismissComputerNotice,
    followBrickComputer,
    loadBrickComputer,
} from "../Computer/BrickComputerStore";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const computer = (over: Record<string, unknown> = {}) => ({
    computer: {
        available: true,
        on: true,
        machine: "resting",
        job: null,
        queued: [],
        month: null,
        files: { bytes: 0, savedAt: null },
        ...over,
    },
});
const runningJob = { id: "j1", title: "Book", status: "running", control: "brick" };

describe("the Bricks' computers store (#2000)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("has nothing for a Brick until it has read it, and reading wakes nothing", async () => {
        expect(brickComputerOf(BRICK)).toBeUndefined();
        game.getBrickComputer.mockResolvedValue(computer());
        const view = await loadBrickComputer(BRICK);
        expect(view?.machine).toBe("resting");
        expect(get(brickComputers).get(BRICK)?.on).toBe(true);
        expect(game.brickComputerAction).not.toHaveBeenCalled();
    });

    it("keeps what it had when a read fails", async () => {
        game.getBrickComputer.mockResolvedValueOnce(computer({ machine: "working", job: runningJob }));
        await loadBrickComputer(BRICK);
        game.getBrickComputer.mockRejectedValueOnce(new Error("offline"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(await loadBrickComputer(BRICK)).toBeUndefined();
        expect(brickComputerOf(BRICK)?.machine).toBe("working");
        warn.mockRestore();
    });

    it("takes the computer Orbit answers with, so the page and the bar agree", async () => {
        game.brickComputerAction.mockResolvedValue(computer({ on: false, machine: "none" }));
        expect(await brickComputerAction(BRICK, "turn-off")).toBe(true);
        expect(brickComputerOf(BRICK)?.on).toBe(false);
        expect(game.brickComputerAction).toHaveBeenCalledWith(BRICK, "turn-off");
    });

    it("reads the computer again after a job answer (take over, hand back)", async () => {
        game.brickComputerAction.mockResolvedValue({ job: { ...runningJob, control: "person" } });
        game.getBrickComputer.mockResolvedValue(
            computer({ machine: "working", job: { ...runningJob, control: "person" } })
        );
        expect(await brickComputerAction(BRICK, "take-over")).toBe(true);
        expect(game.getBrickComputer).toHaveBeenCalledTimes(1);
        expect(brickComputerOf(BRICK)?.job?.control).toBe("person");
    });

    it("says no and reads the page again when Orbit refuses", async () => {
        game.brickComputerAction.mockRejectedValue(new Error("409"));
        game.getBrickComputer.mockResolvedValue(computer());
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(await brickComputerAction(BRICK, "fill-details")).toBe(false);
        expect(game.getBrickComputer).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it("follows quickly while a job runs, slowly when idle, and stops when asked", async () => {
        game.getBrickComputer.mockResolvedValue(computer({ machine: "working", job: runningJob }));
        const stop = followBrickComputer(BRICK);
        await vi.advanceTimersByTimeAsync(0);
        expect(game.getBrickComputer).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4000);
        expect(game.getBrickComputer).toHaveBeenCalledTimes(2);
        game.getBrickComputer.mockResolvedValue(computer());
        await vi.advanceTimersByTimeAsync(4000);
        expect(game.getBrickComputer).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(4000);
        expect(game.getBrickComputer).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(16000);
        expect(game.getBrickComputer).toHaveBeenCalledTimes(4);
        stop();
        await vi.advanceTimersByTimeAsync(60000);
        expect(game.getBrickComputer).toHaveBeenCalledTimes(4);
    });

    it("dismisses the notice of one named ending, and keeps what Orbit answers with", async () => {
        game.dismissBrickComputerNotice.mockResolvedValue(computer({ notice: null }));
        expect(await dismissComputerNotice(BRICK, "j9")).toBe(true);
        expect(game.dismissBrickComputerNotice).toHaveBeenCalledWith(BRICK, "j9");
        expect(brickComputerOf(BRICK)?.notice).toBeNull();
    });

    it("reads the computer again when a dismiss fails, and says it did not work", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        game.dismissBrickComputerNotice.mockRejectedValue(new Error("offline"));
        game.getBrickComputer.mockResolvedValue(computer({ notice: { jobId: "j9", how: "month" } }));
        expect(await dismissComputerNotice(BRICK, "j9")).toBe(false);
        expect(game.getBrickComputer).toHaveBeenCalledTimes(1);
        expect(brickComputerOf(BRICK)?.notice).toEqual({ jobId: "j9", how: "month" });
        game.dismissBrickComputerNotice.mockResolvedValue({ nothing: true });
        expect(await dismissComputerNotice(BRICK, "j9")).toBe(false);
        warn.mockRestore();
    });

    describe("answers that come back in a different order", () => {
        const OTHER = "1c8d2e3f-2222-4333-8444-055566667777";
        const later = <T>() => {
            let settle!: (value: T) => void;
            const promise = new Promise<T>((resolve) => {
                settle = resolve;
            });
            return { promise, settle };
        };

        it("does not let a read that left before Stop replace Stop's answer", async () => {
            const poll = later<unknown>();
            game.getBrickComputer.mockReturnValueOnce(poll.promise);
            const reading = loadBrickComputer(OTHER);
            game.brickComputerAction.mockResolvedValue(computer({ machine: "resting", job: null }));
            expect(await brickComputerAction(OTHER, "stop")).toBe(true);
            expect(brickComputerOf(OTHER)?.job).toBeNull();
            // The read, sent before the tap, now answers with the job still running
            poll.settle(computer({ machine: "working", job: runningJob }));
            await reading;
            expect(brickComputerOf(OTHER)?.job).toBeNull();
            expect(brickComputerOf(OTHER)?.machine).toBe("resting");
        });

        it("keeps the newer read when an older one answers last", async () => {
            const first = later<unknown>();
            const second = later<unknown>();
            game.getBrickComputer.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
            const olderRead = loadBrickComputer(OTHER);
            const newerRead = loadBrickComputer(OTHER);
            second.settle(computer({ machine: "working", job: runningJob }));
            await newerRead;
            first.settle(computer({ machine: "resting", job: null }));
            await olderRead;
            expect(brickComputerOf(OTHER)?.machine).toBe("working");
        });

        it("shows a read that was sent after a tap even when the tap's answer comes last", async () => {
            const tap = later<unknown>();
            game.brickComputerAction.mockReturnValueOnce(tap.promise);
            const tapping = brickComputerAction(OTHER, "stop");
            game.getBrickComputer.mockResolvedValueOnce(computer({ machine: "working", job: runningJob }));
            await loadBrickComputer(OTHER);
            expect(brickComputerOf(OTHER)?.machine).toBe("working");
            tap.settle(computer({ machine: "resting", job: null }));
            await tapping;
            // The read was sent after the tap, so it is the newer picture and stays
            expect(brickComputerOf(OTHER)?.machine).toBe("working");
        });

        it("still shows each answer when they come back in the order they were asked", async () => {
            game.getBrickComputer.mockResolvedValueOnce(computer({ machine: "working", job: runningJob }));
            await loadBrickComputer(OTHER);
            expect(brickComputerOf(OTHER)?.machine).toBe("working");
            game.brickComputerAction.mockResolvedValue(computer({ machine: "resting", job: null }));
            await brickComputerAction(OTHER, "stop");
            expect(brickComputerOf(OTHER)?.machine).toBe("resting");
        });

        it("keeps each Brick's answers apart", async () => {
            const slow = later<unknown>();
            game.getBrickComputer.mockReturnValueOnce(slow.promise);
            const reading = loadBrickComputer(BRICK);
            game.getBrickComputer.mockResolvedValueOnce(computer({ machine: "working", job: runningJob }));
            await loadBrickComputer(OTHER);
            slow.settle(computer({ machine: "resting", job: null }));
            await reading;
            expect(brickComputerOf(BRICK)?.machine).toBe("resting");
            expect(brickComputerOf(OTHER)?.machine).toBe("working");
        });
    });
});
