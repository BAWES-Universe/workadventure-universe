import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getBrickComputer: vi.fn<(brickId: string) => Promise<unknown>>(),
    brickComputerAction:
        vi.fn<(brickId: string, action: string, shown?: { what: string; where: string }) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: game }));

import {
    brickComputerAction,
    brickComputerOf,
    brickComputers,
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
});
