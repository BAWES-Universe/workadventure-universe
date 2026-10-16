import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

// The store only needs the API service to exist; nothing here reaches the network
vi.mock("../services/BotApiService", () => ({
    botApiService: { isInitialized: () => false },
}));

import { botPreviewsStore, loadBotPreviews } from "./BotEditorStore";

describe("loading bots into the editor", () => {
    it("keeps Show tool calls as it was saved, so the next save sends it back", () => {
        loadBotPreviews([
            {
                id: "on",
                behaviorType: "idle",
                behaviorConfig: {
                    behaviorType: "idle",
                    showToolCalls: true,
                    assignedSpace: { center: { x: 1, y: 2 }, radius: 0 },
                },
            },
            { id: "never", behaviorType: "idle", behaviorConfig: { behaviorType: "idle" } },
        ]);

        expect(get(botPreviewsStore).get("on")?.behaviorConfig.showToolCalls).toBe(true);
        expect(get(botPreviewsStore).get("never")?.behaviorConfig.showToolCalls).toBeUndefined();
    });
});
