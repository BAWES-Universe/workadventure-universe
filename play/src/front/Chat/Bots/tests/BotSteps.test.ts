import { describe, expect, it } from "vitest";
import { currentStep, readBotSteps, stepMore, stepsClock, type BotStep } from "../BotSteps";

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
