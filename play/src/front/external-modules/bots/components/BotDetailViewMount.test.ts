import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

// The page reads the game's settings as it loads
vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

const mocks = vi.hoisted(() => ({
    api: {
        isInitialized: vi.fn(() => true),
        getBotUsage: vi.fn(),
        getBotAiOptions: vi.fn(),
        getMyAiKeys: vi.fn(() => Promise.resolve([])),
        getAvailableAIProviders: vi.fn(() => Promise.resolve([])),
        getBotPermissions: vi.fn(() => Promise.resolve({ rules: [], everyone: { canChat: true } })),
        getBotTelemetry: vi.fn(() => Promise.resolve({ on: true, universeHides: false })),
        getBotMcpServers: vi.fn(() => Promise.resolve([])),
        updateBot: vi.fn((id: string, data: object) => Promise.resolve({ id, ...data })),
    },
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks.api }));
// The rest of the game stays out of it
vi.mock("../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../../admin-api/index", () => ({ canOpenOrbit: () => false, openOrbitPage: () => {} }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import type { BotData } from "../types";
import { readBotUsage } from "../usageModel";
import BotDetailView from "./BotDetailView.svelte";

const bot: BotData = {
    id: "b1",
    name: "Tinyfish Researcher",
    characterTexture: "",
    behaviorType: "idle",
    behaviorConfig: { behaviorType: "idle", assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } },
    aiProviderRef: "universe-ai",
    chatInstructions: "",
    enabled: true,
};

const usage = {
    range: "7d",
    timeZone: "UTC",
    days: ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"],
    hasUsage: true,
    viewerIsMaker: true,
    totals: { replies: 2, people: 0, tokens: 46400 },
    channels: { dm: 0, nearby: 0, notSplit: 2 },
    perDay: [
        { day: "2026-10-22", dm: 0, nearby: 0, notSplit: 0 },
        { day: "2026-10-23", dm: 0, nearby: 0, notSplit: 0 },
        { day: "2026-10-24", dm: 0, nearby: 0, notSplit: 0 },
        { day: "2026-10-25", dm: 0, nearby: 0, notSplit: 0 },
        { day: "2026-10-26", dm: 0, nearby: 0, notSplit: 1 },
        { day: "2026-10-27", dm: 0, nearby: 0, notSplit: 1 },
        { day: "2026-10-28", dm: 0, nearby: 0, notSplit: 0 },
    ],
    people: [],
    guests: { count: 0, replies: 0, dm: 0, nearby: 0, notSplit: 0 },
    ranOn: [
        {
            kind: "universe-ai",
            name: null,
            replies: 2,
            tokens: 46400,
            costMicros: null,
            unpricedReplies: 2,
            firstAt: "2026-10-26T10:00:00Z",
            lastAt: "2026-10-27T10:00:00Z",
        },
    ],
    keyProblem: null,
    limits: {
        universeAi: { signedIn: 30, guest: 10, guestPool: 200, windowHours: 5 },
        botLimit: null,
        botLimitWindowHours: 24,
        ranOut: { universeAi: 0, botLimit: 0 },
        askedMaker: 0,
    },
};

async function settle(): Promise<void> {
    // The page's reads answer one after the other: a few rounds let all of them land
    await [1, 2, 3, 4, 5].reduce(
        (done) =>
            done
                .then(
                    () =>
                        new Promise<void>((resolve) => {
                            setTimeout(resolve, 5);
                        })
                )
                .then(() => tick()),
        Promise.resolve()
    );
}

/**
 * What Orbit says the bot can run on. It counts how often the page reads it: the page reads it once each time it is
 * handed on, so a page that hands it on without end (#1540) stops the test with an error instead of freezing it.
 */
let reads = 0;
function aiOptions() {
    return {
        current: "universe-ai",
        get universeAi() {
            if (++reads > 500) throw new Error("The bot page keeps handing the AI options around without end");
            return { available: true, limits: { reply: 32000, steps: 30 } };
        },
        maker: { id: "me", name: "Khalid" },
        viewerIsMaker: true,
        keys: [],
        currentKey: null,
        providers: null,
    };
}

function openPage(): { target: HTMLElement; view: BotDetailView } {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const view = new BotDetailView({ target, props: { bot, onSave: () => {}, onDelete: () => {} } });
    return { target, view };
}

describe("the bot page (#1540)", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        reads = 0;
        mocks.api.getBotUsage.mockImplementation(() => Promise.resolve(readBotUsage(usage)));
        mocks.api.getBotAiOptions.mockImplementation(() => Promise.resolve(aiOptions()));
    });
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("opens with what the bot can run on loaded, and stays responsive", async () => {
        const { target, view } = openPage();
        await settle();
        expect(mocks.api.getBotAiOptions).toHaveBeenCalled();
        expect(reads).toBeGreaterThan(0);
        expect(reads).toBeLessThan(50);
        expect(target.querySelector("[data-testid='bot-page-group-mind']")).not.toBeNull();
        expect(target.querySelector("[data-testid='bot-page-group-tools']")).not.toBeNull();
        view.$destroy();
    });

    it("shows Usage closed, and opens it on a tap", async () => {
        const { target, view } = openPage();
        await settle();
        const head = target.querySelector<HTMLButtonElement>("[data-testid='bot-page-group-usage'] button");
        expect(head?.getAttribute("aria-expanded")).toBe("false");
        expect(target.querySelector("[data-testid='bot-usage-chart']")).toBeNull();
        head?.click();
        await tick();
        expect(head?.getAttribute("aria-expanded")).toBe("true");
        expect(target.querySelector("[data-testid='bot-usage-chart']")).not.toBeNull();
        // Closed again, so the next page opens with every group closed
        head?.click();
        await tick();
        view.$destroy();
    });
});
