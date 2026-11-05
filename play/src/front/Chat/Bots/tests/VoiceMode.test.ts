import { describe, expect, it } from "vitest";
import {
    DEFAULT_VOICE_CHOICE,
    VOICE_CHOICES,
    choiceHearsBot,
    choiceSpeaksToBot,
    parseBotVoiceStatus,
    voiceAllowanceLine,
    voiceButtonState,
    voiceModeOf,
} from "../VoiceMode";

describe("the four ways to talk with bots", () => {
    it("starts with talk and listen", () => {
        expect(DEFAULT_VOICE_CHOICE).toBe("talk");
        expect(VOICE_CHOICES).toEqual(["talk", "speak_and_read", "type_and_listen", "text_only"]);
    });

    it("gives the voice worker its own mode for each, text only being off", () => {
        expect(VOICE_CHOICES.map(voiceModeOf)).toEqual(["talk", "speak_and_read", "type_and_listen", "off"]);
    });

    it("says who is heard: you only in talk and listen, and speak and read; the bot only in talk and listen, and type and listen", () => {
        expect(VOICE_CHOICES.map(choiceSpeaksToBot)).toEqual([true, true, false, false]);
        expect(VOICE_CHOICES.map(choiceHearsBot)).toEqual([true, false, true, false]);
    });
});

describe("what a bot says about its voice", () => {
    it("is read from the bot's event", () => {
        expect(parseBotVoiceStatus({ botId: "b-1", botName: " Nora ", state: "on", followUpSeconds: 30 }, "x")).toEqual(
            {
                botId: "b-1",
                botName: "Nora",
                state: "on",
                followUpSeconds: 30,
            }
        );
    });

    it("takes the name of the bot's user when the event has none, and no seconds as none", () => {
        expect(parseBotVoiceStatus({ botId: "b-1", botName: "", state: "paused", followUpSeconds: 0 }, "Nora")).toEqual(
            {
                botId: "b-1",
                botName: "Nora",
                state: "paused",
                followUpSeconds: 0,
            }
        );
    });

    it.each([
        ["nothing", undefined],
        ["no bot", { botName: "Nora", state: "on" }],
        ["an empty bot id", { botId: "", state: "on" }],
        ["a state we do not know", { botId: "b-1", state: "listening" }],
        ["a state that is not text", { botId: "b-1", state: 1 }],
    ])("is refused with %s", (_name, value) => {
        expect(parseBotVoiceStatus(value, "Nora")).toBeUndefined();
    });

    it.each([-5, 1.5, 1e9, Number.NaN, "30"])("takes %s seconds as none", (seconds) => {
        expect(
            parseBotVoiceStatus({ botId: "b-1", state: "on", followUpSeconds: seconds }, "Nora")?.followUpSeconds
        ).toBe(0);
    });
});

describe("what a bot says is left of a person's spoken replies (#1669)", () => {
    const at = "2026-11-02T13:00:00.000Z";
    const parse = (extra: object) => parseBotVoiceStatus({ botId: "b-1", state: "on", ...extra }, "Nora");

    it("is read with the end of the window, as a time", () => {
        expect(parse({ repliesLeft: 18, repliesResetAt: at })).toMatchObject({
            repliesLeft: 18,
            repliesResetAt: Date.parse(at),
        });
        // None left is a count too, not a missing one
        expect(parse({ repliesLeft: 0, repliesResetAt: at })?.repliesLeft).toBe(0);
    });

    it("is none when the bot has no count, and a time with no count is dropped", () => {
        expect(parse({})).toMatchObject({ repliesLeft: undefined, repliesResetAt: undefined });
        expect(parse({ repliesResetAt: at })).toMatchObject({ repliesLeft: undefined, repliesResetAt: undefined });
    });

    it.each([-1, 2.5, 1e9, Number.NaN, "5", null])("takes a count of %s as none", (count) => {
        expect(parse({ repliesLeft: count, repliesResetAt: at })).toMatchObject({
            repliesLeft: undefined,
            repliesResetAt: undefined,
        });
    });

    it.each(["", "soon", 5, null])("takes %s as no end time", (time) => {
        expect(parse({ repliesLeft: 3, repliesResetAt: time })).toMatchObject({
            repliesLeft: 3,
            repliesResetAt: undefined,
        });
    });

    describe("what the menu says", () => {
        const now = Date.parse("2026-11-02T10:00:00.000Z");
        const later = Date.parse(at);

        it("says how many are left, with the time more come when a window is running", () => {
            expect(voiceAllowanceLine({ repliesLeft: 18, repliesResetAt: later }, now)).toEqual({
                kind: "left",
                count: 18,
                resetsAt: later,
            });
            expect(voiceAllowanceLine({ repliesLeft: 25, repliesResetAt: undefined }, now)).toEqual({
                kind: "left",
                count: 25,
                resetsAt: undefined,
            });
        });

        it("says they are used up when none is left", () => {
            expect(voiceAllowanceLine({ repliesLeft: 0, repliesResetAt: later }, now)).toEqual({
                kind: "used_up",
                resetsAt: later,
            });
        });

        it("says nothing without a count, or once the window it counted has ended", () => {
            expect(voiceAllowanceLine({ repliesLeft: undefined, repliesResetAt: undefined }, now)).toEqual({
                kind: "none",
            });
            expect(voiceAllowanceLine({ repliesLeft: 0, repliesResetAt: later }, later + 1)).toEqual({ kind: "none" });
            expect(voiceAllowanceLine({ repliesLeft: 4, repliesResetAt: later }, later)).toEqual({ kind: "none" });
        });
    });
});

describe("which state the Voice button shows", () => {
    it("shows the choice when the voice is on", () => {
        expect(VOICE_CHOICES.map((choice) => voiceButtonState(choice, "on", false))).toEqual(VOICE_CHOICES);
    });

    it("shows a paused voice and a connecting one before anything else", () => {
        for (const choice of VOICE_CHOICES) {
            expect(voiceButtonState(choice, "paused", true)).toBe("paused");
            expect(voiceButtonState(choice, "connecting", true)).toBe("connecting");
        }
    });

    it("asks for a tap when the browser blocked the sound, but only when you are to hear the bot", () => {
        expect(voiceButtonState("talk", "on", true)).toBe("tap_to_hear");
        expect(voiceButtonState("type_and_listen", "on", true)).toBe("tap_to_hear");
        expect(voiceButtonState("speak_and_read", "on", true)).toBe("speak_and_read");
        expect(voiceButtonState("text_only", "on", true)).toBe("text_only");
    });
});
