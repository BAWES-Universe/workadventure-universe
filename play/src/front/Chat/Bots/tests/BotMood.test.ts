import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { botFeeling, forgetBotFeelings, setBotMood, setBotWork, WAVE_MOOD } from "../BotMood";
import { parseBotSteps, workKindOf } from "../BotSteps";

const field = (state: string, steps: object[]) => ({ v: 1, state, line: "x", startedAt: 1, steps });
const step = (kind: string | undefined, state: string) => ({ doing: "Doing", done: "Done", state, kind });

describe("how a bot feels beside its Woka (#1667)", () => {
    it("keeps the mood a reply came with, and clears it when the next reply has none", () => {
        const feeling = botFeeling("bot-a");
        expect(get(feeling)).toBeUndefined();
        setBotMood("bot-a", "😄");
        expect(get(feeling)?.mood).toBe("😄");
        const first = get(feeling)!.moodSeq;
        setBotMood("bot-a", "😄");
        expect(get(feeling)!.moodSeq).toBeGreaterThan(first);
        setBotMood("bot-a", undefined);
        expect(get(feeling)).toBeUndefined();
    });

    it("draws only the moods it knows", () => {
        setBotMood("bot-b", "💣");
        expect(get(botFeeling("bot-b"))).toBeUndefined();
    });

    it("draws the wave a bot gives a person who said they are done (#1670)", () => {
        setBotMood("bot-w", WAVE_MOOD);
        expect(get(botFeeling("bot-w"))?.mood).toBe("👋");
        setBotMood("bot-w", undefined);
    });

    it("keeps work and mood apart, each bot on its own", () => {
        setBotWork("bot-c", "search");
        setBotMood("bot-c", "🙂");
        expect(get(botFeeling("bot-c"))).toMatchObject({ mood: "🙂", work: "search" });
        setBotWork("bot-c", undefined);
        expect(get(botFeeling("bot-c"))?.work).toBeUndefined();
        expect(get(botFeeling("bot-d"))).toBeUndefined();
        setBotMood("bot-c", undefined);
    });
});

describe("forgetBotFeelings", () => {
    it("lets one bot's emoji go when it leaves, or every bot's when the chat closes", () => {
        setBotWork("bot-e", "read");
        setBotMood("bot-f", "😄");
        forgetBotFeelings("bot-e");
        expect(get(botFeeling("bot-e"))).toBeUndefined();
        expect(get(botFeeling("bot-f"))?.mood).toBe("😄");
        forgetBotFeelings();
        expect(get(botFeeling("bot-f"))).toBeUndefined();
    });
});

describe("workKindOf", () => {
    it("is what the newest running step is about", () => {
        const steps = parseBotSteps(field("working", [step("read", "done"), step("search", "running")]))!;
        expect(workKindOf(steps)).toBe("search");
    });

    it("is writing once every step has finished and the answer is being written", () => {
        expect(workKindOf(parseBotSteps(field("working", [step("read", "done")]))!)).toBe("write");
    });

    it("is writing for a step the bot server gave no kind", () => {
        expect(workKindOf(parseBotSteps(field("working", [step(undefined, "running")]))!)).toBe("write");
    });

    it("is nothing once the line is done or stopped", () => {
        expect(workKindOf(parseBotSteps(field("done", [step("read", "done")]))!)).toBeUndefined();
        expect(workKindOf(parseBotSteps(field("stopped", [step("read", "failed")]))!)).toBeUndefined();
    });
});
