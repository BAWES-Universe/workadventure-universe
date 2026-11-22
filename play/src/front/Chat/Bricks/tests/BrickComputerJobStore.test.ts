import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The calls on one job of a Brick's computer (computers plan, piece 7): pause, resume, do this next, cancel, a note, and the
 * job's Activity. Orbit is a stand-in here: it answers the way the agreed contract says.
 */
const game = vi.hoisted(() => ({
    getBrickComputer: vi.fn<(brickId: string) => Promise<unknown>>(),
    brickComputerAction: vi.fn<(brickId: string, action: string) => Promise<unknown>>(),
    dismissBrickComputerNotice: vi.fn<(brickId: string, jobId: string) => Promise<unknown>>(),
    brickComputerJobAction:
        vi.fn<
            (brickId: string, jobId: string, action: string, options?: { pauseRunning?: boolean }) => Promise<unknown>
        >(),
    noteToBrickComputerJob: vi.fn<(brickId: string, jobId: string, text: string) => Promise<unknown>>(),
    getBrickComputerJobActivity: vi.fn<(brickId: string, jobId: string) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: game }));

import {
    brickComputerJobAction,
    brickComputerOf,
    followJobActivity,
    jobActivities,
    loadBrickComputer,
    loadJobActivity,
    noteToComputerJob,
    pendingJobCalls,
} from "../Computer/BrickComputerStore";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const computer = (over: Record<string, unknown> = {}) => ({
    computer: {
        available: true,
        on: true,
        machine: "working",
        job: null,
        queued: [],
        month: null,
        files: { bytes: 0, savedAt: null },
        ...over,
    },
});
const running = { id: "j1", title: "Visa form", status: "running", control: "brick" };
const pausedVisa = {
    id: "j1",
    title: "Visa form",
    status: "queued",
    queuedFor: "paused",
    pausedAt: "2026-11-23T08:00:00.000Z",
    pausedWhy: "person",
};
const hotel = { id: "j2", title: "Hotel", status: "queued", queuedFor: "turn" };
const refused = (status: number, reason?: string) => Object.assign(new Error("refused"), { status, reason });
const later = <T>() => {
    let settle!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        settle = resolve;
    });
    return { promise, settle };
};

describe("calls on one job of a Brick's computer", () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        vi.clearAllMocks();
        warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
        warn.mockRestore();
        vi.useRealTimers();
    });

    it("pauses a job and shows the computer Orbit answers with: the job paused in line", async () => {
        game.brickComputerJobAction.mockResolvedValue(computer({ machine: "resting", queued: [pausedVisa] }));
        expect(await brickComputerJobAction(BRICK, "j1", "pause")).toEqual({ ok: true });
        expect(game.brickComputerJobAction).toHaveBeenCalledWith(BRICK, "j1", "pause");
        expect(brickComputerOf(BRICK)?.job).toBeNull();
        expect(brickComputerOf(BRICK)?.queued[0]).toMatchObject({ id: "j1", queuedFor: "paused", pausedWhy: "person" });
        expect(game.getBrickComputer).not.toHaveBeenCalled();
    });

    it("resumes and cancels with their own calls", async () => {
        game.brickComputerJobAction.mockResolvedValue(computer({ job: running }));
        await brickComputerJobAction(BRICK, "j1", "resume");
        game.brickComputerJobAction.mockResolvedValue(computer({ job: running }));
        await brickComputerJobAction(BRICK, "j2", "cancel");
        expect(game.brickComputerJobAction.mock.calls).toEqual([
            [BRICK, "j1", "resume"],
            [BRICK, "j2", "cancel"],
        ]);
    });

    it("moves a job first in line, or first now by pausing what runs, in one call", async () => {
        game.brickComputerJobAction.mockResolvedValue(computer({ job: running, queued: [hotel] }));
        await brickComputerJobAction(BRICK, "j2", "first");
        await brickComputerJobAction(BRICK, "j2", "first-now");
        expect(game.brickComputerJobAction.mock.calls).toEqual([
            [BRICK, "j2", "first"],
            [BRICK, "j2", "first", { pauseRunning: true }],
        ]);
    });

    it("sends a second tap on the same job nowhere while the first is on its way, and gives both the same answer", async () => {
        const answer = later<unknown>();
        game.brickComputerJobAction.mockReturnValueOnce(answer.promise);
        const first = brickComputerJobAction(BRICK, "j1", "pause");
        const second = brickComputerJobAction(BRICK, "j1", "pause");
        expect(get(pendingJobCalls).get(BRICK)?.has("j1")).toBe(true);
        answer.settle(computer({ machine: "resting", queued: [pausedVisa] }));
        expect(await first).toEqual({ ok: true });
        expect(await second).toEqual({ ok: true });
        expect(game.brickComputerJobAction).toHaveBeenCalledTimes(1);
        expect(get(pendingJobCalls).get(BRICK)).toBeUndefined();
    });

    it("sends a different tap on the same job after the first one's answer, so none is lost and the order holds", async () => {
        const answer = later<unknown>();
        game.brickComputerJobAction.mockReturnValueOnce(answer.promise);
        const pausing = brickComputerJobAction(BRICK, "j1", "pause");
        game.brickComputerJobAction.mockResolvedValueOnce(computer({ machine: "resting" }));
        const cancelling = brickComputerJobAction(BRICK, "j1", "cancel");
        await Promise.resolve();
        expect(game.brickComputerJobAction).toHaveBeenCalledTimes(1);
        answer.settle(computer({ machine: "resting", queued: [pausedVisa] }));
        expect(await pausing).toEqual({ ok: true });
        expect(await cancelling).toEqual({ ok: true });
        expect(game.brickComputerJobAction.mock.calls.map((call) => call[2])).toEqual(["pause", "cancel"]);
        expect(brickComputerOf(BRICK)?.queued).toEqual([]);
    });

    it("sends two different notes to the same job one after the other, and the same note once", async () => {
        const answer = later<unknown>();
        game.noteToBrickComputerJob.mockReturnValueOnce(answer.promise);
        const first = noteToComputerJob(BRICK, "j1", "Use 12 March");
        const again = noteToComputerJob(BRICK, "j1", "Use 12 March");
        game.noteToBrickComputerJob.mockResolvedValueOnce(computer({ job: running }));
        const second = noteToComputerJob(BRICK, "j1", "Skip the hotel");
        answer.settle(computer({ job: running }));
        await Promise.all([first, again, second]);
        expect(game.noteToBrickComputerJob.mock.calls.map((call) => call[2])).toEqual([
            "Use 12 March",
            "Skip the hotel",
        ]);
    });

    it("lets a tap on another job go out at once", async () => {
        const answer = later<unknown>();
        game.brickComputerJobAction.mockReturnValueOnce(answer.promise);
        const pausing = brickComputerJobAction(BRICK, "j1", "pause");
        game.brickComputerJobAction.mockResolvedValueOnce(computer({ job: running }));
        await brickComputerJobAction(BRICK, "j2", "cancel");
        expect(game.brickComputerJobAction).toHaveBeenCalledTimes(2);
        answer.settle(computer({ machine: "resting", queued: [pausedVisa] }));
        await pausing;
    });

    describe("a refusal", () => {
        beforeEach(() => {
            game.getBrickComputer.mockResolvedValue(computer({ job: { ...running, control: "person" } }));
        });

        it("says hand it back first when the person has the screen, and reads the computer again", async () => {
            game.brickComputerJobAction.mockRejectedValue(refused(409, "taken_over"));
            expect(await brickComputerJobAction(BRICK, "j1", "pause")).toEqual({ ok: false, why: "taken-over" });
            expect(game.getBrickComputer).toHaveBeenCalledTimes(1);
            expect(brickComputerOf(BRICK)?.job?.control).toBe("person");
        });

        it("says it is already ending when a stop or a finish got there first", async () => {
            game.brickComputerJobAction.mockRejectedValue(refused(409, "ending"));
            expect(await brickComputerJobAction(BRICK, "j1", "pause")).toEqual({ ok: false, why: "ending" });
        });

        it("says the job is gone for a job that is no longer there", async () => {
            game.brickComputerJobAction.mockRejectedValue(refused(404));
            expect(await brickComputerJobAction(BRICK, "j9", "cancel")).toEqual({ ok: false, why: "gone" });
            game.brickComputerJobAction.mockRejectedValue(refused(409, "over"));
            expect(await brickComputerJobAction(BRICK, "j9", "cancel")).toEqual({ ok: false, why: "gone" });
        });

        it("says the job moved on for any other refusal of its state, such as a resume of a job already resumed", async () => {
            game.brickComputerJobAction.mockRejectedValue(refused(409, "not_paused"));
            expect(await brickComputerJobAction(BRICK, "j1", "resume")).toEqual({ ok: false, why: "changed" });
            game.brickComputerJobAction.mockRejectedValue(refused(409));
            expect(await brickComputerJobAction(BRICK, "j1", "resume")).toEqual({ ok: false, why: "changed" });
        });

        it("says it failed when Orbit could not be reached", async () => {
            game.brickComputerJobAction.mockRejectedValue(new Error("Orbit did not answer in time"));
            expect(await brickComputerJobAction(BRICK, "j1", "pause")).toEqual({ ok: false, why: "failed" });
            game.brickComputerJobAction.mockRejectedValue(refused(500));
            expect(await brickComputerJobAction(BRICK, "j1", "pause")).toEqual({ ok: false, why: "failed" });
        });

        it("lets the next tap go out once a refusal came back", async () => {
            game.brickComputerJobAction.mockRejectedValueOnce(refused(409, "ending"));
            await brickComputerJobAction(BRICK, "j1", "pause");
            game.brickComputerJobAction.mockResolvedValueOnce(computer({ job: running }));
            expect(await brickComputerJobAction(BRICK, "j1", "cancel")).toEqual({ ok: true });
            expect(get(pendingJobCalls).get(BRICK)).toBeUndefined();
        });
    });

    it("reads the computer again when Orbit answers with something that is not the computer", async () => {
        game.brickComputerJobAction.mockResolvedValue({ ok: true });
        game.getBrickComputer.mockResolvedValue(computer({ machine: "resting", queued: [pausedVisa] }));
        expect(await brickComputerJobAction(BRICK, "j1", "pause")).toEqual({ ok: true });
        expect(game.getBrickComputer).toHaveBeenCalledTimes(1);
        expect(brickComputerOf(BRICK)?.queued[0]?.queuedFor).toBe("paused");
    });

    it("does not let a read that left before Pause replace Pause's answer", async () => {
        const slow = later<unknown>();
        game.getBrickComputer.mockReturnValueOnce(slow.promise);
        const reading = loadBrickComputer(BRICK);
        game.brickComputerJobAction.mockResolvedValue(computer({ machine: "resting", queued: [pausedVisa] }));
        await brickComputerJobAction(BRICK, "j1", "pause");
        slow.settle(computer({ job: running }));
        await reading;
        expect(brickComputerOf(BRICK)?.job).toBeNull();
        expect(brickComputerOf(BRICK)?.queued[0]?.queuedFor).toBe("paused");
    });

    it("sends a note in the person's words, without the spaces around them, and nothing for spaces alone", async () => {
        game.noteToBrickComputerJob.mockResolvedValue(computer({ job: running }));
        expect(await noteToComputerJob(BRICK, "j1", "  Use 12 March instead \n")).toEqual({ ok: true });
        expect(game.noteToBrickComputerJob).toHaveBeenCalledWith(BRICK, "j1", "Use 12 March instead");
        expect(await noteToComputerJob(BRICK, "j1", "   ")).toEqual({ ok: false, why: "changed" });
        expect(game.noteToBrickComputerJob).toHaveBeenCalledTimes(1);
    });
});

describe("a job's Activity", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("reads the steps and keeps what it had when a read fails", async () => {
        game.getBrickComputerJobActivity.mockResolvedValueOnce({ steps: [{ seq: 1, label: "Opened the visa site" }] });
        expect(await loadJobActivity(BRICK, "a1")).toEqual([{ seq: 1, label: "Opened the visa site", at: null }]);
        game.getBrickComputerJobActivity.mockRejectedValueOnce(new Error("offline"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(await loadJobActivity(BRICK, "a1")).toBeUndefined();
        warn.mockRestore();
        expect(get(jobActivities).get("a1")).toHaveLength(1);
    });

    it("keeps the newer read when an older one answers last", async () => {
        const slow = later<unknown>();
        game.getBrickComputerJobActivity.mockReturnValueOnce(slow.promise);
        const reading = loadJobActivity(BRICK, "a2");
        game.getBrickComputerJobActivity.mockResolvedValueOnce({
            steps: [
                { seq: 1, label: "Opened the visa site" },
                { seq: 2, label: "Filled in the dates" },
            ],
        });
        await loadJobActivity(BRICK, "a2");
        slow.settle({ steps: [{ seq: 1, label: "Opened the visa site" }] });
        await reading;
        expect(get(jobActivities).get("a2")).toHaveLength(2);
    });

    it("follows a job while it is going, reads once more when it ends, then stops", async () => {
        game.getBrickComputer.mockResolvedValueOnce(computer({ job: { ...running, id: "a3" } }));
        await loadBrickComputer(BRICK);
        game.getBrickComputerJobActivity.mockResolvedValue({ steps: [{ seq: 1, label: "Opened the visa site" }] });
        const stop = followJobActivity(BRICK, "a3");
        await vi.advanceTimersByTimeAsync(0);
        expect(game.getBrickComputerJobActivity).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4000);
        expect(game.getBrickComputerJobActivity).toHaveBeenCalledTimes(2);
        // The job ends: one more read for its last step, then nothing
        game.getBrickComputer.mockResolvedValueOnce(computer({ machine: "resting", job: null }));
        await loadBrickComputer(BRICK);
        await vi.advanceTimersByTimeAsync(4000);
        expect(game.getBrickComputerJobActivity).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(20000);
        expect(game.getBrickComputerJobActivity).toHaveBeenCalledTimes(3);
        stop();
    });

    it("keeps following a paused job's Activity slowly only while shown, and stops when let go", async () => {
        game.getBrickComputer.mockResolvedValueOnce(
            computer({ machine: "resting", queued: [{ ...pausedVisa, id: "a4" }] })
        );
        await loadBrickComputer(BRICK);
        game.getBrickComputerJobActivity.mockResolvedValue({ steps: [] });
        const stop = followJobActivity(BRICK, "a4");
        await vi.advanceTimersByTimeAsync(0);
        stop();
        await vi.advanceTimersByTimeAsync(20000);
        expect(game.getBrickComputerJobActivity).toHaveBeenCalledTimes(1);
    });
});
