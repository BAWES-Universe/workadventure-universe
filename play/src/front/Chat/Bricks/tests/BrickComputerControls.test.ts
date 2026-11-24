import { describe, expect, it } from "vitest";
import {
    barJob,
    allJobs,
    barState,
    endQuestion,
    inLine,
    isPaused,
    jobControls,
    jobRowState,
    jobsStopEnds,
    parseBrickComputer,
    parseComputerJob,
    parseJobActivity,
    pausedJobs,
    type BrickComputerView,
    type ComputerJob,
} from "../Computer/BrickComputer";

const job = (over: Record<string, unknown> = {}): ComputerJob => {
    const parsed = parseComputerJob({
        id: "j1",
        title: "Visa form",
        status: "running",
        queuedFor: null,
        stepDone: 2,
        stepTotal: 5,
        stepLabel: "Opening the site",
        waitingFor: null,
        control: "brick",
        ready: null,
        ...over,
    });
    if (!parsed) throw new Error("not a job");
    return parsed;
};
const waiting = (id: string, over: Record<string, unknown> = {}) =>
    job({ id, title: id, status: "queued", queuedFor: "turn", ...over });
const paused = (id: string, over: Record<string, unknown> = {}) =>
    waiting(id, { queuedFor: "paused", pausedAt: "2026-11-23T08:00:00.000Z", pausedWhy: "person", ...over });
const view = (over: Partial<BrickComputerView> = {}): BrickComputerView => ({
    available: true,
    on: true,
    machine: "working",
    job: job(),
    queued: [],
    month: null,
    files: { bytes: 0, savedAt: null },
    restoredFrom: null,
    notice: null,
    ...over,
});

describe("a paused job as the game reads it (computers plan, piece 7)", () => {
    it("reads a paused job, when it was paused and why", () => {
        const read = parseComputerJob({
            id: "j2",
            status: "queued",
            queuedFor: "paused",
            pausedAt: "2026-11-23T08:00:00.000Z",
            pausedWhy: "allowance",
        });
        expect(read).toMatchObject({
            queuedFor: "paused",
            pausedAt: "2026-11-23T08:00:00.000Z",
            pausedWhy: "allowance",
        });
        expect(isPaused(read)).toBe(true);
    });

    it("reads a pause at a spending limit the person set, and takes a pause it cannot name as the person's own", () => {
        expect(
            parseComputerJob({ id: "j2", status: "queued", queuedFor: "paused", pausedWhy: "rule" })?.pausedWhy
        ).toBe("rule");
        expect(
            parseComputerJob({ id: "j2", status: "queued", queuedFor: "paused", pausedWhy: "gremlins" })
        ).toMatchObject({ pausedWhy: "person", pausedAt: null });
    });

    it("never calls a job paused unless it waits in line marked paused", () => {
        const running = parseComputerJob({ id: "j1", status: "running", pausedAt: "2026-11-23", pausedWhy: "person" });
        expect(running).toMatchObject({ pausedAt: null, pausedWhy: null });
        expect(isPaused(running)).toBe(false);
        expect(isPaused(waiting("j2"))).toBe(false);
        expect(isPaused(null)).toBe(false);
    });

    it("keeps paused jobs in the computer Orbit sends, in its order", () => {
        const read = parseBrickComputer({
            computer: {
                available: true,
                on: true,
                machine: "resting",
                job: null,
                queued: [
                    { id: "a", status: "queued", queuedFor: "turn" },
                    { id: "b", status: "queued", queuedFor: "paused", pausedWhy: "person" },
                ],
                files: {},
            },
        });
        expect(read?.queued.map((queued) => queued.id)).toEqual(["a", "b"]);
        expect(inLine(read).map((queued) => queued.id)).toEqual(["a"]);
        expect(pausedJobs(read).map((queued) => queued.id)).toEqual(["b"]);
    });
});

describe("the bar with paused jobs", () => {
    it("is about the running job while one runs, whatever is paused", () => {
        const now = view({ queued: [paused("p1")] });
        expect(barState(now)).toBe("working");
        expect(barJob(now)?.id).toBe("j1");
    });

    it("shows the next job that starts by itself before any paused one", () => {
        const now = view({ machine: "resting", job: null, queued: [paused("p1"), waiting("w1")] });
        expect(barState(now)).toBe("queued");
        expect(barJob(now)?.id).toBe("w1");
    });

    it("says paused when only paused jobs are left, and nothing once they are gone", () => {
        const now = view({ machine: "resting", job: null, queued: [paused("p1"), paused("p2")] });
        expect(barState(now)).toBe("paused");
        expect(barJob(now)?.id).toBe("p1");
        expect(barState(view({ machine: "resting", job: null }))).toBeNull();
        expect(barJob(view({ machine: "resting", job: null }))).toBeNull();
    });

    it("says nothing for a computer that is off, paused jobs or not", () => {
        expect(barState(view({ on: false, job: null, queued: [paused("p1")] }))).toBeNull();
    });
});

describe("the taps a job row offers", () => {
    it("offers Pause and Cancel on the running job while Brick has it", () => {
        expect(jobControls(view(), "j1")).toEqual(["pause", "cancel"]);
    });

    it("offers Pause on a job waiting for its person too, while Brick still has the screen", () => {
        expect(jobControls(view({ job: job({ status: "waiting", waitingFor: "signin" }) }), "j1")).toEqual([
            "pause",
            "cancel",
        ]);
    });

    it("offers no Pause while the person has taken the screen over: they hand it back first", () => {
        expect(jobControls(view({ job: job({ status: "waiting", control: "person" }) }), "j1")).toEqual(["cancel"]);
    });

    it("offers Resume and Cancel on a paused job", () => {
        expect(jobControls(view({ queued: [paused("p1")] }), "p1")).toEqual(["resume", "cancel"]);
    });

    it("offers only Cancel on the job already next in line: it starts as soon as the computer is free", () => {
        expect(jobControls(view({ queued: [waiting("w1")] }), "w1")).toEqual(["cancel"]);
        expect(jobControls(view({ machine: "resting", job: null, queued: [waiting("w1")] }), "w1")).toEqual(["cancel"]);
    });

    it("offers Do this next on a job further back in line: it moves first, and nothing running is paused", () => {
        expect(jobControls(view({ queued: [waiting("w1"), waiting("w2")] }), "w2")).toEqual(["first", "cancel"]);
        const held = view({
            job: job({ status: "waiting", control: "person" }),
            queued: [waiting("w1"), waiting("w2")],
        });
        expect(jobControls(held, "w2")).toEqual(["first", "cancel"]);
    });

    it("counts only jobs that start by themselves when it decides what is next: a paused job ahead does not count", () => {
        expect(jobControls(view({ queued: [paused("p1"), waiting("w1")] }), "w1")).toEqual(["cancel"]);
    });

    it("offers nothing for a job it does not show, or on a computer that is off", () => {
        expect(jobControls(view(), "nope")).toEqual([]);
        expect(jobControls(view({ on: false }), "j1")).toEqual([]);
        expect(jobControls(undefined, "j1")).toEqual([]);
    });

    it("offers nothing on a job that already ended", () => {
        expect(jobControls(view({ job: job({ status: "done" }) }), "j1")).toEqual([]);
    });
});

describe("when Stop and Cancel ask first (the approved steering mock)", () => {
    it("ends the running job and every job in line with Stop, paused ones too", () => {
        const now = view({ queued: [waiting("w1"), paused("p1")] });
        expect(jobsStopEnds(now).map((each) => each.id)).toEqual(["j1", "w1", "p1"]);
    });

    it("asks before Stop ends several jobs, naming each", () => {
        const asked = endQuestion(view({ queued: [waiting("w1"), paused("p1")] }), { stop: true });
        expect(asked?.kind).toBe("all");
        expect(asked?.kind === "all" && asked.jobs.map((each) => each.id)).toEqual(["j1", "w1", "p1"]);
    });

    it("ends a single job at once on Stop: no question", () => {
        expect(endQuestion(view(), { stop: true })).toBeNull();
        expect(endQuestion(view({ machine: "resting", job: null, queued: [paused("p1")] }), { stop: true })).toBeNull();
    });

    it("names a job that has run back before Cancel ends it: running, held by the person, or paused after it ran", () => {
        expect(endQuestion(view(), { cancel: "j1" })).toMatchObject({ kind: "one", job: { id: "j1" } });
        const held = view({ job: job({ status: "waiting", control: "person" }) });
        expect(endQuestion(held, { cancel: "j1" })).toMatchObject({ kind: "one" });
        const ran = view({ machine: "resting", job: null, queued: [paused("p1", { pausedBefore: true })] });
        expect(endQuestion(ran, { cancel: "p1" })).toMatchObject({ kind: "one", job: { id: "p1" } });
        const back = view({ queued: [waiting("w1", { pausedBefore: true })] });
        expect(endQuestion(back, { cancel: "w1" })).toMatchObject({ kind: "one" });
    });

    it("cancels a job that never started at once: nothing is lost", () => {
        const now = view({ queued: [waiting("w1"), paused("p1")] });
        expect(endQuestion(now, { cancel: "w1" })).toBeNull();
        expect(endQuestion(now, { cancel: "p1" })).toBeNull();
    });

    it("asks nothing when there is nothing to end", () => {
        expect(endQuestion(view({ machine: "resting", job: null }), { stop: true })).toBeNull();
        expect(endQuestion(view(), { cancel: "gone" })).toBeNull();
        expect(endQuestion(undefined, { stop: true })).toBeNull();
    });
});

describe("what a job's row says it is doing", () => {
    it("tells working, waiting for the person, paused, comes back next, next, in line, out of time and busy apart", () => {
        const now = view({
            queued: [
                waiting("back", { pausedBefore: true }),
                waiting("w2"),
                waiting("used", { queuedFor: "allowance" }),
                waiting("full", { queuedFor: "pool" }),
                paused("p1"),
            ],
        });
        expect(jobRowState(now, now.job as ComputerJob)).toBe("working");
        expect(jobRowState(view({ machine: "waking" }), job())).toBe("waking");
        expect(jobRowState(now, job({ status: "waiting" }))).toBe("waiting-you");
        const state = (id: string) => jobRowState(now, now.queued.find((each) => each.id === id) as ComputerJob);
        expect(state("back")).toBe("comes-back");
        expect(state("w2")).toBe("in-line");
        expect(state("used")).toBe("used-up");
        expect(state("full")).toBe("busy");
        expect(state("p1")).toBe("paused");
        const plain = view({ queued: [waiting("w1")] });
        expect(jobRowState(plain, plain.queued[0])).toBe("next");
    });

    it("lists every job the way the person reads them: the one working, the line, then the paused ones", () => {
        const now = view({ queued: [paused("p1"), waiting("w1"), waiting("w2")] });
        expect(allJobs(now).map((each) => each.id)).toEqual(["j1", "w1", "w2", "p1"]);
        expect(allJobs(undefined)).toEqual([]);
    });

    it("reads a job that ran before from pausedBefore or from a count of its pauses", () => {
        expect(waiting("w1", { pausedBefore: true }).pausedBefore).toBe(true);
        expect(waiting("w1", { pauses: 2 }).pausedBefore).toBe(true);
        expect(waiting("w1").pausedBefore).toBe(false);
    });
});

describe("a job's Activity", () => {
    it("reads the steps oldest first, each once, whatever order they come in", () => {
        expect(
            parseJobActivity({
                steps: [
                    { seq: 2, label: "Filled in the dates", at: "2026-11-23T08:02:00.000Z" },
                    { seq: 1, label: "Opened the visa site", at: "2026-11-23T08:01:00.000Z" },
                    { seq: 2, label: "Filled in the dates", at: "2026-11-23T08:02:00.000Z" },
                ],
            })
        ).toEqual([
            { seq: 1, label: "Opened the visa site", at: "2026-11-23T08:01:00.000Z", kind: "step", detail: null },
            { seq: 2, label: "Filled in the dates", at: "2026-11-23T08:02:00.000Z", kind: "step", detail: null },
        ]);
    });

    it("drops a step with no words or no number, and keeps one with no time", () => {
        expect(
            parseJobActivity({
                steps: [{ seq: 1, label: "  " }, { label: "No number" }, null, { seq: 3, label: "Saved the form" }],
            })
        ).toEqual([{ seq: 3, label: "Saved the form", at: null, kind: "step", detail: null }]);
    });

    it("reads what kind of line it is and its detail, and takes a kind it does not know as a step", () => {
        expect(
            parseJobActivity({
                steps: [
                    { seq: 1, label: "Opened the visa site", detail: "evisa.gov.kw" },
                    { seq: 2, label: "Your message: business visa", kind: "note" },
                    { seq: 3, label: "Paused by you", kind: "pause" },
                    { seq: 4, label: "Carried on", kind: "resume" },
                    { seq: 5, label: "Something", kind: "explosion", detail: "  " },
                ],
            })?.map((step) => [step.kind, step.detail])
        ).toEqual([
            ["step", "evisa.gov.kw"],
            ["note", null],
            ["pause", null],
            ["resume", null],
            ["step", null],
        ]);
    });

    it("is nothing it can read when Orbit did not send steps", () => {
        expect(parseJobActivity({})).toBeUndefined();
        expect(parseJobActivity(null)).toBeUndefined();
        expect(parseJobActivity({ steps: [] })).toEqual([]);
    });
});
