import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const mocks = vi.hoisted(() => ({
    api: {
        isInitialized: vi.fn(() => true),
        getAvailableAIProviders: vi.fn(),
        getBotAiOptions: vi.fn(),
        getMyAiKeys: vi.fn(),
    },
    canOpenOrbit: vi.fn(() => true),
    openOrbitPage: vi.fn(),
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks.api }));
vi.mock("../../admin-api/index", () => ({ canOpenOrbit: mocks.canOpenOrbit, openOrbitPage: mocks.openOrbitPage }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { modalVisibilityStore } from "../../../Stores/ModalStore";
import type { BotAiOptions, BotData } from "../types";
import MindGroup from "./page/MindGroup.svelte";

const lentKey: BotAiOptions["keys"][number] = {
    id: "key-1",
    name: "Opus 5.5",
    kind: "openrouter",
    kindLabel: "OpenRouter",
    group: "hosted",
    universeName: "Sandbox Universe",
    status: "working",
    ifDown: "universe-ai",
};

const options = (over: Partial<BotAiOptions> = {}): BotAiOptions => ({
    current: "universe-ai",
    universeAi: { available: true },
    maker: { id: "me", name: "Mishari" },
    viewerIsMaker: true,
    keys: [],
    currentKey: null,
    providers: null,
    ...over,
});

const bot = { id: "b1", name: "Micho", aiProviderRef: "universe-ai" } as BotData;

async function settle(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
    });
    await tick();
}

describe("the bot page's Mind group (#1375)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.api.isInitialized.mockReturnValue(true);
        mocks.canOpenOrbit.mockReturnValue(true);
        mocks.api.getAvailableAIProviders.mockResolvedValue([]);
        mocks.api.getMyAiKeys.mockResolvedValue(null);
        modalVisibilityStore.set(false);
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        destroy();
        destroy = () => undefined;
        document.body.innerHTML = "";
    });

    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const byTestId = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid=${id}]`)];

    async function mount() {
        const component = new MindGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onChange: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
    }

    it("names the maker's key that isn't lent here and says how to lend it", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options());
        mocks.api.getMyAiKeys.mockResolvedValue([{ id: "key-1", name: "Opus 5.5" }]);
        await mount();
        expect(byTestId("bot-runs-on-unlent")).toHaveLength(1);
        expect(text()).toContain("Your key Opus 5.5 isn’t lent to this universe yet.");
        expect(text()).toContain("In AI keys, tap Lend to a universe on it.");
        expect(text()).not.toContain("Only keys you lent to this universe show here.");
    });

    it("lists several unlent keys together", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options());
        mocks.api.getMyAiKeys.mockResolvedValue([
            { id: "key-1", name: "Opus 5.5" },
            { id: "key-2", name: "My DeepSeek" },
        ]);
        await mount();
        expect(text()).toContain("Your keys Opus 5.5 and My DeepSeek aren’t lent to this universe yet.");
        expect(text()).toContain("on the one you want");
    });

    it("keeps the usual line when every key is lent here", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options({ keys: [lentKey] }));
        mocks.api.getMyAiKeys.mockResolvedValue([{ id: "key-1", name: "Opus 5.5" }]);
        await mount();
        expect(byTestId("bot-runs-on-unlent")).toHaveLength(0);
        expect(text()).toContain("Only keys you lent to this universe show here.");
    });

    it("does not wait for the viewer's keys to show the rest of the page", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options({ keys: [lentKey] }));
        mocks.api.getMyAiKeys.mockReturnValue(
            new Promise<null>(() => {
                // never answers
            })
        );
        await mount();
        expect(text()).toContain("Only keys you lent to this universe show here.");
        expect(byTestId("bot-runs-on-unlent")).toHaveLength(0);
    });

    it("offers no provider pin to anyone, even when an older Orbit still sends the provider list (#1446)", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(
            options({
                keys: [lentKey],
                providers: [
                    { id: "deepseek-flash", name: "DeepSeek V4 Flash", type: "openai", model: null, enabled: true },
                ],
            })
        );
        await mount();
        expect(byTestId("bot-mind-provider")).toHaveLength(0);
        expect(text()).not.toContain("Pin to a provider");
        expect(text()).not.toContain("DeepSeek V4 Flash");
        // Universe AI is still the first choice, then the key
        const cards = byTestId("bot-runs-on-universe-ai").length + byTestId("bot-runs-on-mine").length;
        expect(cards).toBe(2);
    });

    it("never shows it on someone else's bot", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options({ viewerIsMaker: false }));
        mocks.api.getMyAiKeys.mockResolvedValue([{ id: "key-1", name: "Opus 5.5" }]);
        await mount();
        expect(byTestId("bot-runs-on-unlent")).toHaveLength(0);
    });

    it("shows a key lent in AI keys as soon as Orbit closes, without reopening the bot", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options());
        mocks.api.getMyAiKeys.mockResolvedValue([{ id: "key-1", name: "Opus 5.5" }]);
        await mount();
        expect(byTestId("bot-runs-on-mine")).toHaveLength(0);

        byTestId("bot-runs-on-ai-keys")[0].click();
        expect(mocks.openOrbitPage).toHaveBeenCalledWith("/admin/you/ai-keys");
        modalVisibilityStore.set(true);
        // Lent in Orbit, then Orbit closes
        mocks.api.getBotAiOptions.mockResolvedValue(options({ keys: [lentKey] }));
        modalVisibilityStore.set(false);
        await settle();

        expect(mocks.api.getBotAiOptions).toHaveBeenCalledTimes(2);
        expect(byTestId("bot-runs-on-mine")).toHaveLength(1);
        expect(byTestId("bot-runs-on-unlent")).toHaveLength(0);
    });

    it("loads again when the page gets focus back after AI keys was opened, and only then", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options());
        mocks.api.getMyAiKeys.mockResolvedValue([{ id: "key-1", name: "Opus 5.5" }]);
        await mount();

        window.dispatchEvent(new Event("focus"));
        await settle();
        expect(mocks.api.getBotAiOptions).toHaveBeenCalledTimes(1);

        byTestId("bot-runs-on-ai-keys")[0].click();
        mocks.api.getBotAiOptions.mockResolvedValue(options({ keys: [lentKey] }));
        window.dispatchEvent(new Event("focus"));
        await settle();
        expect(mocks.api.getBotAiOptions).toHaveBeenCalledTimes(2);
        expect(byTestId("bot-runs-on-mine")).toHaveLength(1);
    });

    it("keeps what it shows when the background load can't reach Orbit", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options({ keys: [lentKey] }));
        mocks.api.getMyAiKeys.mockResolvedValue([{ id: "key-1", name: "Opus 5.5" }]);
        await mount();
        byTestId("bot-runs-on-ai-keys")[0].click();

        mocks.api.getBotAiOptions.mockResolvedValue(null);
        mocks.api.getMyAiKeys.mockResolvedValue(null);
        window.dispatchEvent(new Event("focus"));
        await settle();
        expect(byTestId("bot-runs-on-mine")).toHaveLength(1);
    });

    it("keeps a pinned provider's name when the background load gets no provider list", async () => {
        mocks.api.getAvailableAIProviders.mockResolvedValue([
            { providerId: "openai-main", name: "OpenAI", model: "gpt-5", enabled: true },
        ]);
        mocks.api.getBotAiOptions.mockResolvedValue(options({ current: "openai-main" }));
        mocks.api.getMyAiKeys.mockResolvedValue([]);
        const component = new MindGroup({
            target,
            props: { bot: { ...bot, aiProviderRef: "openai-main" }, open: false, onToggle: vi.fn(), onChange: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        component.$set({ open: true });
        await settle();
        expect(text()).toContain("OpenAI");

        byTestId("bot-runs-on-ai-keys")[0].click();
        mocks.api.getAvailableAIProviders.mockResolvedValue([]);
        window.dispatchEvent(new Event("focus"));
        await settle();
        expect(mocks.api.getBotAiOptions).toHaveBeenCalledTimes(2);
        expect(text()).toContain("OpenAI · gpt-5");
    });
});
