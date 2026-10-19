import { describe, expect, it } from "vitest";
import type { BotAiOptions, BotData, VisionPick } from "./types";
import {
    canPickVision,
    readVisionPick,
    visionCandidates,
    visionMain,
    visionState,
    withVisionChoice,
    withoutRefused,
} from "./visionModel";

const key = (id: string, over: Partial<BotAiOptions["keys"][number]> = {}): BotAiOptions["keys"][number] => ({
    id,
    name: `Key ${id}`,
    kind: "deepseek",
    kindLabel: "DeepSeek",
    group: "hosted",
    universeName: "Sandbox Universe",
    status: "working",
    ifDown: "universe-ai",
    model: "deepseek-v4-flash",
    supportsVision: false,
    visionModels: ["deepseek-v4-flash-vision-exp"],
    ...over,
});

const gemini = key("key-g", {
    name: "My OpenRouter",
    model: "gemini-3-flash",
    supportsVision: true,
    visionModels: ["gemini-3-flash"],
});
const lmStudio = key("key-l", {
    name: "My LM Studio",
    group: "own-computer",
    model: "qwen3-8b",
    supportsVision: null,
    visionModels: [],
});

const options = (over: Partial<BotAiOptions> = {}): BotAiOptions => ({
    current: "universe-ai",
    universeAi: { available: true, model: "deepseek-v4-flash", supportsVision: null },
    maker: { id: "me", name: "Mishari" },
    viewerIsMaker: true,
    keys: [key("key-1"), gemini, lmStudio],
    currentKey: null,
    vision: { saved: null, savedKey: null },
    providers: null,
    ...over,
});

const bot = (vision?: VisionPick | null): Pick<BotData, "behaviorConfig"> => ({
    behaviorConfig: {
        assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
        ...(vision === undefined ? {} : { vision }),
    },
});

describe("readVisionPick", () => {
    it("reads the three choices and nothing else", () => {
        expect(readVisionPick(bot({ choice: "this" }))).toEqual({ choice: "this" });
        expect(readVisionPick(bot({ choice: "universe-ai" }))).toEqual({ choice: "universe-ai" });
        const another = { choice: "another", keyId: "key-1", model: "m" } as const;
        expect(readVisionPick(bot(another))).toEqual(another);
        expect(readVisionPick(bot())).toBeNull();
        expect(readVisionPick(bot(null))).toBeNull();
        expect(readVisionPick({ behaviorConfig: { vision: { choice: "another" } } } as never)).toBeNull();
        expect(readVisionPick({ behaviorConfig: { vision: "this" } } as never)).toBeNull();
    });
});

describe("visionMain", () => {
    it("Universe AI: its model, and whether that sees", () => {
        expect(visionMain(options(), "universe-ai")).toMatchObject({
            name: "Universe AI",
            model: "deepseek-v4-flash",
            sees: false,
            keyId: null,
        });
        expect(
            visionMain(options({ universeAi: { available: true, model: "gemini-3-flash" } }), "universe-ai")?.sees
        ).toBe(true);
    });

    it("one of the maker's keys: its name, model, where it runs, and the other Vision models on the same key", () => {
        expect(visionMain(options(), "key-1")).toEqual({
            name: "Key key-1",
            model: "deepseek-v4-flash",
            sees: false,
            keyId: "key-1",
            group: "hosted",
            sameKeyModels: ["deepseek-v4-flash-vision-exp"],
        });
        expect(visionMain(options(), "key-g")).toMatchObject({ sees: true, sameKeyModels: [] });
        expect(visionMain(options(), "key-l")).toMatchObject({ sees: false, group: "own-computer", sameKeyModels: [] });
    });

    it("someone else's key the bot is on, read from what Orbit says about it", () => {
        const others = options({
            current: "key-9",
            viewerIsMaker: false,
            keys: [],
            currentKey: {
                id: "key-9",
                name: "Mishari’s DeepSeek",
                ownerName: "Mishari",
                mine: false,
                status: "working",
                ifDown: "universe-ai",
                group: "hosted",
                model: "deepseek-v4-flash",
                supportsVision: false,
                visionModels: ["deepseek-v4-flash-vision-exp"],
            },
        });
        expect(visionMain(others, "key-9")).toMatchObject({
            name: "Mishari’s DeepSeek",
            keyId: "key-9",
            sameKeyModels: ["deepseek-v4-flash-vision-exp"],
        });
    });

    it("nothing for a pinned provider, no AI, Universe AI that isn't ready, or an Orbit that doesn't say", () => {
        expect(visionMain(options({ current: "lmstudio-local" }), "lmstudio-local")).toBeNull();
        expect(visionMain(options(), null)).toMatchObject({ name: "Universe AI" });
        expect(visionMain(options({ current: null }), null)).toBeNull();
        expect(visionMain(options({ universeAi: { available: false } }), "universe-ai")).toBeNull();
        expect(visionMain(options({ universeAi: { available: true } }), "universe-ai")).toBeNull();
        expect(visionMain(options({ keys: [{ ...key("key-1"), model: undefined }] }), "key-1")).toBeNull();
    });
});

describe("visionCandidates", () => {
    it("lists Vision models on the maker's keys, the bot's own key first, without the model the bot already runs", () => {
        const main = visionMain(options(), "key-1")!;
        expect(visionCandidates(options(), main).map((c) => [c.keyId, c.model, c.sameKey])).toEqual([
            ["key-1", "deepseek-v4-flash-vision-exp", true],
            ["key-g", "gemini-3-flash", false],
        ]);
        const geminiMain = visionMain(options(), "key-g")!;
        expect(visionCandidates(options(), geminiMain).map((c) => c.keyId)).toEqual(["key-1"]);
    });

    it("none for someone who isn't the maker, and a key that is Down isn't offered", () => {
        const main = visionMain(options(), "key-1")!;
        expect(visionCandidates(options({ viewerIsMaker: false }), main)).toEqual([]);
        expect(visionCandidates(options({ keys: [key("key-1", { status: "down" })] }), main)).toEqual([]);
    });
});

describe("visionState: nothing picked", () => {
    it("a model that sees looks at images itself", () => {
        const state = visionState(options(), "key-g", bot())!;
        expect(state.effective).toEqual({ choice: "this" });
        expect(state.picked).toBe(false);
    });

    it("a text model on a key with a Vision model uses it, so images stay on the key", () => {
        const state = visionState(options(), "key-1", bot())!;
        expect(state.effective).toEqual({
            choice: "another",
            keyId: "key-1",
            keyName: "Key key-1",
            model: "deepseek-v4-flash-vision-exp",
            sameKey: true,
        });
        expect(state.picked).toBe(false);
    });

    it("a text model on a key with none goes to Universe AI", () => {
        expect(visionState(options(), "key-l", bot())!.effective).toEqual({ choice: "universe-ai" });
    });

    it("the same for the maker and for someone else who manages the bot", () => {
        const others = options({
            viewerIsMaker: false,
            keys: [],
            currentKey: {
                id: "key-1",
                name: "Mishari’s DeepSeek",
                ownerName: "Mishari",
                mine: false,
                status: "working",
                ifDown: "universe-ai",
                group: "hosted",
                model: "deepseek-v4-flash",
                supportsVision: false,
                visionModels: ["deepseek-v4-flash-vision-exp"],
            },
        });
        expect(visionState(others, "key-1", bot())!.effective).toMatchObject({
            choice: "another",
            model: "deepseek-v4-flash-vision-exp",
            keyName: "Mishari’s DeepSeek",
        });
    });

    it("a bot on Universe AI whose model can't see stays on Universe AI, as it always did; one that sees looks itself", () => {
        expect(visionState(options(), "universe-ai", bot())!.effective).toEqual({ choice: "universe-ai" });
        expect(
            visionState(options({ universeAi: { available: true, model: "gemini-3-flash" } }), "universe-ai", bot())!
                .effective
        ).toEqual({ choice: "this" });
    });

    it("follows the Runs on card the person has tapped, saved or not", () => {
        const base = options();
        expect(visionState(base, "key-l", bot())!.effective.choice).toBe("universe-ai");
        expect(visionState(base, "key-g", bot())!.effective.choice).toBe("this");
        expect(visionState(base, "universe-ai", bot())!.main.name).toBe("Universe AI");
    });
});

describe("visionState: picked", () => {
    it("This model, even when it can't see", () => {
        const state = visionState(options(), "key-l", bot({ choice: "this" }))!;
        expect(state.effective).toEqual({ choice: "this" });
        expect(state.picked).toBe(true);
        expect(state.main.sees).toBe(false);
    });

    it("Universe AI, even on a model that sees", () => {
        expect(visionState(options(), "key-g", bot({ choice: "universe-ai" }))!.effective).toEqual({
            choice: "universe-ai",
        });
    });

    it("Another model on another key: whose key and which model", () => {
        const state = visionState(
            options(),
            "key-l",
            bot({ choice: "another", keyId: "key-1", model: "deepseek-v4-flash-vision-exp" })
        )!;
        expect(state.effective).toEqual({
            choice: "another",
            keyId: "key-1",
            keyName: "Key key-1",
            model: "deepseek-v4-flash-vision-exp",
            sameKey: false,
        });
        expect(state.problem).toBe(false);
    });

    it("Another model saved earlier that someone else is looking at: the key's name comes from Orbit", () => {
        const pick = { choice: "another", keyId: "key-1", model: "deepseek-v4-flash-vision-exp" } as const;
        const state = visionState(
            options({
                viewerIsMaker: false,
                keys: [],
                currentKey: {
                    id: "key-l",
                    name: "Mishari’s LM Studio",
                    ownerName: "Mishari",
                    mine: false,
                    status: "working",
                    ifDown: "universe-ai",
                    group: "own-computer",
                    model: "qwen3-8b",
                    supportsVision: null,
                    visionModels: [],
                },
                current: "key-l",
                vision: { saved: pick, savedKey: { name: "Mishari’s DeepSeek", problem: null } },
            }),
            "key-l",
            bot(pick)
        )!;
        expect(state.effective).toMatchObject({ choice: "another", keyName: "Mishari’s DeepSeek", sameKey: false });
        expect(state.problem).toBe(false);
    });

    it("a key picked for images that can't be used now is said, and images stay with the bot's own model", () => {
        const pick = { choice: "another", keyId: "key-gone", model: "m" } as const;
        const missing = visionState(options(), "key-l", bot(pick))!;
        expect(missing).toMatchObject({ problem: true, picked: true, effective: { choice: "this" } });
        const down = visionState(
            options({ vision: { saved: pick, savedKey: { name: "My Other", problem: "down" } } }),
            "key-l",
            bot(pick)
        )!;
        expect(down.problem).toBe(true);
    });
});

describe("visionState: nothing to show", () => {
    it("is null for an Orbit that doesn't send Vision facts, and for a bot with nothing to say", () => {
        expect(visionState({ ...options(), vision: undefined }, "key-1", bot())).toBeNull();
        expect(visionState(options({ current: "lmstudio-local" }), "lmstudio-local", bot())).toBeNull();
    });
});

describe("tapping a choice", () => {
    it("This model and Universe AI save the choice and keep the rest of the bot's settings", () => {
        const base: BotData = {
            id: "b",
            behaviorConfig: { assignedSpace: { center: { x: 1, y: 2 }, radius: 3 }, showToolCalls: true },
        };
        const state = visionState(options(), "key-l", base)!;
        expect(withVisionChoice(base, state, "this").behaviorConfig).toEqual({
            assignedSpace: { center: { x: 1, y: 2 }, radius: 3 },
            showToolCalls: true,
            vision: { choice: "this" },
        });
        expect(withVisionChoice(base, state, "universe-ai").behaviorConfig.vision).toEqual({ choice: "universe-ai" });
    });

    it("Another model takes the first model offered, the bot's own key first, unless one is named", () => {
        const base: BotData = { id: "b", behaviorConfig: { assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } } };
        const state = visionState(options(), "key-1", base)!;
        expect(withVisionChoice(base, state, "another").behaviorConfig.vision).toEqual({
            choice: "another",
            keyId: "key-1",
            model: "deepseek-v4-flash-vision-exp",
        });
        expect(withVisionChoice(base, state, "another", state.candidates[1]).behaviorConfig.vision).toEqual({
            choice: "another",
            keyId: "key-g",
            model: "gemini-3-flash",
        });
        const none = visionState(options({ keys: [lmStudio] }), "key-l", base)!;
        expect(withVisionChoice(base, none, "another")).toBe(base);
    });

    it("says what can be tapped", () => {
        const state = visionState(options(), "key-l", bot())!;
        expect(canPickVision(options(), state, "this")).toBe(true);
        expect(canPickVision(options(), state, "universe-ai")).toBe(true);
        expect(canPickVision(options({ universeAi: { available: false } }), state, "universe-ai")).toBe(false);
        expect(canPickVision(options(), state, "another")).toBe(true);
        expect(
            canPickVision(
                options({ viewerIsMaker: false }),
                visionState(options({ viewerIsMaker: false }), "key-l", bot())!,
                "another"
            )
        ).toBe(false);
    });
});

describe("withoutRefused", () => {
    const bot = (behaviorConfig: BotData["behaviorConfig"], over: Partial<BotData> = {}): BotData => ({
        id: "b1",
        behaviorConfig,
        ...over,
    });
    const space = { center: { x: 1, y: 2 }, radius: 3 };

    it("puts the last saved Vision pick back and keeps everything else the person changed", () => {
        const refused = bot({
            assignedSpace: { center: { x: 9, y: 9 }, radius: 3 },
            vision: { choice: "another", keyId: "key-1", model: "m" },
        });
        const saved = JSON.stringify({ assignedSpace: space, vision: { choice: "universe-ai" } });
        expect(withoutRefused(refused, "config", saved).behaviorConfig).toEqual({
            assignedSpace: { center: { x: 9, y: 9 }, radius: 3 },
            vision: { choice: "universe-ai" },
        });
    });

    it("takes the pick out when nothing was saved, so the page shows the default again", () => {
        const refused = bot({ assignedSpace: space, vision: { choice: "another", keyId: "key-1", model: "m" } });
        expect(withoutRefused(refused, "config", JSON.stringify({ assignedSpace: space })).behaviorConfig).toEqual({
            assignedSpace: space,
        });
        expect(withoutRefused(refused, "config", null).behaviorConfig).toEqual({ assignedSpace: space });
    });

    it("puts the last saved Runs on back for a refused AI save, and leaves the behavior alone", () => {
        const refused = bot({ assignedSpace: space }, { aiProviderRef: "key-9", chatInstructions: "Be kind" });
        const result = withoutRefused(refused, "ai", JSON.stringify({ aiProviderRef: "universe-ai" }));
        expect(result.aiProviderRef).toBe("universe-ai");
        expect(result.chatInstructions).toBe("Be kind");
        expect(result.behaviorConfig).toEqual({ assignedSpace: space });
    });

    it("copes with a saved value that can't be read", () => {
        const refused = bot({ assignedSpace: space, vision: { choice: "this" } });
        expect(withoutRefused(refused, "config", "{nope").behaviorConfig).toEqual({ assignedSpace: space });
    });
});
