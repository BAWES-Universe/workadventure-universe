import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import {
    createGuidanceStore,
    emptyGuidance,
    isLearned,
    markKnown,
    mergeGuidance,
    parseGuidance,
    recordUse,
    SEPARATE_USE_GAP_MS,
    shouldTeach,
    type GuidanceStorage,
} from "../QuestGuidance";

function memoryStorage(initial: string | null = null): GuidanceStorage & { value: string | null } {
    return {
        value: initial,
        load() {
            return this.value;
        },
        save(value) {
            this.value = value;
        },
    };
}

describe("QuestGuidance", () => {
    it("teaches a capability nobody has used yet", () => {
        expect(shouldTeach(emptyGuidance(), "express")).toBe(true);
    });

    it("counts one Express tap as not learned", () => {
        const state = recordUse(emptyGuidance(), "express", 1_000);
        expect(isLearned(state, "express")).toBe(false);
        expect(shouldTeach(state, "express")).toBe(true);
    });

    it("counts the same Express use reported twice as one use", () => {
        const once = recordUse(emptyGuidance(), "express", 1_000);
        const twice = recordUse(once, "express", 1_000 + SEPARATE_USE_GAP_MS - 1);
        expect(twice).toBe(once);
        expect(isLearned(twice, "express")).toBe(false);
    });

    it("learns Express after two separate uses", () => {
        const once = recordUse(emptyGuidance(), "express", 1_000);
        const twice = recordUse(once, "express", 1_000 + SEPARATE_USE_GAP_MS);
        expect(isLearned(twice, "express")).toBe(true);
        expect(shouldTeach(twice, "express")).toBe(false);
    });

    it("learns single-use capabilities on the first use", () => {
        expect(isLearned(recordUse(emptyGuidance(), "build", 1), "build")).toBe(true);
    });

    it("treats a clock that went backwards as a separate use", () => {
        const once = recordUse(emptyGuidance(), "express", 100_000);
        expect(isLearned(recordUse(once, "express", 50_000), "express")).toBe(true);
    });

    it("does not count one capability's use toward another", () => {
        const state = recordUse(recordUse(emptyGuidance(), "chat", 1), "express", 1);
        expect(isLearned(state, "chat")).toBe(true);
        expect(isLearned(state, "express")).toBe(false);
    });

    it("learns at once on I know this, and remembers the player told us", () => {
        const state = markKnown(emptyGuidance(), "express");
        expect(isLearned(state, "express")).toBe(true);
        expect(state.capabilities.express?.toldUs).toBe(true);
    });

    it("ignores uses after a capability is learned", () => {
        const learned = markKnown(emptyGuidance(), "express");
        expect(recordUse(learned, "express", 99)).toBe(learned);
    });

    it("parses garbage as an empty state and drops bad entries", () => {
        expect(parseGuidance("{")).toEqual(emptyGuidance());
        expect(parseGuidance(JSON.stringify({ version: 2, capabilities: {} }))).toEqual(emptyGuidance());
        const parsed = parseGuidance(
            JSON.stringify({
                version: 1,
                capabilities: {
                    express: { uses: 1, lastUseAt: 5, learned: false, toldUs: false },
                    chat: { uses: -1, lastUseAt: null, learned: true, toldUs: false },
                    hack: { uses: 1, lastUseAt: null, learned: true, toldUs: false },
                },
            })
        );
        expect(Object.keys(parsed.capabilities)).toEqual(["express"]);
    });

    it("keeps a capability learned when two tabs disagree", () => {
        const learned = recordUse(emptyGuidance(), "build", 1);
        const other = recordUse(emptyGuidance(), "express", 1);
        const merged = mergeGuidance(learned, other);
        expect(isLearned(merged, "build")).toBe(true);
        expect(merged.capabilities.express?.uses).toBe(1);
        expect(isLearned(mergeGuidance(other, learned), "build")).toBe(true);
    });

    it("saves through its storage and survives a reload", () => {
        const storage = memoryStorage();
        const store = createGuidanceStore(storage);
        store.recordUse("express", 1_000);
        store.recordUse("express", 1_000 + SEPARATE_USE_GAP_MS);
        expect(isLearned(get(store), "express")).toBe(true);
        expect(isLearned(get(createGuidanceStore(storage)), "express")).toBe(true);
    });

    it("keeps what another tab learned when it saves", () => {
        const storage = memoryStorage();
        const tabA = createGuidanceStore(storage);
        const tabB = createGuidanceStore(storage);
        tabA.markKnown("build");
        tabB.recordUse("express", 1);
        const reloaded = get(createGuidanceStore(storage));
        expect(isLearned(reloaded, "build")).toBe(true);
        expect(reloaded.capabilities.express?.uses).toBe(1);
    });

    it("does not write when nothing changed", () => {
        const storage = memoryStorage();
        const store = createGuidanceStore(storage);
        store.recordUse("express", 1);
        const saved = storage.value;
        storage.value = "sentinel";
        store.recordUse("express", 2);
        expect(storage.value).toBe("sentinel");
        expect(saved).not.toBeNull();
    });
});
