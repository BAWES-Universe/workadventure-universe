import { afterEach, describe, expect, it, vi } from "vitest";
import { readHadProximityChat, rememberProximityChat, shouldShowSayHiCard } from "../SayHiCardStore";
import type { SayHiCardState } from "../SayHiCardStore";

const freshPlayer: SayHiCardState = {
    liveCardVisible: false,
    hasProximityHistory: false,
    hadProximityChatBefore: false,
    savedChatsEmpty: true,
};

describe("shouldShowSayHiCard", () => {
    it("shows for a new player with nothing in the list", () => {
        expect(shouldShowSayHiCard(freshPlayer)).toBe(true);
    });

    it("hides when the player has saved chats", () => {
        expect(shouldShowSayHiCard({ ...freshPlayer, savedChatsEmpty: false })).toBe(false);
    });

    it("hides while the saved chats are not known yet", () => {
        expect(shouldShowSayHiCard({ ...freshPlayer, savedChatsEmpty: undefined })).toBe(false);
    });

    it("hides while a live proximity card is on the list", () => {
        expect(shouldShowSayHiCard({ ...freshPlayer, liveCardVisible: true })).toBe(false);
    });

    it("hides once a proximity chat is in the list", () => {
        expect(shouldShowSayHiCard({ ...freshPlayer, hasProximityHistory: true })).toBe(false);
    });

    it("never comes back after a proximity chat on this device, even with an empty list", () => {
        expect(shouldShowSayHiCard({ ...freshPlayer, hadProximityChatBefore: true })).toBe(false);
    });
});

describe("the remembered proximity chat", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubStorage() {
        const data = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => void data.set(key, value),
        });
    }

    it("is false on a fresh device and true after the first proximity chat", () => {
        stubStorage();
        expect(readHadProximityChat()).toBe(false);
        rememberProximityChat();
        expect(readHadProximityChat()).toBe(true);
    });

    it("survives storage that refuses to answer", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
        });
        expect(readHadProximityChat()).toBe(false);
        expect(() => rememberProximityChat()).not.toThrow();
    });
});
