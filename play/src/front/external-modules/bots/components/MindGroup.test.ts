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

    it("shows it on someone else's bot too, with AI keys (#1579)", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options({ viewerIsMaker: false }));
        mocks.api.getMyAiKeys.mockResolvedValue([{ id: "key-1", name: "Opus 5.5" }]);
        await mount();
        expect(byTestId("bot-runs-on-unlent")).toHaveLength(1);
        expect(byTestId("bot-runs-on-ai-keys")).toHaveLength(1);
    });

    it("says how to run the bot on your key when you have none", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options({ viewerIsMaker: false }));
        mocks.api.getMyAiKeys.mockResolvedValue([]);
        await mount();
        expect(text()).toContain("Lend one of your AI keys to this universe to run Micho on it.");
        expect(text()).not.toContain("You manage bots here");
    });

    describe("moving a bot off someone else's key (#1579)", () => {
        const saraKey = {
            id: "key-sara",
            name: "Sara’s DeepSeek",
            ownerName: "Sara",
            mine: false,
            status: "working" as const,
            ifDown: "universe-ai" as const,
        };
        const onSaras = (over: Partial<BotAiOptions> = {}) =>
            options({
                current: "key-sara",
                viewerIsMaker: false,
                maker: { id: "sara", name: "Sara" },
                keys: [{ ...lentKey, name: "My Claude" }],
                currentKey: saraKey,
                ...over,
            });

        async function mountOnSaras(over: Partial<BotAiOptions> = {}) {
            mocks.api.getBotAiOptions.mockResolvedValue(onSaras(over));
            mocks.api.getMyAiKeys.mockResolvedValue([{ id: "key-1", name: "My Claude" }]);
            const onChange = vi.fn();
            const component = new MindGroup({
                target,
                props: { bot: { ...bot, aiProviderRef: "key-sara" }, open: true, onToggle: vi.fn(), onChange },
            });
            destroy = () => component.$destroy();
            await settle();
            return onChange;
        }

        const card = (kind: string) => byTestId(`bot-runs-on-${kind}`)[0];

        it("names whose key it is and who pays, never that only they can put it there", async () => {
            await mountOnSaras();
            expect(card("theirs").textContent).toContain("Sara’s DeepSeek");
            expect(text()).toContain("Sara’s key. Sara pays.");
            expect(text()).not.toContain("Only Sara can put");
        });

        it("asks right under your key once tapped, and shows it picked, before moving", async () => {
            const onChange = await mountOnSaras();
            card("mine").click();
            await tick();
            expect(onChange).not.toHaveBeenCalled();
            expect(card("mine").getAttribute("aria-checked")).toBe("true");
            expect(card("theirs").getAttribute("aria-checked")).toBe("false");
            const ask = byTestId("bot-runs-on-move-ask")[0];
            expect(card("mine").nextElementSibling).toBe(ask);
            expect(ask.textContent?.replace(/\s+/g, " ")).toContain(
                "Move to My Claude? You pay for its replies from now on. Sara is told. Only Sara can move it back to their key."
            );
            byTestId("bot-runs-on-move-confirm")[0].click();
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ aiProviderRef: "key-1" }));
        });

        it("asks without the pay line for Universe AI", async () => {
            const onChange = await mountOnSaras();
            card("universe-ai").click();
            await tick();
            const ask = byTestId("bot-runs-on-move-ask")[0].textContent ?? "";
            expect(ask).toContain("Move to Universe AI?");
            expect(ask).not.toContain("You pay");
            byTestId("bot-runs-on-move-confirm")[0].click();
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ aiProviderRef: "universe-ai" }));
        });

        it("keeps it where it is on Keep, or on tapping their key again", async () => {
            const onChange = await mountOnSaras();
            card("mine").click();
            await tick();
            [...target.querySelectorAll<HTMLButtonElement>(".bp-ask button")]
                .find((button) => button.textContent?.trim() === "Keep")
                ?.click();
            await tick();
            expect(byTestId("bot-runs-on-move-ask")).toHaveLength(0);
            expect(card("theirs").getAttribute("aria-checked")).toBe("true");
            card("mine").click();
            await tick();
            card("theirs").click();
            await tick();
            expect(byTestId("bot-runs-on-move-ask")).toHaveLength(0);
            expect(onChange).not.toHaveBeenCalled();
        });

        it("says its owner is told when Orbit can't name them", async () => {
            await mountOnSaras({ currentKey: { ...saraKey, ownerName: null } });
            expect(text()).toContain("Someone else’s key. Its owner pays.");
            card("mine").click();
            await tick();
            expect(byTestId("bot-runs-on-move-ask")[0].textContent).toContain(
                "Its owner is told. Only its owner can move it back to their key."
            );
        });

        it("asks nothing when the bot is on your own key or Universe AI", async () => {
            mocks.api.getBotAiOptions.mockResolvedValue(options({ keys: [lentKey] }));
            const onChange = vi.fn();
            const component = new MindGroup({ target, props: { bot, open: true, onToggle: vi.fn(), onChange } });
            destroy = () => component.$destroy();
            await settle();
            card("mine").click();
            await tick();
            expect(byTestId("bot-runs-on-move-ask")).toHaveLength(0);
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ aiProviderRef: "key-1" }));
        });
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

    it("names Universe AI on the closed row while Orbit hasn't answered, never its stored ref", async () => {
        mocks.api.getBotAiOptions.mockReturnValue(
            new Promise<null>(() => {
                // never answers
            })
        );
        const component = new MindGroup({
            target,
            props: { bot, open: false, onToggle: vi.fn(), onChange: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Universe AI");
        expect(text()).not.toContain("universe-ai");
    });

    it("names Universe AI on the closed row when Orbit can't say what the bot runs on", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(null);
        const component = new MindGroup({
            target,
            props: { bot, open: false, onToggle: vi.fn(), onChange: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Universe AI");
        expect(text()).not.toContain("universe-ai");
    });
});
