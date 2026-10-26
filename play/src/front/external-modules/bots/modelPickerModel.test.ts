import { describe, expect, it } from "vitest";
import type { BotAiOptions, KeyModelOption } from "./types";
import {
    aiModelPlan,
    botModelOf,
    factVaries,
    filterModels,
    groupModels,
    keyChoice,
    listNote,
    makerFacts,
    makerOf,
    modelRow,
    preselectedModel,
    rowFacts,
    sharedFacts,
    shortName,
    visibleMakers,
} from "./modelPickerModel";

const ids = (...list: string[]): KeyModelOption[] => list.map((id) => ({ id }));

const key = (id: string, over: Partial<BotAiOptions["keys"][number]> = {}): BotAiOptions["keys"][number] => ({
    id,
    name: `Key ${id}`,
    kind: "openrouter",
    kindLabel: "OpenRouter",
    group: "hosted",
    universeName: "Sandbox Universe",
    status: "working",
    ifDown: "universe-ai",
    model: null,
    models: ids("openai/gpt-5", "deepseek/deepseek-v4-flash", "deepseek/deepseek-v4"),
    limited: false,
    ...over,
});

const options = (over: Partial<BotAiOptions> = {}): BotAiOptions => ({
    current: "universe-ai",
    currentModel: null,
    universeAi: { available: true },
    maker: { id: "me", name: "Mishari" },
    viewerIsMaker: true,
    keys: [],
    currentKey: null,
    providers: null,
    ...over,
});

describe("modelRow: which models show and whether there is a Change", () => {
    it("has no Model row on Universe AI", () => {
        expect(modelRow(options({ keys: [key("key-1")] }), "universe-ai", null)).toBeNull();
    });

    it("has no Model row on a key that isn't one of the person's lent keys", () => {
        expect(modelRow(options({ current: "key-9", keys: [key("key-1")] }), "key-9", null)).toBeNull();
    });

    it("a lend that allows one model shows it, with no Change", () => {
        const row = modelRow(
            options({ current: "key-1", keys: [key("key-1", { kind: "anthropic", models: ids("claude-haiku-5-5") })] }),
            "key-1",
            null
        );
        expect(row).toEqual({ kind: "single", model: { id: "claude-haiku-5-5" } });
    });

    it("a lend that allows several shows only those, with Change", () => {
        const row = modelRow(
            options({ current: "key-1", keys: [key("key-1")] }),
            "key-1",
            "deepseek/deepseek-v4-flash"
        );
        expect(row).toEqual({
            kind: "choose",
            model: { id: "deepseek/deepseek-v4-flash" },
            models: ids("openai/gpt-5", "deepseek/deepseek-v4-flash", "deepseek/deepseek-v4"),
        });
    });

    it("a bot with no pick shows the key's check model while the lend allows it", () => {
        const row = modelRow(
            options({ current: "key-1", keys: [key("key-1", { model: "openai/gpt-5" })] }),
            "key-1",
            null
        );
        expect(row).toMatchObject({ kind: "choose", model: { id: "openai/gpt-5" } });
    });

    it("a bot whose check model the lend doesn't allow shows no model yet", () => {
        const row = modelRow(
            options({ current: "key-1", keys: [key("key-1", { model: "mistralai/large" })] }),
            "key-1",
            null
        );
        expect(row).toMatchObject({ kind: "choose", model: null });
    });

    it("a model list Orbit could not load shows the model it runs on, with no Change", () => {
        const row = modelRow(
            options({ current: "key-1", keys: [key("key-1", { models: null, model: "gpt-5" })] }),
            "key-1",
            null
        );
        expect(row).toEqual({ kind: "unlisted", model: "gpt-5" });
    });
});

describe("preselect: the only allowed model or the provider's suggested one", () => {
    it("takes the only allowed model", () => {
        expect(preselectedModel(key("key-1", { models: ids("claude-haiku-5-5") }))).toBe("claude-haiku-5-5");
        expect(keyChoice(key("key-1", { models: ids("claude-haiku-5-5") }))).toEqual({
            model: "claude-haiku-5-5",
            needsPick: false,
        });
    });

    it("takes the provider's suggested model when the lend allows it", () => {
        const deepseek = key("key-1", {
            kind: "deepseek",
            models: ids("deepseek-v4", "deepseek-v4-flash", "deepseek-r1"),
        });
        expect(keyChoice(deepseek)).toEqual({ model: "deepseek-v4-flash", needsPick: false });
    });

    it("waits for a pick when the suggested model isn't allowed", () => {
        const deepseek = key("key-1", { kind: "deepseek", models: ids("deepseek-v4", "deepseek-r1") });
        expect(keyChoice(deepseek)).toEqual({ model: null, needsPick: true });
    });

    it("waits for a pick on a provider with no suggestion (OpenRouter), whatever its check model is", () => {
        expect(keyChoice(key("key-1", { model: "openai/gpt-5" }))).toEqual({ model: null, needsPick: true });
    });

    it("puts the bot on a key whose models could not be listed as it always did", () => {
        expect(keyChoice(key("key-1", { models: null }))).toEqual({ model: null, needsPick: false });
    });
});

describe("botModelOf", () => {
    it("uses what the page picked, even none", () => {
        const o = options({ current: "key-1", currentModel: "openai/gpt-5", keys: [key("key-1")] });
        expect(botModelOf(o, { aiProviderRef: "key-1", aiModel: "deepseek/deepseek-v4" })).toBe("deepseek/deepseek-v4");
        expect(botModelOf(o, { aiProviderRef: "key-1", aiModel: null })).toBeNull();
    });

    it("otherwise uses what Orbit said when the bot is still on that key", () => {
        const o = options({ current: "key-1", currentModel: "openai/gpt-5", keys: [key("key-1")] });
        expect(botModelOf(o, { aiProviderRef: "key-1" })).toBe("openai/gpt-5");
        expect(botModelOf(o, { aiProviderRef: "key-2" })).toBeNull();
    });
});

describe("aiModelPlan: aiModel is sent in the save, and not when unchanged", () => {
    it("sends a model picked on the key the bot is already on", () => {
        expect(aiModelPlan({ ref: "key-1", model: "b" }, { ref: "key-1", model: "a" })).toEqual({
            send: "b",
            base: "a",
        });
    });

    it("doesn't send a model that is already saved", () => {
        expect(aiModelPlan({ ref: "key-1", model: "a" }, { ref: "key-1", model: "a" })).toEqual({
            send: null,
            base: "a",
        });
    });

    it("sends the model with a new key, which Orbit puts back on the check model first", () => {
        expect(aiModelPlan({ ref: "key-2", model: "a" }, { ref: "key-1", model: "a" })).toEqual({
            send: "a",
            base: null,
        });
    });

    it("sends nothing for a new key with no model, or for Universe AI", () => {
        expect(aiModelPlan({ ref: "key-2", model: null }, { ref: "key-1", model: "a" })).toEqual({
            send: null,
            base: null,
        });
        expect(aiModelPlan({ ref: "universe-ai", model: null }, { ref: "key-1", model: "a" })).toEqual({
            send: null,
            base: null,
        });
    });

    it("sends nothing when only something else about the bot changed", () => {
        expect(aiModelPlan({ ref: "key-1", model: undefined }, { ref: "key-1", model: "a" })).toEqual({
            send: null,
            base: "a",
        });
    });
});

describe("the list", () => {
    const openRouter = ids(
        "openai/gpt-5",
        "openai/gpt-5-mini",
        "deepseek/deepseek-v4-flash",
        "mistralai/large",
        "plain-model"
    );

    it("splits a maker from its model", () => {
        expect(makerOf("deepseek/deepseek-v4-flash")).toBe("deepseek");
        expect(shortName("deepseek/deepseek-v4-flash")).toBe("deepseek-v4-flash");
        expect(makerOf("claude-haiku-5-5")).toBeNull();
        expect(shortName("claude-haiku-5-5")).toBe("claude-haiku-5-5");
    });

    it("groups by maker, the biggest first, with models that have no maker flat", () => {
        const { flat, makers } = groupModels(openRouter);
        expect(flat).toEqual(ids("plain-model"));
        expect(makers.map((maker) => [maker.name, maker.models.length])).toEqual([
            ["OpenAI", 2],
            ["DeepSeek", 1],
            ["Mistral", 1],
        ]);
    });

    it("keeps a flat list flat (Claude)", () => {
        const { flat, makers } = groupModels(ids("claude-haiku-5-5", "claude-sonnet-5-5"));
        expect(flat).toHaveLength(2);
        expect(makers).toEqual([]);
    });

    it("searches ids and maker names, and filters by Tools and Vision", () => {
        const list: KeyModelOption[] = [
            { id: "google/gemini-flash", tools: true, vision: true },
            { id: "google/gemma", tools: false },
            { id: "deepseek/deepseek-v4-flash", tools: true },
        ];
        expect(filterModels(list, { query: "flash", tools: false, vision: false }).map((m) => m.id)).toEqual([
            "google/gemini-flash",
            "deepseek/deepseek-v4-flash",
        ]);
        expect(filterModels(list, { query: "google", tools: false, vision: false })).toHaveLength(2);
        expect(filterModels(list, { query: "", tools: true, vision: false })).toHaveLength(2);
        expect(filterModels(list, { query: "flash", tools: true, vision: true }).map((m) => m.id)).toEqual([
            "google/gemini-flash",
        ]);
    });

    it("shows the 8 biggest makers, then all, and never hides the one holding the pick", () => {
        const many = Array.from({ length: 12 }, (_, index) => ({
            id: `m${index}`,
            name: `M${index}`,
            models: ids(`m${index}/a`),
        }));
        const folded = visibleMakers(many, { showAll: false, filtering: false, keep: new Set() });
        expect(folded.map((maker) => maker.id)).toEqual(many.slice(0, 8).map((maker) => maker.id));
        expect(visibleMakers(many, { showAll: false, filtering: false, keep: new Set(["m10"]) })).toHaveLength(9);
        expect(visibleMakers(many, { showAll: true, filtering: false, keep: new Set() })).toHaveLength(12);
        expect(visibleMakers(many, { showAll: false, filtering: true, keep: new Set() })).toHaveLength(12);
    });
});

describe("what the list says once", () => {
    const v = (id: string, over: Partial<KeyModelOption> = {}): KeyModelOption => ({ id, ...over });
    const allVision = [v("a", { vision: true }), v("b", { vision: true }), v("c", { vision: true })];

    it("says what every model has: all have Vision", () => {
        expect(sharedFacts(allVision)).toEqual(["vision"]);
        expect(listNote(allVision, allVision, false)).toEqual({ kind: "all", count: 3, facts: ["vision"] });
    });

    it("says both when every model has Tools and Vision", () => {
        const both = [v("a", { tools: true, vision: true }), v("b", { tools: true, vision: true })];
        expect(listNote(both, both, false)).toEqual({ kind: "all", count: 2, facts: ["tools", "vision"] });
    });

    it("says nothing when only some models have it", () => {
        const some = [v("a", { vision: true }), v("b"), v("c", { vision: false })];
        expect(sharedFacts(some)).toEqual([]);
        expect(listNote(some, some, false)).toBeNull();
    });

    it("says nothing when none have it, or the list has one model", () => {
        expect(listNote([v("a"), v("b")], [v("a"), v("b")], false)).toBeNull();
        expect(sharedFacts([v("a", { vision: true })])).toEqual([]);
        expect(listNote([v("a", { vision: true })], [v("a", { vision: true })], false)).toBeNull();
    });

    it("counts what is left instead while searching or filtering", () => {
        const list = ids("google/a", "google/b", "deepseek/c", "plain");
        expect(listNote(list, list.slice(0, 3), true)).toEqual({ kind: "found", models: 3, makers: 2 });
        expect(listNote(ids("x", "y"), ids("x"), true)).toEqual({ kind: "found", models: 1, makers: null });
        expect(listNote(list, [], true)).toBeNull();
    });

    it("offers a filter only when it would sort the list", () => {
        expect(factVaries(allVision, "vision")).toBe(false);
        expect(factVaries([v("a", { vision: true }), v("b")], "vision")).toBe(true);
        expect(factVaries([v("a"), v("b")], "tools")).toBe(false);
    });

    it("a maker row says what only its models share, not what the list said already", () => {
        const google = [v("google/a", { tools: true, vision: true }), v("google/b", { tools: true, vision: true })];
        expect(makerFacts(google, [])).toEqual(["tools", "vision"]);
        expect(makerFacts(google, ["vision"])).toEqual(["tools"]);
        expect(makerFacts([v("deepseek/a", { tools: true, vision: true })], [])).toEqual([]);
    });

    it("rows show only what is different", () => {
        const group = [
            v("d/flash", { tools: true, vision: true }),
            v("d/v4", { tools: true }),
            v("d/v3", { tools: true }),
            v("d/r1", { tools: false }),
        ];
        // Vision on the one model that has it, nothing for Tools (most have it), No tools on the one that doesn't
        expect(rowFacts(group[0], group, [])).toEqual({ facts: ["vision"], noTools: false });
        expect(rowFacts(group[1], group, [])).toEqual({ facts: [], noTools: false });
        expect(rowFacts(group[3], group, [])).toEqual({ facts: [], noTools: true });
        // What was said once above is not repeated on rows
        expect(rowFacts(group[0], group, ["vision"])).toEqual({ facts: [], noTools: false });
    });

    it("a model alone in its group shows what it has", () => {
        const alone = [v("deepseek/deepseek-flash", { tools: true, vision: true })];
        expect(rowFacts(alone[0], alone, [])).toEqual({ facts: ["tools", "vision"], noTools: false });
    });
});
