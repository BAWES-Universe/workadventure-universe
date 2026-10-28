import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store only needs the API service to exist; nothing here reaches the network
vi.mock("../services/BotApiService", () => ({
    botApiService: { isInitialized: () => false },
}));

import type { BotData } from "../types";
import {
    botEditorModeStore,
    botPreviewsStore,
    botsLoadingStore,
    selectBotWhenLoaded,
    selectedBotStore,
} from "./BotEditorStore";

const nora = { id: "nora", name: "Nora", behaviorType: "idle" } as BotData;

describe('"Use my AI key" opening a bot\'s page (#1159)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        botPreviewsStore.set(new Map([[nora.id, nora]]));
        botsLoadingStore.set(0);
        selectedBotStore.set(undefined);
        botEditorModeStore.set("list");
    });

    afterEach(() => vi.useRealTimers());

    it("waits for the editor's load when the bot is already kept from an earlier visit (CodeRabbit on #1524)", () => {
        let open = false;
        selectBotWhenLoaded(
            nora.id,
            () => open,
            () => true,
            Date.now() + 8000
        );
        expect(get(selectedBotStore)).toBeUndefined();
        // The editor mounts and starts loading this room's bots
        open = true;
        botsLoadingStore.set(1);
        vi.advanceTimersByTime(300);
        expect(get(selectedBotStore)).toBeUndefined();
        botsLoadingStore.set(0);
        vi.advanceTimersByTime(300);
        expect(get(selectedBotStore)?.id).toBe("nora");
        expect(get(botEditorModeStore)).toBe("detail");
    });

    it("opens the page at once when the editor is open and loaded", () => {
        selectBotWhenLoaded(
            nora.id,
            () => true,
            () => true,
            Date.now() + 8000
        );
        expect(get(selectedBotStore)?.id).toBe("nora");
    });

    it("stops when the editor it was asked for is gone, and gives up at the deadline", () => {
        let alive = true;
        selectBotWhenLoaded(
            nora.id,
            () => false,
            () => alive,
            Date.now() + 8000
        );
        alive = false;
        vi.advanceTimersByTime(10_000);
        expect(get(selectedBotStore)).toBeUndefined();

        selectBotWhenLoaded(
            "not-here",
            () => true,
            () => true,
            Date.now() + 900
        );
        vi.advanceTimersByTime(10_000);
        expect(get(selectedBotStore)).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });
});
