import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { SpaceInterface } from "../../SpaceInterface";

// Only the stores matter here: the real modules pull in the whole game (environment, devices, i18n).
vi.mock("../../../Stores/MediaStore", () => ({
    clearAudienceTalking: vi.fn(),
    isSpeakerStore: writable(false),
    isListenerStore: writable(false),
    listenerWaitingMediaStore: writable(undefined),
}));
vi.mock("../../../Stores/MegaphoneStore", () => ({ currentLiveStreamingSpaceStore: writable(undefined) }));
vi.mock("../../../Stores/GameStore", () => ({ userCanModerateCallsStore: writable(false) }));
vi.mock("../RaiseHandStore", () => ({
    lowerHand: vi.fn(),
    myHandRaisedStore: writable(false),
    raisedHandsStore: writable([]),
    registerConversationSpace: vi.fn(),
}));

import {
    clearAudienceTalking,
    isListenerStore,
    isSpeakerStore,
    listenerWaitingMediaStore,
} from "../../../Stores/MediaStore";
import { currentLiveStreamingSpaceStore } from "../../../Stores/MegaphoneStore";
import {
    broughtOnStageStore,
    clearStageState,
    pendingInvitesStore,
    speakInvitationStore,
    speakingFromAudienceStore,
} from "../PodiumStore";

function fakeSpace(stopStreaming = vi.fn()) {
    return { stopStreaming } as unknown as SpaceInterface;
}

describe("clearStageState (the scene closes, e.g. a portal)", () => {
    beforeEach(() => {
        vi.mocked(clearAudienceTalking).mockClear();
        currentLiveStreamingSpaceStore.set(undefined);
        isSpeakerStore.set(false);
        isListenerStore.set(false);
        speakingFromAudienceStore.set(undefined);
        listenerWaitingMediaStore.set(undefined);
    });

    it("stops a speaker's stream and leaves no speaker state behind", () => {
        const stopStreaming = vi.fn();
        currentLiveStreamingSpaceStore.set(fakeSpace(stopStreaming));
        isSpeakerStore.set(true);

        clearStageState();

        expect(stopStreaming).toHaveBeenCalledTimes(1);
        expect(get(isSpeakerStore)).toBe(false);
        // The next room must not bind to the Stage the player left
        expect(get(currentLiveStreamingSpaceStore)).toBeUndefined();
    });

    it("also ends speaking from the audience, the audience flag and the waiting link", () => {
        const stopStreaming = vi.fn();
        currentLiveStreamingSpaceStore.set(fakeSpace(stopStreaming));
        isSpeakerStore.set(true);
        isListenerStore.set(true);
        listenerWaitingMediaStore.set("https://example.com/wait");
        speakingFromAudienceStore.set({ stop: vi.fn() });
        speakInvitationStore.set({ fromName: "Sara", accept: vi.fn(), decline: vi.fn() });
        pendingInvitesStore.set(new Set(["a"]));
        broughtOnStageStore.set(new Set(["b"]));

        clearStageState();

        expect(stopStreaming).toHaveBeenCalledTimes(1);
        expect(get(isSpeakerStore)).toBe(false);
        expect(get(isListenerStore)).toBe(false);
        expect(get(speakingFromAudienceStore)).toBeUndefined();
        expect(get(listenerWaitingMediaStore)).toBeUndefined();
        expect(clearAudienceTalking).toHaveBeenCalledTimes(1);
        expect(get(speakInvitationStore)).toBeUndefined();
        expect(get(pendingInvitesStore).size).toBe(0);
        expect(get(broughtOnStageStore).size).toBe(0);
    });

    it("does not touch the stream of someone who is not a speaker", () => {
        const stopStreaming = vi.fn();
        currentLiveStreamingSpaceStore.set(fakeSpace(stopStreaming));
        isListenerStore.set(true);

        clearStageState();

        expect(stopStreaming).not.toHaveBeenCalled();
        expect(get(isListenerStore)).toBe(false);
    });

    it("still resets everything when the space refuses to stop streaming", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        currentLiveStreamingSpaceStore.set(
            fakeSpace(
                vi.fn(() => {
                    throw new Error("everyone is always streaming here");
                })
            )
        );
        isSpeakerStore.set(true);

        clearStageState();

        expect(get(isSpeakerStore)).toBe(false);
        warn.mockRestore();
    });
});
