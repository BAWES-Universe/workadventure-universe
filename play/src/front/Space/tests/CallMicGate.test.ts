import { describe, expect, it } from "vitest";
import { get, writable } from "svelte/store";
import { cameraAllowedIn, gatedMicrophoneState, microphoneAllowedIn } from "../CallMicGate";

const CALL = "call__abc";

describe("the call's microphone gate (#2004, check 64)", () => {
    it("lets every space carry everything while no call is live", () => {
        expect(microphoneAllowedIn("a-bubble", undefined)).toBe(true);
        expect(microphoneAllowedIn(CALL, undefined)).toBe(true);
        expect(cameraAllowedIn(CALL, undefined)).toBe(true);
    });

    it("gives the microphone to exactly one side", () => {
        for (const owner of ["bot", "people"] as const) {
            const gate = { spaceName: CALL, owner };
            expect(microphoneAllowedIn(CALL, gate)).not.toBe(microphoneAllowedIn("a-bubble", gate));
        }
        expect(microphoneAllowedIn(CALL, { spaceName: CALL, owner: "bot" })).toBe(true);
        expect(microphoneAllowedIn("a-bubble", { spaceName: CALL, owner: "people" })).toBe(true);
    });

    it("never sends the camera to a call", () => {
        expect(cameraAllowedIn(CALL, { spaceName: CALL, owner: "bot" })).toBe(false);
        expect(cameraAllowedIn("a-bubble", { spaceName: CALL, owner: "bot" })).toBe(true);
    });

    it("shows a space's members the microphone off while the gate keeps it out of that space", () => {
        const requested = writable(true);
        const gate = writable<{ spaceName: string; owner: "bot" | "people" } | undefined>(undefined);
        const inBubble = gatedMicrophoneState("a-bubble", requested, gate);
        const inCall = gatedMicrophoneState(CALL, requested, gate);
        expect([get(inBubble), get(inCall)]).toEqual([true, true]);
        gate.set({ spaceName: CALL, owner: "bot" });
        expect([get(inBubble), get(inCall)]).toEqual([false, true]);
        gate.set({ spaceName: CALL, owner: "people" });
        expect([get(inBubble), get(inCall)]).toEqual([true, false]);
        requested.set(false);
        expect([get(inBubble), get(inCall)]).toEqual([false, false]);
    });
});
