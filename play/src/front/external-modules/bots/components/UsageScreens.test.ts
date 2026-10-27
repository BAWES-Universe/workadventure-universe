import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const mocks = vi.hoisted(() => ({
    api: { getBotUsage: vi.fn() },
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks.api }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import type { BotData } from "../types";
import { botUsageStore } from "../stores/BotUsageStore";
import { readBotUsage, type UsageScreen } from "../usageModel";
import UsageGroup from "./page/UsageGroup.svelte";
import MakerAskedCard from "./page/MakerAskedCard.svelte";
import BotUsageScreen from "./BotUsageScreen.svelte";

const bot = { id: "b1", name: "Nora", aiProviderRef: "universe-ai" } as BotData;
const today = new Date();
const at = (hoursAgo: number) => new Date(today.getTime() - hoursAgo * 3_600_000).toISOString();
const yesterdayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12).toISOString();

const answer = (over: Record<string, unknown> = {}) => ({
    range: "7d",
    timeZone: "UTC",
    days: ["2026-10-26", "2026-10-27"],
    hasUsage: true,
    viewerIsMaker: true,
    totals: { replies: 14, people: 2, tokens: 5200 },
    channels: { dm: 9, nearby: 5, notSplit: 0 },
    perDay: [
        { day: "2026-10-26", dm: 4, nearby: 1, notSplit: 0 },
        { day: "2026-10-27", dm: 5, nearby: 4, notSplit: 0 },
    ],
    people: [
        { id: "u1", name: "Sara", replies: 9, dm: 9, nearby: 0, notSplit: 0, lastAt: yesterdayNoon },
        { id: "u2", name: "Omar", replies: 3, dm: 0, nearby: 3, notSplit: 0, lastAt: at(0) },
    ],
    guests: { count: 1, replies: 2, dm: 0, nearby: 2, notSplit: 0 },
    ranOn: [
        {
            kind: "own-key",
            name: "My DeepSeek",
            replies: 4,
            tokens: 1200,
            costMicros: 30_000,
            unpricedReplies: 0,
            firstAt: at(40),
            lastAt: at(20),
        },
        {
            kind: "universe-ai",
            name: null,
            replies: 10,
            tokens: 4000,
            costMicros: null,
            unpricedReplies: 10,
            firstAt: at(20),
            lastAt: at(0),
        },
    ],
    keyProblem: null,
    limits: {
        universeAi: { signedIn: 30, guest: 10, guestPool: 200, windowHours: 5 },
        botLimit: null,
        botLimitWindowHours: 24,
        ranOut: { universeAi: 3, botLimit: 0 },
        askedMaker: 2,
    },
    ...over,
});

async function settle(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
    });
    await tick();
}

describe("the bot page's Usage (Orbit #491)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        botUsageStore.set(undefined);
        mocks.api.getBotUsage.mockImplementation((_id: string, range: string) =>
            Promise.resolve(readBotUsage(answer({ range })))
        );
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

    async function mountGroup(onOpenScreen = vi.fn()) {
        const component = new UsageGroup({ target, props: { bot, open: true, onToggle: vi.fn(), onOpenScreen } });
        destroy = () => component.$destroy();
        await settle();
        return onOpenScreen;
    }

    async function mountScreen(screen: UsageScreen) {
        await mountGroup();
        destroy();
        const component = new BotUsageScreen({ target, props: { bot, screen } });
        destroy = () => component.$destroy();
        await settle();
    }

    it("reads the last 7 days in the viewer's time zone and shows the range's numbers and chart", async () => {
        await mountGroup();
        expect(mocks.api.getBotUsage).toHaveBeenCalledWith("b1", "7d", expect.any(String));
        expect(text()).toContain("14");
        expect(text()).toContain("Direct messages 9");
        expect(text()).toContain("Nearby chat 5");
        expect(byTestId("bot-usage-chart")).toHaveLength(1);
        expect(text()).toContain("Sara, Omar and 1 more");
    });

    it("asks again when another range is picked", async () => {
        await mountGroup();
        byTestId("bot-usage-30d")[0].click();
        await settle();
        expect(mocks.api.getBotUsage).toHaveBeenLastCalledWith("b1", "30d", expect.any(String));
    });

    it("keeps the picked range when it comes back from a screen", async () => {
        await mountGroup();
        byTestId("bot-usage-30d")[0].click();
        await settle();
        destroy();
        await mountGroup();
        expect(mocks.api.getBotUsage).toHaveBeenLastCalledWith("b1", "30d", expect.any(String));
        expect(byTestId("bot-usage-30d")[0].getAttribute("aria-checked")).toBe("true");
    });

    it("never shows another range's numbers when the picked range can't be read, and can try again", async () => {
        await mountGroup();
        mocks.api.getBotUsage.mockRejectedValueOnce(new Error("offline"));
        byTestId("bot-usage-30d")[0].click();
        await settle();
        expect(byTestId("bot-usage-chart")).toHaveLength(0);
        expect(target.querySelector("[role=alert]")).not.toBeNull();
        (target.querySelector(".us-retry") as HTMLButtonElement).click();
        await settle();
        expect(mocks.api.getBotUsage).toHaveBeenLastCalledWith("b1", "30d", expect.any(String));
        expect(byTestId("bot-usage-chart")).toHaveLength(1);
    });

    it("opens each screen from its row", async () => {
        const onOpenScreen = await mountGroup();
        byTestId("bot-usage-people")[0].click();
        byTestId("bot-usage-ran-on")[0].click();
        byTestId("bot-usage-limits")[0].click();
        expect(onOpenScreen.mock.calls.map((call) => call[0])).toEqual(["people", "ranOn", "limits"]);
    });

    it("is one quiet line for a bot nobody chatted with yet", async () => {
        mocks.api.getBotUsage.mockResolvedValue(readBotUsage(answer({ hasUsage: false, people: [], ranOn: [] })));
        await mountGroup();
        expect(text()).toContain("Usage");
        expect(byTestId("bot-usage-chart")).toHaveLength(0);
        expect(byTestId("bot-usage-people")).toHaveLength(0);
    });

    it("is not there for someone who doesn't manage the bot", async () => {
        mocks.api.getBotUsage.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
        await mountGroup();
        expect(text()).toBe("");
    });

    it("lists people by name, guests as one count, and finds a person by name", async () => {
        await mountScreen("people");
        expect(text()).toContain("Sara");
        expect(text()).toContain("9 replies · direct messages · yesterday");
        expect(text()).toContain("3 replies · nearby · today");
        expect(text()).toContain("1 guest");
        expect(text()).toContain("2 replies · nearby only, no names");
        expect(text()).toContain("Never what they said.");
        const search = target.querySelector("input[type=search]") as HTMLInputElement;
        search.value = "om";
        search.dispatchEvent(new Event("input"));
        await tick();
        expect(text()).toContain("Omar");
        expect(text()).not.toContain("Sara");
        expect(text()).not.toContain("1 guest");
    });

    it("shows what it ran on with an estimate for the key and nothing to pay for Universe AI", async () => {
        await mountScreen("ranOn");
        expect(text()).toContain("My DeepSeek");
        expect(text()).toContain("About $0.03");
        expect(text()).toContain("Universe AI");
        expect(text()).toContain("Free to you");
    });

    it("shows the limits and how many people ran out, never who", async () => {
        await mountScreen("limits");
        expect(text()).toContain("Each signed-in person gets 30 every 5 hours");
        expect(text()).toContain("3 people ran out");
        expect(text()).toContain("2 asked Nora's maker for more");
        expect(text()).toContain("No limit of its own.");
    });

    it("tells the maker how many people asked, counts only, with one way to their key", async () => {
        const onUseKey = vi.fn();
        const component = new MakerAskedCard({
            target,
            props: { name: "Nora", usage: readBotUsage(answer({ range: "today" })), onUseKey },
        });
        destroy = () => component.$destroy();
        await tick();
        expect(text()).toContain("2 people asked for more replies today");
        expect(text()).toContain("each person gets 30 replies every 5 hours");
        expect(text()).toContain("Counts only, no names");
        byTestId("bot-maker-asked-key")[0].click();
        expect(onUseKey).toHaveBeenCalled();
    });
});
