import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const mocks = vi.hoisted(() => ({
    api: {
        isInitialized: vi.fn(() => false),
        getBotMcpServers: vi.fn(),
    },
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks.api }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import type { BotAiOptions, BotData } from "../types";
import ToolsGroup from "./page/ToolsGroup.svelte";
import { ceilingFor, choicesUnder, limitChips, modelCapFor, tokensLabel } from "./page/replyLimits";

const options = (over: Partial<BotAiOptions> = {}): BotAiOptions => ({
    current: "universe-ai",
    universeAi: { available: true, limits: { reply: 32000, steps: 30 } },
    maker: { id: "me", name: "Mishari" },
    viewerIsMaker: true,
    keys: [],
    currentKey: null,
    providers: null,
    ...over,
});

const myKey: BotAiOptions["keys"][number] = {
    id: "key-1",
    name: "My OpenRouter",
    kind: "openrouter",
    kindLabel: "OpenRouter",
    group: "hosted",
    universeName: "Sandbox Universe",
    status: "working",
    ifDown: "universe-ai",
    limits: { reply: 8000, steps: 12 },
};

const keysLimit = {
    keysLimit: () => "Key's limit",
    keysLimitIs: ({ limit }: { limit: string }) => `Key's limit · ${limit}`,
};

describe("the bot page's reply limits (Orbit #666)", () => {
    it("follows the key the bot is on, someone else's key it is on now, or Universe AI", () => {
        const loaded = options({
            keys: [myKey],
            currentKey: {
                id: "key-9",
                name: "Khalid's",
                ownerName: "Khalid",
                mine: false,
                status: "working",
                ifDown: "universe-ai",
                limits: { reply: 4000, steps: 5 },
            },
        });
        expect(ceilingFor(loaded, "key-1")).toEqual({ reply: 8000, steps: 12 });
        expect(ceilingFor(loaded, "key-9")).toEqual({ reply: 4000, steps: 5 });
        expect(ceilingFor(loaded, "universe-ai")).toEqual({ reply: 32000, steps: 30 });
        expect(ceilingFor(loaded, "openai-main")).toEqual({ reply: 32000, steps: 30 });
        expect(ceilingFor(null, "key-1")).toBeNull();
        expect(ceilingFor(options({ universeAi: { available: true } }), "universe-ai")).toBeNull();
    });

    it("offers only values under the key's limit, with Key's limit first", () => {
        expect(limitChips(32000, [16000, 8000, 4000], null, tokensLabel, keysLimit)).toEqual({
            value: 0,
            options: [
                { value: 0, label: "Key's limit · 32k" },
                { value: 16000, label: "16k" },
                { value: 8000, label: "8k" },
                { value: 4000, label: "4k" },
            ],
        });
        expect(limitChips(8000, [16000, 8000, 4000], null, tokensLabel, keysLimit).options.map((o) => o.label)).toEqual(
            ["Key's limit · 8k", "4k"]
        );
        expect(limitChips(null, [20, 10], null, String, keysLimit).options.map((o) => o.label)).toEqual([
            "Key's limit",
            "20",
            "10",
        ]);
    });

    it("shows a saved value that is none of the chips, and Key's limit for one that is not lower", () => {
        expect(limitChips(32000, [16000, 8000, 4000], 12500, tokensLabel, keysLimit)).toMatchObject({
            value: 12500,
            options: [
                { value: 0 },
                { value: 16000 },
                { value: 12500, label: "12.5k" },
                { value: 8000 },
                { value: 4000 },
            ],
        });
        expect(limitChips(8000, [16000, 8000, 4000], 16000, tokensLabel, keysLimit).value).toBe(0);
    });
});

describe("the bot page's Tools group: longest reply and steps (Orbit #666)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        destroy();
        destroy = () => undefined;
        document.body.innerHTML = "";
    });

    const group = (label: string) => target.querySelector<HTMLElement>(`[role=radiogroup][aria-label="${label}"]`);
    const chips = (label: string) => [...(group(label)?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const picked = (label: string) =>
        chips(label)
            .find((chip) => chip.getAttribute("aria-checked") === "true")
            ?.textContent?.trim();

    async function mount(bot: BotData, aiOptions: BotAiOptions | null) {
        const onChange = vi.fn();
        const component = new ToolsGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onChange, aiOptions },
        });
        destroy = () => component.$destroy();
        await tick();
        return { component, onChange };
    }

    it("shows the key's limits as picked, and saves a lower pick on the bot", async () => {
        const bot = { id: "b1", name: "Micho", aiProviderRef: "universe-ai" } as BotData;
        const { onChange } = await mount(bot, options());
        expect(chips("Longest reply").map((chip) => chip.textContent?.trim())).toEqual([
            "Key's limit · 32k",
            "16k",
            "8k",
            "4k",
        ]);
        expect(chips("Steps in one reply").map((chip) => chip.textContent?.trim())).toEqual([
            "Key's limit · 30",
            "20",
            "10",
        ]);
        expect(picked("Longest reply")).toBe("Key's limit · 32k");

        chips("Longest reply")[2].click();
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ maxReplyTokens: 8000 }));
        chips("Steps in one reply")[2].click();
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ maxSteps: 10 }));
    });

    it("goes back to the key's limit with null, and follows the key the bot is switched to", async () => {
        const bot = { id: "b1", name: "Micho", aiProviderRef: "universe-ai", maxReplyTokens: 4000 } as BotData;
        const { component, onChange } = await mount(bot, options({ keys: [myKey] }));
        expect(picked("Longest reply")).toBe("4k");
        chips("Longest reply")[0].click();
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ maxReplyTokens: null }));

        component.$set({ bot: { ...bot, aiProviderRef: "key-1" } });
        await tick();
        expect(chips("Longest reply").map((chip) => chip.textContent?.trim())).toEqual(["Key's limit · 8k", "4k"]);
        expect(chips("Steps in one reply").map((chip) => chip.textContent?.trim())).toEqual(["Key's limit · 12", "10"]);
    });

    it("follows the key Orbit says the bot is on when the bot has none saved (CodeRabbit on #1524)", async () => {
        const bot = { id: "b1", name: "Micho" } as BotData;
        await mount(bot, options({ current: "key-1", keys: [myKey] }));
        expect(chips("Longest reply").map((chip) => chip.textContent?.trim())).toEqual(["Key's limit · 8k", "4k"]);
        expect(chips("Steps in one reply").map((chip) => chip.textContent?.trim())).toEqual(["Key's limit · 12", "10"]);
    });
});

describe("a model that writes less than the key allows (Orbit #673)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        destroy();
        destroy = () => undefined;
        document.body.innerHTML = "";
    });

    const openRouter: BotAiOptions["keys"][number] = {
        ...myKey,
        limits: { reply: 32000, steps: 30 },
        model: "deepseek/deepseek-v4-flash",
        models: [
            { id: "deepseek/deepseek-v4-flash", tools: true },
            { id: "openai/gpt-4o-mini", tools: true, output: 16384 },
            { id: "x/huge", output: 128000 },
        ],
    };
    const labels = () =>
        [
            ...(target.querySelector('[role=radiogroup][aria-label="Longest reply"]')?.querySelectorAll("button") ??
                []),
        ].map((chip) => chip.textContent?.trim());
    const note = () => target.querySelector('[data-testid="bot-model-stops"]')?.textContent?.trim();

    async function mount(bot: BotData, aiOptions: BotAiOptions) {
        const component = new ToolsGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onChange: vi.fn(), aiOptions },
        });
        destroy = () => component.$destroy();
        await tick();
        return component;
    }

    it("makes the model's limit the first chip, drops the chips that are not clearly lower, and says why", async () => {
        const bot = { id: "b1", name: "Scout", aiProviderRef: "key-1", aiModel: "openai/gpt-4o-mini" } as BotData;
        const component = await mount(bot, options({ keys: [openRouter] }));
        expect(labels()).toEqual(["Model's limit · 16.4k", "8k", "4k"]);
        expect(note()).toBe("gpt-4o-mini writes up to 16.4k tokens, so this bot stops there. The key allows 32k.");

        // Another model on the key: one with no known limit, then one that writes more than the key allows
        component.$set({ bot: { ...bot, aiModel: "deepseek/deepseek-v4-flash" } });
        await tick();
        expect(labels()).toEqual(["Key's limit · 32k", "16k", "8k", "4k"]);
        expect(note()).toBeUndefined();
        component.$set({ bot: { ...bot, aiModel: "x/huge" } });
        await tick();
        expect(labels()[0]).toBe("Key's limit · 32k");
        expect(note()).toBeUndefined();
    });

    it("follows the model of someone else's key the bot is on, and says nothing on Universe AI", async () => {
        const theirs = {
            id: "key-9",
            name: "Khalid's",
            ownerName: "Khalid",
            mine: false,
            status: "working" as const,
            ifDown: "universe-ai" as const,
            limits: { reply: 32000, steps: 30 },
            model: "openai/gpt-4o-mini",
            output: 16384,
        };
        const component = await mount(
            { id: "b1", name: "Scout", aiProviderRef: "key-9" } as BotData,
            options({ current: "key-9", currentKey: theirs })
        );
        expect(labels()[0]).toBe("Model's limit · 16.4k");
        component.$set({ bot: { id: "b1", name: "Scout", aiProviderRef: "universe-ai" } as BotData });
        await tick();
        expect(labels()[0]).toBe("Key's limit · 32k");
        expect(note()).toBeUndefined();
    });

    it("finds the model's limit from the key's models, its check model, or not at all", () => {
        expect(
            modelCapFor(options({ keys: [openRouter] }), { aiProviderRef: "key-1", aiModel: "openai/gpt-4o-mini" })
        ).toEqual({
            model: "openai/gpt-4o-mini",
            tokens: 16384,
        });
        const unlisted = { ...myKey, model: "gpt-4o-mini", output: 16384, models: null };
        expect(modelCapFor(options({ keys: [unlisted] }), { aiProviderRef: "key-1", aiModel: null })).toEqual({
            model: "gpt-4o-mini",
            tokens: 16384,
        });
        expect(modelCapFor(options(), { aiProviderRef: "universe-ai" })).toBeNull();
        expect(modelCapFor(null, { aiProviderRef: "key-1" })).toBeNull();
        expect(choicesUnder(16384)).toEqual([8000, 4000]);
        expect(choicesUnder(20000)).toEqual([16000, 8000, 4000]);
    });
});
