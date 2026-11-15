import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getMyUsage: vi.fn<() => Promise<unknown>>(),
    askForMoreUsage: vi.fn<() => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the page reads the usage on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { getMyUsage: game.getMyUsage, askForMoreUsage: game.askForMoreUsage },
}));
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});
vi.mock("../../../Stores/MobileLayoutStore", async () => {
    const store = await import("svelte/store");
    return { mobileLayoutStore: store.writable(true) };
});
vi.mock("../../../Stores/MapEditorStore", async () => {
    const store = await import("svelte/store");
    return { mapEditorVisibilityStore: store.writable(false) };
});
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { forgetMyUsage } from "../UsageStore";
import UsagePage from "../UsagePage.svelte";

const usage = (over: Record<string, unknown> = {}) => ({
    chat: { left: 1, words: "plenty", fullAgainAt: null },
    computer: null,
    storage: null,
    extra: null,
    ...over,
});
const computer = (over: Record<string, unknown> = {}) => ({
    left: 0.62,
    words: "plenty",
    startsAgainAt: "2026-12-01T00:00:00.000Z",
    unlimited: false,
    asked: false,
    canAskForMore: false,
    ...over,
});

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    await tick();
}

describe("the Usage page (#1999)", () => {
    let target: HTMLElement;
    let page: { $destroy: () => void } | undefined;
    const back = vi.fn();

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyUsage();
        game.getMyUsage.mockResolvedValue(usage());
        game.askForMoreUsage.mockResolvedValue({ asked: true });
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        page?.$destroy();
        page = undefined;
        target.remove();
    });

    async function open() {
        page = new UsagePage({ target, props: { onBack: back } });
        await settle();
    }
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    it("shows one bar and plain words for Universe AI, and nothing for a computer or storage when no Brick uses one", async () => {
        await open();
        expect(target.querySelector(".em-title")?.textContent).toBe("Usage");
        expect(text()).toContain("Universe AI");
        expect(text()).toContain("Plenty left");
        expect(text()).toContain("A Brick on your own key doesn't use it.");
        expect(byId("usageChatBar")?.getAttribute("style")).toContain("width: 100%");
        expect(text()).not.toContain("Computer");
        expect(text()).not.toContain("Storage");
        expect(byId("usageAskForMore")).toBeNull();
    });

    it("says when the bar is full again, and shows it as low", async () => {
        game.getMyUsage.mockResolvedValue(
            usage({ chat: { left: 0.1, words: "low", fullAgainAt: new Date(Date.now() + 3_600_000).toISOString() } })
        );
        await open();
        expect(text()).toContain("Almost used up");
        expect(text()).toContain("Full again at");
        expect(target.querySelector(".meter")?.classList.contains("low")).toBe(true);
        expect(byId("usageChatBar")?.getAttribute("style")).toContain("width: 10%");
    });

    it("never shows a count of replies or a price", async () => {
        game.getMyUsage.mockResolvedValue(
            usage({
                chat: { left: 0.1, words: "low", fullAgainAt: null },
                computer: computer({ left: 0.3, words: "half" }),
                storage: { bytes: 1_400_000_000 },
            })
        );
        await open();
        expect(text()).not.toMatch(/\$|replies left|\d+ of \d+/i);
    });

    it("says what extra usage gives in one plain line, with nothing about billing", async () => {
        game.getMyUsage.mockResolvedValue(usage({ extra: { until: "2026-11-30T12:00:00.000Z" } }));
        await open();
        expect(text()).toContain("You have extra usage until 30 Nov");
        expect(text()).toContain("From the Universe team");
        expect(text()).not.toMatch(/bill|gift|owe|debt/i);
    });

    it("shows computer time and storage for someone whose Brick uses a computer", async () => {
        game.getMyUsage.mockResolvedValue(usage({ computer: computer(), storage: { bytes: 1_400_000_000 } }));
        await open();
        expect(text()).toContain("Over half left this month");
        expect(text()).toContain("Starts again on 1 Dec");
        expect(text()).toContain("Only used when a Brick needs its computer for a job.");
        expect(text()).toContain("1.4 GB");
        expect(text()).toContain("No limit for now");
        expect(byId("usageAskForMore")).toBeNull();
    });

    it("offers Ask for more only when computer time is used up, and shows it asked once it is sent", async () => {
        game.getMyUsage.mockResolvedValue(
            usage({ computer: computer({ left: 0, words: "out", canAskForMore: true }) })
        );
        await open();
        expect(text()).toContain("Used up for this month");
        expect(text()).toContain("Your request goes to the Universe team. Chat carries on as always.");
        byId("usageAskForMore")?.click();
        await settle();
        expect(game.askForMoreUsage).toHaveBeenCalledTimes(1);
        expect(byId("usageAskForMore")).toBeNull();
        expect(text()).toContain("You asked for more");
        expect(text()).toContain("You'll see it here and in chat when it's added");
    });

    it("shows a request already waiting, without the button", async () => {
        game.getMyUsage.mockResolvedValue(
            usage({ computer: computer({ left: 0, words: "out", asked: true, canAskForMore: false }) })
        );
        await open();
        expect(text()).toContain("You asked for more");
        expect(byId("usageAskForMore")).toBeNull();
    });

    it("warns, and keeps the button, when the request could not be sent", async () => {
        game.getMyUsage.mockResolvedValue(
            usage({ computer: computer({ left: 0, words: "out", canAskForMore: true }) })
        );
        game.askForMoreUsage.mockRejectedValue(new Error("down"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await open();
        byId("usageAskForMore")?.click();
        await settle();
        warn.mockRestore();
        expect(game.warn).toHaveBeenCalledWith("Couldn't send that. Try again.");
        expect(byId("usageAskForMore")).not.toBeNull();
    });

    it("says it could not be read, with Try again", async () => {
        game.getMyUsage.mockRejectedValue(new Error("down"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await open();
        expect(byId("usageLoadFailed")?.textContent).toBe("Couldn't load your usage.");
        game.getMyUsage.mockResolvedValue(usage());
        byId("usageTryAgain")?.click();
        await settle();
        warn.mockRestore();
        expect(byId("usageLoadFailed")).toBeNull();
        expect(text()).toContain("Plenty left");
    });

    it("goes back to the Bricks", async () => {
        await open();
        const arrow = target.querySelector<HTMLElement>('[data-testid="edit-panel-back"]');
        expect(arrow?.getAttribute("aria-label")).toBe("Back to Bricks");
        arrow?.click();
        expect(back).toHaveBeenCalled();
    });
});
