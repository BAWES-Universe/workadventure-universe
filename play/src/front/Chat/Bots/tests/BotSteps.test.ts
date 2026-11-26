import { describe, expect, it } from "vitest";
import {
    STEPS_STALE_AFTER_MS,
    currentStep,
    parseBotSteps,
    readBotSteps,
    stepMore,
    stepsClock,
    msUntilStale,
    stoppedIfStale,
    tookWords,
    type BotStep,
    type BotSteps,
} from "../BotSteps";

const BOT_CHAT_ID = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.bawes.net";
const FIELD = {
    v: 1,
    state: "working",
    line: "Make a song",
    startedAt: 1000,
    steps: [
        { doing: "Reading workadventu.re", done: "Read a page", detail: "https://workadventu.re", state: "done" },
        { doing: "Make a song", done: "Make a song", detail: "funk", state: "running" },
        { doing: "Make a song", done: "Make a song", detail: "disco", state: "failed", again: true, note: "limit" },
    ],
};
const notice = (field: unknown) => ({ msgtype: "m.notice", body: "Make a song…", "universe.steps": field });

describe("readBotSteps", () => {
    it("reads the steps line a bot's notice carries", () => {
        expect(readBotSteps(BOT_CHAT_ID, notice(FIELD))).toEqual({
            state: "working",
            line: "Make a song",
            startedAt: 1000,
            steps: [
                {
                    doing: "Reading workadventu.re",
                    done: "Read a page",
                    detail: "https://workadventu.re",
                    state: "done",
                    again: false,
                    note: undefined,
                },
                {
                    doing: "Make a song",
                    done: "Make a song",
                    detail: "funk",
                    state: "running",
                    again: false,
                    note: undefined,
                },
                {
                    doing: "Make a song",
                    done: "Make a song",
                    detail: "disco",
                    state: "failed",
                    again: true,
                    note: "limit",
                },
            ],
        });
    });

    it("ignores steps from a person, on a text message, or of another version", () => {
        expect(readBotSteps("@alice:matrix.bawes.net", notice(FIELD))).toBeUndefined();
        expect(readBotSteps(BOT_CHAT_ID, { ...notice(FIELD), msgtype: "m.text" })).toBeUndefined();
        expect(readBotSteps(BOT_CHAT_ID, notice({ ...FIELD, v: 2 }))).toBeUndefined();
        expect(readBotSteps(BOT_CHAT_ID, notice({ ...FIELD, state: "thinking" }))).toBeUndefined();
        expect(readBotSteps(BOT_CHAT_ID, { msgtype: "m.notice", body: "hi" })).toBeUndefined();
        expect(readBotSteps(BOT_CHAT_ID, undefined)).toBeUndefined();
    });

    it("drops a step it can't draw, and cuts a long text", () => {
        const steps = readBotSteps(
            BOT_CHAT_ID,
            notice({
                ...FIELD,
                steps: [
                    { doing: "x", done: "y", state: "lost" },
                    null,
                    { doing: "a".repeat(500), done: "b", state: "done" },
                ],
            })
        );
        expect(steps?.steps).toHaveLength(1);
        expect(steps?.steps[0].doing).toHaveLength(200);
    });

    it("reads a call that may have run as no answer (#1692)", () => {
        const steps = readBotSteps(
            BOT_CHAT_ID,
            notice({
                ...FIELD,
                state: "done",
                line: "1 step",
                steps: [
                    {
                        doing: "Using Generate music",
                        done: "Used Generate music",
                        state: "unknown",
                        note: "No answer. May have finished",
                    },
                ],
            })
        );
        expect(steps?.steps).toEqual([
            {
                doing: "Using Generate music",
                done: "Used Generate music",
                detail: undefined,
                state: "unknown",
                again: false,
                note: "No answer. May have finished",
            },
        ]);
    });

    it("names the newest running step while working", () => {
        const steps = readBotSteps(BOT_CHAT_ID, notice(FIELD))!;
        expect(currentStep(steps)?.detail).toBe("funk");
        expect(currentStep({ ...steps, steps: [] })).toBeUndefined();
        // Every call finished: nothing runs, so no finished call's detail shows under "Writing the answer" (#1723)
        const finished = { ...steps, steps: steps.steps.map((step) => ({ ...step, state: "done" as const })) };
        expect(currentStep(finished)).toBeUndefined();
    });

    it("shows the clock in minutes and seconds", () => {
        expect(stepsClock(0)).toBe("0:00");
        expect(stepsClock(65.7)).toBe("1:05");
        expect(stepsClock(723)).toBe("12:03");
        expect(stepsClock(-3)).toBe("0:00");
    });
});

describe("stepMore", () => {
    const step = (state: BotStep["state"], extra: Partial<BotStep> = {}): BotStep => ({
        doing: "Using Search",
        done: "Used Search",
        state,
        again: false,
        ...extra,
    });

    it("shows why a call didn't work or may have run, else what it was about (#1723)", () => {
        expect(stepMore(step("done", { detail: "funk" }))).toBe("funk");
        expect(stepMore(step("failed", { detail: "funk", note: "Couldn't reach it. Nothing ran" }))).toBe(
            "Couldn't reach it. Nothing ran"
        );
        expect(stepMore(step("unknown", { detail: "funk", note: "No answer. May have finished" }))).toBe(
            "No answer. May have finished"
        );
        // A failed call without a note still says what it was about; a call with neither shows nothing
        expect(stepMore(step("failed", { detail: "funk" }))).toBe("funk");
        expect(stepMore(step("done"))).toBeUndefined();
    });
});

describe("waiting, times and what a step did (#2061)", () => {
    const base = { v: 1, state: "done", line: "Used Get a draft", startedAt: 0 };
    const step = {
        doing: "Using Update a draft",
        done: "Used Update a draft",
        state: "waiting",
        note: "Waiting for your OK. Nothing ran yet",
    };

    it("reads a step that waits for an OK, with its note", () => {
        const steps = parseBotSteps({ ...base, steps: [step] });
        expect(steps?.steps[0]).toMatchObject({ state: "waiting" });
        expect(stepMore(steps!.steps[0])).toBe("Waiting for your OK. Nothing ran yet");
    });

    it("reads each step's time and the total, and ignores a time that is not a plausible number", () => {
        const steps = parseBotSteps({
            ...base,
            took: 9,
            steps: [
                { ...step, state: "done", secs: 1.3 },
                { ...step, state: "done", secs: -4 },
                { ...step, state: "done", secs: "soon" },
            ],
        });
        expect(steps?.took).toBe(9);
        expect(steps?.steps.map((s) => s.secs)).toEqual([1.3, undefined, undefined]);
        expect(parseBotSteps({ ...base, took: 999_999, steps: [step] })?.took).toBeUndefined();
    });

    it("says a time in seconds, then minutes", () => {
        expect(tookWords(0.4)).toBe("0.4s");
        expect(tookWords(1.3)).toBe("1.3s");
        expect(tookWords(42.2)).toBe("42s");
        expect(tookWords(65)).toBe("1m 5s");
    });

    it("reads the lines a step opens to, drops empty ones and cuts the list", () => {
        const shows = [
            { label: "To", text: "a@b.co" },
            { text: "Draft updated" },
            { label: "Empty", text: "  " },
            7,
            ...Array.from({ length: 12 }, (_, i) => ({ text: `line ${i}` })),
        ];
        const read = parseBotSteps({ ...base, steps: [{ ...step, state: "done", shows }] })?.steps[0].shows;
        expect(read?.slice(0, 2)).toEqual([{ label: "To", text: "a@b.co" }, { text: "Draft updated" }]);
        expect(read?.length).toBeLessThanOrEqual(8);
        expect(
            parseBotSteps({ ...base, steps: [{ ...step, state: "done", shows: [] }] })?.steps[0].shows
        ).toBeUndefined();
    });
});

describe("a line that never ended (game #2131)", () => {
    const working: BotSteps = {
        state: "working",
        line: "Writing the answer",
        startedAt: 1_000_000,
        steps: [
            { doing: "Connecting Google Calendar", done: "Connected Google Calendar", state: "done", again: false },
            { doing: "Using Fetch emails", done: "Used Fetch emails", state: "running", again: false },
        ],
    };

    it("keeps a working line that began within the hour", () => {
        const result = stoppedIfStale(working, working.startedAt + STEPS_STALE_AFTER_MS);
        expect(result.stale).toBe(false);
        expect(result.steps).toBe(working);
    });

    it("shows a line still working an hour on as stopped, naming what finished, keeping every step as it was", () => {
        const result = stoppedIfStale(working, working.startedAt + STEPS_STALE_AFTER_MS + 1);
        expect(result.stale).toBe(true);
        expect(result.steps.state).toBe("stopped");
        expect(result.steps.line).toBe("Connected Google Calendar");
        expect(result.steps.steps).toEqual(working.steps);
    });

    it("never changes a line that ended or has no start time", () => {
        const done = { ...working, state: "done" as const };
        expect(stoppedIfStale(done, 99_999_999_999).stale).toBe(false);
        expect(stoppedIfStale({ ...working, startedAt: 0 }, 99_999_999_999).stale).toBe(false);
    });
});

describe("msUntilStale", () => {
    const base = { state: "working" as const, line: "Reading", startedAt: 1_000_000, steps: [] };
    it("counts down to the hour, and says nothing for a line that is not working or has no start", () => {
        expect(msUntilStale(base, 1_000_000)).toBe(STEPS_STALE_AFTER_MS + 1);
        expect(msUntilStale(base, 1_000_000 + STEPS_STALE_AFTER_MS + 5000)).toBe(1);
        expect(msUntilStale({ ...base, state: "done" }, 1_000_000)).toBeUndefined();
        expect(msUntilStale({ ...base, startedAt: 0 }, 1_000_000)).toBeUndefined();
    });
});
