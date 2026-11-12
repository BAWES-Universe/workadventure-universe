import { describe, expect, it } from "vitest";
import type { BotData } from "../types";
import { brickChangeBetween, brickPutBack, brickSavedAfter, brickSavedOf } from "./brickSaves";

const bot = (over: Partial<BotData> = {}): BotData => ({
    id: "b1",
    name: "Brick",
    description: "Your own Brick",
    chatInstructions: "Be brief.",
    aiProviderRef: "universe-ai",
    aiModel: null,
    behaviorType: "idle",
    companionTextureId: null,
    behaviorConfig: {
        behaviorType: "idle",
        assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
        // What the other parts keep there: never sent from a Brick's page
        showToolCalls: true,
        apps: { waitsSeconds: 90 },
    },
    ...over,
});

describe("what a Brick's page saves (Slice 13)", () => {
    it("sends nothing while nothing changed, and never what other parts keep in the behavior config", () => {
        const saved = brickSavedOf(bot());
        expect(brickChangeBetween(saved, brickSavedOf(bot()))).toEqual({});
        expect(Object.keys(saved.behavior).sort()).toEqual(["assignedSpace", "behaviorType"]);
    });

    it("sends only what changed: the key it runs on with its model, a behavior key, the companion, its words", () => {
        const saved = brickSavedOf(bot());
        const now = brickSavedOf(
            bot({
                aiProviderRef: "key-1",
                aiModel: "m-2",
                companionTextureId: "dog-2",
                description: "  Keeps recipes ",
                behaviorType: "social",
                behaviorConfig: {
                    ...bot().behaviorConfig,
                    behaviorType: "social",
                    moves: "wander",
                    goesToPeople: false,
                    assignedSpace: { center: { x: 0, y: 0 }, radius: 150 },
                },
            })
        );
        expect(brickChangeBetween(saved, now)).toEqual({
            description: "Keeps recipes",
            aiProviderRef: "key-1",
            aiModel: "m-2",
            behaviorType: "social",
            behaviorConfig: {
                behaviorType: "social",
                moves: "wander",
                goesToPeople: false,
                assignedSpace: { center: { x: 0, y: 0 }, radius: 150 },
            },
            companionTextureId: "dog-2",
        });
    });

    it("sends a cleared companion and a cleared line as none", () => {
        const saved = brickSavedOf(bot({ companionTextureId: "dog-2" }));
        const now = brickSavedOf(bot({ companionTextureId: null, description: "  " }));
        expect(brickChangeBetween(saved, now)).toEqual({ description: null, companionTextureId: null });
    });

    it("counts a change as saved only for the parts it carried, so a later change is still sent", () => {
        const saved = brickSavedOf(bot());
        const now = brickSavedOf(bot({ aiProviderRef: "key-1", companionTextureId: "dog-2" }));
        const after = brickSavedAfter(saved, now, { aiProviderRef: "key-1" });
        expect(after.aiProviderRef).toBe("key-1");
        expect(brickChangeBetween(after, now)).toEqual({ companionTextureId: "dog-2" });
    });

    it("puts only the refused parts back, keeping what was typed or picked since", () => {
        const saved = brickSavedOf(bot());
        const shown = bot({
            aiProviderRef: "key-1",
            description: "Typed after",
            behaviorConfig: { ...bot().behaviorConfig, moves: "wander" },
        });
        const back = brickPutBack(shown, saved, { aiProviderRef: "key-1", behaviorConfig: { moves: "wander" } });
        expect(back.aiProviderRef).toBe("universe-ai");
        expect(back.behaviorConfig.moves).toBeUndefined();
        expect(back.behaviorConfig.showToolCalls).toBe(true);
        expect(back.description).toBe("Typed after");
    });
});
