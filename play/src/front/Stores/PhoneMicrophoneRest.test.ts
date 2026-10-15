import { describe, expect, it } from "vitest";
import { phoneMicrophoneCanRest } from "./PhoneMicrophoneRest";
import type { MicrophoneNeeds } from "./PhoneMicrophoneRest";

const alone: MicrophoneNeeds = {
    peers: 0,
    live: false,
    speaker: false,
    listener: false,
    inLivekit: false,
    megaphone: false,
    setupScreen: false,
};

describe("phoneMicrophoneCanRest", () => {
    it("rests when nobody is near and nothing needs the microphone", () => {
        expect(phoneMicrophoneCanRest(alone)).toBe(true);
    });

    it.each([
        ["someone is in the bubble", { peers: 1 }],
        ["a live session is on", { live: true }],
        ["speaking in a space", { speaker: true }],
        ["listening in a space", { listener: true }],
        ["in a meeting room", { inLivekit: true }],
        ["the megaphone is on or its set-up is open", { megaphone: true }],
        ["the camera and microphone set-up is open", { setupScreen: true }],
    ] as [string, Partial<MicrophoneNeeds>][])("does not rest when %s", (_name, change) => {
        expect(phoneMicrophoneCanRest({ ...alone, ...change })).toBe(false);
    });
});
