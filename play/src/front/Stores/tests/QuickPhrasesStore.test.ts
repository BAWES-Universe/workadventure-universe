import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: unknown[] = [];
let stored: unknown = null;

vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../Connection/LocalUserStore", () => ({
    localUserStore: {
        getEmojiFavorite: () => null,
        setEmojiFavorite: () => {},
        getQuickPhrases: () => stored,
        setQuickPhrases: (value: unknown) => saved.push(value),
    },
}));

describe("quickPhrasesStore", () => {
    beforeEach(() => {
        vi.resetModules();
        saved.length = 0;
        stored = null;
    });

    it("starts with the four translated defaults, stored as keys", async () => {
        const { quickPhrasesStore } = await import("../EmoteStore");
        expect(get(quickPhrasesStore)).toEqual([{ key: "hi" }, { key: "brb" }, { key: "thanks" }, { key: "ok" }]);
    });

    it("restores saved phrases", async () => {
        stored = [{ text: "Yo" }, { key: "brb" }, { key: "thanks" }, { key: "ok" }];
        const { quickPhrasesStore } = await import("../EmoteStore");
        expect(get(quickPhrasesStore)[0]).toEqual({ text: "Yo" });
    });

    it("stores an edited phrase as trimmed text, capped at 24 characters, and saves it", async () => {
        const { quickPhrasesStore } = await import("../EmoteStore");
        quickPhrasesStore.setPhrase(1, "   Back in a few minutes, promise   ");
        expect(get(quickPhrasesStore)[1]).toEqual({ text: "Back in a few minutes, p" });
        expect(saved.at(-1)).toEqual(get(quickPhrasesStore));
    });

    it("restores the translated default when the text is cleared", async () => {
        stored = [{ text: "Yo" }, { key: "brb" }, { key: "thanks" }, { key: "ok" }];
        const { quickPhrasesStore } = await import("../EmoteStore");
        quickPhrasesStore.setPhrase(0, "  ");
        expect(get(quickPhrasesStore)[0]).toEqual({ key: "hi" });
    });

    it("ignores out of range slots", async () => {
        const { quickPhrasesStore } = await import("../EmoteStore");
        quickPhrasesStore.setPhrase(4, "Nope");
        expect(get(quickPhrasesStore)).toHaveLength(4);
    });
});

describe("arrayQuickPhrase", () => {
    it("rejects malformed saved data", async () => {
        const { arrayQuickPhrase } = await import("../Utils/quickPhraseSchema");
        expect(arrayQuickPhrase.safeParse([{ key: "nope" }]).success).toBe(false);
        expect(
            arrayQuickPhrase.safeParse([{ text: "" }, { key: "brb" }, { key: "thanks" }, { key: "ok" }]).success
        ).toBe(false);
    });
});
