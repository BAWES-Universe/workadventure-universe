import { describe, expect, it } from "vitest";
import {
    DEFAULT_VOICE_CHOICE,
    VOICE_CHOICES,
    choiceHearsBot,
    choiceSpeaksToBot,
    parseBotVoiceStatus,
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
