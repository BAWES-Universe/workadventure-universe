import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    identityChanged: [] as Array<() => void>,
    getMyUsage: vi.fn<() => Promise<unknown>>(),
    askForMoreUsage: vi.fn<(category?: string) => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the page reads the usage on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        getMyUsage: game.getMyUsage,
        askForMoreUsage: game.askForMoreUsage,
        onIdentityChange: (listener: () => void) => {
            game.identityChanged.push(listener);
            return () => undefined;
        },
    },
}));
// The pictures are not what these tests are about
vi.mock(
    "../BrickPicture.svelte",
    async () => await import("../../../external-modules/bots/components/testStub.svelte")
);
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
    startsAgainAt: "2026-12-01T12:00:00",
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

    async function open(props: Record<string, unknown> = {}) {
        page = new UsagePage({ target, props: { onBack: back, ...props } });
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

    it("from an older Orbit, shows only the bar and its words: no count and no price", async () => {
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
        game.getMyUsage.mockResolvedValue(usage({ extra: { until: "2026-11-30T12:00:00" } }));
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
        expect(byId("usageLoadFailed")?.textContent).toContain("Usage temporarily unavailable");
        expect(byId("usageLoadFailed")?.textContent).toContain("Your Bricks keep working. Try again in a moment.");
        expect(target.querySelector(".meter")).toBeNull();
        game.getMyUsage.mockResolvedValue(usage());
        byId("usageTryAgain")?.click();
        await settle();
        warn.mockRestore();
        expect(byId("usageLoadFailed")).toBeNull();
        expect(text()).toContain("Plenty left");
    });

    // ---- Real numbers (credits and grants) ----
    const replies = (over: Record<string, unknown> = {}) => ({
        available: 18,
        total: 30,
        inProgress: 2,
        running: true,
        windowHours: 5,
        ...over,
    });
    const live = (chat: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
        usage({
            chat: {
                left: 0.6,
                words: "plenty",
                fullAgainAt: new Date(Date.now() + 3_600_000).toISOString(),
                replies: replies(),
                ...chat,
            },
            ...over,
        });
    const money = (over: Record<string, unknown> = {}) => ({
        kind: "monthly",
        availableMicros: 3_200_000,
        totalMicros: 5_000_000,
        renewsAt: "2026-12-01T12:00:00",
        canAskForMore: false,
        ...over,
    });

    it("says replies as real numbers with the time they reset, and what is in progress", async () => {
        game.getMyUsage.mockResolvedValue(live());
        await open();
        expect(text()).toContain("18 of 30 replies available");
        expect(text()).toMatch(/Resets at .+ · 2 replies in progress/);
        expect(text()).toContain("Text and spoken answers share this reply allowance.");
        expect(text()).toContain("Your own model key does not use this Universe AI reply allowance.");
        expect(text()).not.toMatch(/Plenty left|Unlimited/);
        expect(byId("usageChatBar")?.getAttribute("style")).toContain("width: 60%");
    });

    it("says 30 replies available, and when the window starts, while none is running", async () => {
        game.getMyUsage.mockResolvedValue(
            live({ left: 1, fullAgainAt: null, replies: replies({ available: 30, inProgress: 0, running: false }) })
        );
        await open();
        expect(text()).toContain("30 replies available");
        expect(text()).toContain("Your 5-hour window starts when you ask for a reply.");
        expect(text()).not.toMatch(/Resets at/);
    });

    it("never invents the window's length", async () => {
        game.getMyUsage.mockResolvedValue(
            live({ replies: replies({ available: 30, inProgress: 0, running: false, windowHours: null }) })
        );
        await open();
        expect(text()).toContain("Your window starts when you ask for a reply.");
        expect(text()).not.toMatch(/\d-hour/);
    });

    it("says no replies are available, with the time they come back, as a low bar", async () => {
        game.getMyUsage.mockResolvedValue(live({ left: 0, replies: replies({ available: 0, inProgress: 0 }) }));
        await open();
        expect(text()).toContain("No replies available");
        expect(text()).toMatch(/Resets at/);
        expect(target.querySelector(".meter")?.classList.contains("low")).toBe(true);
    });

    it("names an extra and its end, and never says Unlimited for no limit", async () => {
        game.getMyUsage.mockResolvedValue(
            live({
                replies: replies({ available: 48, total: 60, inProgress: 0 }),
                extra: { multiplier: 2, noLimit: false, until: "2026-12-31T12:00:00" },
            })
        );
        await open();
        expect(text()).toContain("48 of 60 replies available");
        expect(text()).toContain("Twice the usual until 31 Dec");
        page?.$destroy();
        game.getMyUsage.mockClear();
        forgetMyUsage();
        game.getMyUsage.mockResolvedValue(
            live({
                replies: replies({ available: 0, total: 0, inProgress: 0 }),
                extra: { multiplier: null, noLimit: true, until: "2026-12-31T12:00:00" },
            })
        );
        await open();
        expect(text()).toContain("No personal reply limit until 31 Dec");
        expect(text()).not.toMatch(/Unlimited/);
    });

    it("says a Universe AI balance it could not read, with no bar", async () => {
        game.getMyUsage.mockResolvedValue(usage({ chat: { unavailable: true } }));
        await open();
        expect(text()).toContain("Usage temporarily unavailable");
        expect(byId("usageChatBar")).toBeNull();
    });

    it("shows Apps and computers in dollars, with when a monthly one renews", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    apps: money(),
                    computer: computer({ kind: "monthly", availableMicros: 4_000_000, totalMicros: 10_000_000 }),
                }
            )
        );
        await open();
        expect(text()).toContain("Apps");
        expect(text()).toContain("$3.20 of $5 available");
        expect(text()).toMatch(/Renews 1 Dec at /);
        expect(text()).toContain("Computers");
        expect(text()).toContain("$4 of $10 available");
        expect(text()).toContain("For apps that work without you connecting anything.");
        expect(byId("usageAppsBar")?.getAttribute("style")).toContain("width: 64%");
        expect(byId("usageComputerBar")?.getAttribute("style")).toContain("width: 40%");
    });

    it("says a one-time starting credit as that, and says it does not renew once it is used up", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                { apps: money({ kind: "oneoff", availableMicros: 1_400_000, totalMicros: 2_000_000, renewsAt: null }) }
            )
        );
        await open();
        expect(text()).toContain("$1.40 of your $2 starting credit available");
        expect(text()).toContain("One-time credit");
        page?.$destroy();
        forgetMyUsage();
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    apps: money({
                        kind: "oneoff",
                        availableMicros: 0,
                        totalMicros: 2_000_000,
                        renewsAt: null,
                        canAskForMore: true,
                    }),
                }
            )
        );
        await open();
        expect(text()).toContain("Your $2 starting credit is used up");
        expect(text()).toContain("One-time credit. It doesn't renew");
        expect(text()).not.toMatch(/Renews/);
        expect(text()).toContain(
            "Your request goes to the Universe team. Nothing is owed. Apps you connect yourself keep working."
        );
    });

    it("leaves work already running out of what is available, and says it", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { apps: money({ inProgressMicros: 1_200_000 }) }));
        await open();
        expect(text()).toContain("$1.20 held, not taken yet");
    });

    it("asks for more Apps credit, naming the category, and shows it asked", async () => {
        game.getMyUsage.mockResolvedValue(
            live({}, { apps: money({ kind: "oneoff", availableMicros: 0, renewsAt: null, canAskForMore: true }) })
        );
        await open();
        byId("usageAskForMoreApps")?.click();
        await settle();
        expect(game.askForMoreUsage).toHaveBeenCalledWith("apps");
        expect(byId("usageAskForMoreApps")).toBeNull();
        expect(text()).toContain("You asked for more");
    });

    it("never offers Ask for more when Orbit does not say it applies", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { apps: money({ availableMicros: 0, canAskForMore: false }) }));
        await open();
        expect(byId("usageAskForMoreApps")).toBeNull();
        expect(text()).not.toMatch(/Top up/);
    });

    it("says a credit it could not read, never a made-up bar", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { apps: { unavailable: true } }));
        await open();
        expect(byId("usageAppsBar")).toBeNull();
        expect(text()).toContain("Usage temporarily unavailable");
    });

    it("says a computer balance it could not read, never a made-up bar", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { computer: { unavailable: true } }));
        await open();
        expect(text()).toContain("Computer");
        expect(byId("usageComputerBar")).toBeNull();
        expect(text()).toContain("Usage temporarily unavailable");
    });

    it("shows extra credit only while someone has it: what it covers, what is left, when it ends", async () => {
        await open();
        expect(byId("usageSecCredit")).toBeNull();
        page?.$destroy();
        forgetMyUsage();
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    credit: [
                        {
                            covers: ["apps", "computer"],
                            availableMicros: 3_100_000,
                            totalMicros: 5_000_000,
                            until: "2026-12-31T12:00:00",
                        },
                    ],
                }
            )
        );
        await open();
        expect(text()).toContain("Extra credit");
        expect(text()).toContain("$3.10 of $5 available");
        expect(text()).toContain("From Universe, for Apps and computers · until 31 Dec");
        expect(text()).toContain("Used first, because it ends soonest. One amount for both.");
    });

    it("shows what each Brick spent this month", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    bots: [
                        { id: "11", name: "Brick", spentMicros: 1_390_000, uses: ["apps", "computer"] },
                        { id: "12", name: "Recipe Brick", spentMicros: 180_000, uses: ["apps"] },
                    ],
                }
            )
        );
        await open({ looks: { "11": "brick-orange" } });
        expect(text()).toContain("By bot");
        expect(text()).toContain("Brick");
        expect(text()).toContain("$1.39 this month · Apps and computer");
        expect(text()).toContain("$0.18 this month · Apps");
    });

    const task = (over: Record<string, unknown> = {}) => ({
        id: "act_1",
        title: "Trip page: Web Summit Qatar",
        at: new Date().toISOString(),
        state: "done",
        spentMicros: 60_000,
        category: "apps",
        payer: "you",
        lines: [
            { label: "Instant research, 2 searches", amountMicros: 60_000 },
            { label: "Made a page", note: "Nothing" },
        ],
        ...over,
    });

    it("lists one line for each task, and opens a receipt on a tap", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    activity: [
                        task(),
                        task({
                            id: "act_2",
                            title: "Flights",
                            payer: "sponsor",
                            payerName: "BAWES Universe",
                            spentMicros: null,
                        }),
                    ],
                }
            )
        );
        await open();
        expect(text()).toContain("Activity");
        expect(text()).toContain("Trip page: Web Summit Qatar");
        expect(text()).toMatch(/Today, .+ · \$0\.06 · Apps/);
        expect(text()).toMatch(/Today, .+ · Paid by BAWES Universe/);
        expect(byId("usageReceipt")).toBeNull();
        target.querySelector<HTMLElement>('[data-activity="act_1"]')?.click();
        await settle();
        const receipt = byId("usageReceipt")?.textContent?.replace(/\s+/g, " ") ?? "";
        // A label and its amount sit at the two ends of one line
        expect(receipt).toContain("Instant research, 2 searches$0.06");
        expect(receipt).toContain("Made a pageNothing");
        expect(receipt).toContain("Paid by you");
        expect(text()).toContain(
            "Tap a task to see what it used. If one fails on our side, it's given back by itself. A task that ran is paid for, even if it wasn't what you hoped. Ask your Brick to try again."
        );
        target.querySelector<HTMLElement>('[data-activity="act_1"]')?.click();
        await settle();
        expect(byId("usageReceipt")).toBeNull();
    });

    it("says each amount under a cent, a true zero and a balance under a cent in the words of the mock, never as $0.01 or $0", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    apps: money({ availableMicros: 5_000, totalMicros: 5_000_000 }),
                    computer: computer({ money: undefined }),
                    activity: [
                        task({
                            id: "act_tiny",
                            title: "Find flights",
                            spentMicros: 4_000,
                            lines: [
                                { label: "Search flights", amountMicros: 4_000 },
                                { label: "Read one page", amountMicros: 0 },
                            ],
                        }),
                    ],
                }
            )
        );
        await open();
        expect(text()).toContain("Less than $0.01 of $5 available");
        // the amount taken is said as Orbit says it: thousandths under a cent, not "less than $0.01"
        expect(text()).toMatch(/Today, .+ · \$0\.004 · Apps/);
        expect(text()).not.toMatch(/Today, .+ · Less than \$0\.01 · Apps/);
        target.querySelector<HTMLElement>('[data-activity="act_tiny"]')?.click();
        await settle();
        const receipt = byId("usageReceipt")?.textContent?.replace(/\s+/g, " ") ?? "";
        expect(receipt).toContain("Search flights$0.004");
        expect(receipt).toContain("Read one page$0");
    });

    const partly = (over: Record<string, unknown> = {}) =>
        task({
            id: "act_partly",
            title: "Invoices to 3 clients",
            spentMicros: 40_000,
            outcome: "partial",
            outcomeNote: "Two steps worked and one didn't. Nothing was taken for the one that didn't.",
            actions: [
                { label: "gmail", outcome: "worked", text: "Gmail · worked", takenText: null },
                { label: "gmail", outcome: "worked", text: "Gmail · worked", takenText: null },
                { label: "gmail", outcome: "failed", text: "Gmail · didn't work", takenText: "Nothing taken" },
            ],
            lines: [{ label: "Instant Gmail, 3 uses", amountMicros: 40_000 }],
            ...over,
        });

    it("c3: says a partly done task as partly done, each step and how it ended, what was not taken, and why (the approved mock)", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [partly()] }));
        await open();
        expect(text()).toMatch(/Today, .+ · Partly done · \$0\.04 · Apps/);
        target.querySelector<HTMLElement>('[data-activity="act_partly"]')?.click();
        await settle();
        const rows = [...target.querySelectorAll('[data-testid="usageReceiptAction"]')].map((row) =>
            row.textContent?.replace(/\s+/g, " ").trim()
        );
        expect(rows).toEqual(["Gmail · worked", "Gmail · worked", "Gmail · didn't work Nothing taken"]);
        const receipt = byId("usageReceipt")?.textContent?.replace(/\s+/g, " ") ?? "";
        // What it took, from Orbit's own lines, is still there
        expect(receipt).toContain("Instant Gmail, 3 uses$0.04");
        expect(byId("usageReceiptWhy")?.textContent).toBe(
            "Two steps worked and one didn't. Nothing was taken for the one that didn't."
        );
        expect(byId("usageReceiptPartly")?.textContent).toBe("Partly done");
        expect(receipt).toMatch(/Partly done\s*Paid by you$/);
        // The task still counts as one that was paid for: it is not "Refunded"
        expect(receipt).not.toContain("Refunded");
        expect(receipt).not.toContain("This didn't go through on our side");
    });

    it("shows each step with its own amount, and no separate lines, when Orbit says what each step took", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    activity: [
                        partly({
                            actions: [
                                {
                                    label: "gmail",
                                    outcome: "worked",
                                    text: "Gmail · worked",
                                    takenText: null,
                                    amountMicros: 20_000,
                                },
                                {
                                    label: "gmail",
                                    outcome: "worked",
                                    text: "Gmail · worked",
                                    takenText: null,
                                    amountMicros: 20_000,
                                },
                                {
                                    label: "gmail",
                                    outcome: "failed",
                                    text: "Gmail · didn't work",
                                    takenText: "Nothing taken",
                                },
                            ],
                        }),
                    ],
                }
            )
        );
        await open();
        target.querySelector<HTMLElement>('[data-activity="act_partly"]')?.click();
        await settle();
        const rows = [...target.querySelectorAll('[data-testid="usageReceiptAction"]')].map((row) =>
            row.textContent?.replace(/\s+/g, " ").trim()
        );
        expect(rows).toEqual(["Gmail · worked $0.02", "Gmail · worked $0.02", "Gmail · didn't work Nothing taken"]);
        expect(byId("usageReceipt")?.textContent).not.toContain("Instant Gmail, 3 uses");
    });

    const worked = (amountMicros?: number) => ({
        label: "gmail",
        outcome: "worked",
        text: "Gmail · worked",
        takenText: null,
        ...(amountMicros === undefined ? {} : { amountMicros }),
    });
    const failedStep = { label: "gmail", outcome: "failed", text: "Gmail · didn't work", takenText: "Nothing taken" };
    const stepRows = () =>
        [...target.querySelectorAll('[data-testid="usageReceiptAction"]')].map((row) =>
            row.textContent?.replace(/\s+/g, " ").trim()
        );
    const openPartly = async (over: Record<string, unknown>) => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [partly(over)] }));
        await open();
        target.querySelector<HTMLElement>('[data-activity="act_partly"]')?.click();
        await settle();
    };

    it("draws the amount of each worked step (Orbit's amountMicros), under a cent in thousandths as Orbit says it, and zero as $0", async () => {
        await openPartly({ actions: [worked(20_000), worked(4_000), worked(0), failedStep] });
        expect(stepRows()).toEqual([
            "Gmail · worked $0.02",
            "Gmail · worked $0.004",
            "Gmail · worked $0",
            "Gmail · didn't work Nothing taken",
        ]);
        // The steps are the lines: Orbit's own lines are not shown under them
        expect(byId("usageReceipt")?.textContent).not.toContain("Instant Gmail, 3 uses");
    });

    it("shows a worked step with no amount without one, and Orbit's lines when no worked step has an amount", async () => {
        await openPartly({ actions: [worked(), worked(), failedStep] });
        expect(stepRows()).toEqual(["Gmail · worked", "Gmail · worked", "Gmail · didn't work Nothing taken"]);
        expect(byId("usageReceipt")?.textContent?.replace(/\s+/g, " ")).toContain("Instant Gmail, 3 uses$0.04");
    });

    it("mixes a step with a known amount and one whose price is not known yet: amount unavailable only where Orbit says so", async () => {
        await openPartly({
            actions: [worked(20_000), worked(), failedStep],
            lines: [{ label: "Instant Gmail, 2 uses", note: "Price not known yet" }],
        });
        expect(stepRows()).toEqual([
            "Gmail · worked $0.02",
            "Gmail · worked amount unavailable",
            "Gmail · didn't work Nothing taken",
        ]);
        expect(byId("usageReceipt")?.textContent).not.toContain("Instant Gmail, 2 uses");
        // With no such word from Orbit, the step with no amount carries none
        game.getMyUsage.mockResolvedValue(
            live({}, { activity: [partly({ actions: [worked(20_000), worked(), failedStep] })] })
        );
        // The page is made again from nothing, and the task opened, so the rows read are the new ones
        page?.$destroy();
        page = undefined;
        target.innerHTML = "";
        await open();
        target.querySelector<HTMLElement>('[data-activity="act_partly"]')?.click();
        await settle();
        expect(stepRows()).toEqual(["Gmail · worked $0.02", "Gmail · worked", "Gmail · didn't work Nothing taken"]);
    });

    it("never gives a failed step an amount, whatever it carries", async () => {
        await openPartly({ actions: [worked(20_000), { ...failedStep, amountMicros: 50_000 }] });
        expect(stepRows()).toEqual(["Gmail · worked $0.02", "Gmail · didn't work Nothing taken"]);
    });

    it("only calls a task partly done when Orbit says so and a step worked; otherwise it reads as before", async () => {
        // Orbit says every step worked: done. (Orbit saying "partial" with one worked step is partly done, since the other step can be the computer)
        const noFailure = partly({
            id: "act_a",
            title: "All worked",
            outcome: "done",
            outcomeNote: undefined,
            actions: [{ label: "gmail", outcome: "worked", text: "Gmail · worked", takenText: null }],
        });
        const noWord = partly({ id: "act_b", title: "Older Orbit", outcome: undefined, outcomeNote: undefined });
        const refunded = partly({ id: "act_c", title: "Refunded one", state: "refunded", spentMicros: null });
        game.getMyUsage.mockResolvedValue(live({}, { activity: [noFailure, noWord, refunded] }));
        await open();
        expect(text()).not.toContain("Partly done");
        expect(text()).toMatch(/Refunded one[^]*Refunded, nothing taken/);
        for (const id of ["act_a", "act_b", "act_c"]) {
            target.querySelector<HTMLElement>(`[data-activity="${id}"]`)?.click();
            // eslint-disable-next-line no-await-in-loop
            await settle();
            expect(byId("usageReceiptPartly")).toBeNull();
            target.querySelector<HTMLElement>(`[data-activity="${id}"]`)?.click();
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
        // A task with no actions at all (an older Orbit, a computer's) is exactly as before
        game.getMyUsage.mockResolvedValue(live({}, { activity: [task()] }));
    });

    describe("how a computer task ended, as Orbit reads it (stopped, still deciding, refund pending, a computer given back beside an App that worked)", () => {
        const gmail = {
            label: "gmail",
            outcome: "worked",
            text: "Gmail · worked",
            takenText: null,
            amountMicros: 9_000,
        };
        const rowsOf = (id: string) => {
            target.querySelector<HTMLElement>(`[data-activity="${id}"]`)?.click();
            return {
                hint:
                    target.querySelector(`[data-activity="${id}"] .m`)?.textContent?.replace(/\s+/g, " ").trim() ?? "",
            };
        };
        const receiptText = () => byId("usageReceipt")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const show = async (item: Record<string, unknown>) => {
            game.getMyUsage.mockResolvedValue(live({}, { activity: [item] }));
            await open();
            const { hint } = rowsOf(String(item.id));
            await settle();
            return hint;
        };

        it("reads a computer given back beside a Gmail that was charged as Partly done, with Orbit's note, the Given back line, and never Done or Refunded", async () => {
            const hint = await show(
                task({
                    id: "act_mixed",
                    title: "Send the report",
                    category: "computer",
                    spentMicros: 9_000,
                    returnedMicros: 50_000,
                    outcome: "partial",
                    outcomeText: "Partly done",
                    outcomeNote:
                        "One step worked and one didn’t. Computer cost of $0.05 was returned. Gmail charged $0.009. You pay $0.009 in all.",
                    actions: [gmail],
                    lines: [
                        { label: "Instant gmail, 1 use", amountMicros: 9_000 },
                        { label: "Computer, 5 minutes", note: "Given back", returnedMicros: 50_000 },
                    ],
                })
            );
            expect(hint).toContain("Partly done");
            expect(hint).not.toContain("Refunded");
            expect(byId("usageReceiptPartly")?.textContent).toBe("Partly done");
            expect(byId("usageReceiptWhy")?.textContent).toBe(
                "One step worked and one didn’t. Computer cost of $0.05 was returned. Gmail charged $0.009. You pay $0.009 in all."
            );
            expect(receiptText()).toContain("Gmail · worked $0.009");
            expect(receiptText()).toContain("Computer, 5 minutes");
            // the computer's line says Given back and what came back; it is not "Nothing taken"
            expect(receiptText()).toContain("Given back $0.05");
            expect(receiptText()).not.toContain("Nothing taken");
        });

        describe("a let-go App that was then confirmed delivered, with the computer part given back (Orbit's own words, shown as they are)", () => {
            const NOTE = "Partly done. Exa was delivered. Its hold was released. The computer part didn't finish and its cost was returned.";
            const delivered = {
                label: "exa",
                outcome: "worked",
                text: "Exa · worked",
                takenText: null,
                amountMicros: 0,
            };
            const receipt = () =>
                task({
                    id: "act_late",
                    title: "Research the trip",
                    category: "computer",
                    state: "done",
                    spentMicros: 0,
                    returnedMicros: 30_000,
                    outcome: "partial",
                    outcomeText: "Partly done",
                    outcomeNote: NOTE,
                    actions: [delivered],
                    lines: [{ label: "Computer, 3 minutes", note: "Given back", returnedMicros: 30_000 }],
                });
            const row = () => target.querySelector('[data-activity="act_late"]');
            const collapsedHint = async () => {
                game.getMyUsage.mockResolvedValue(live({}, { activity: [receipt()] }));
                await open();
                return row()?.querySelector(".m")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
            };

            it("says Partly done on the collapsed row itself, with no receipt open, never Done, Refunded or a charge", async () => {
                const hint = await collapsedHint();
                expect(hint).toMatch(/Partly done/);
                expect(hint).not.toMatch(/Refunded|·\s*Done\b/);
                expect(byId("usageReceipt")).toBeNull();
                expect(byId("usageReceiptWhy")).toBeNull();
            });

            it("shows the App that was delivered as its own line, Orbit's note word for word, and the computer part given back, once the row is opened", async () => {
                await collapsedHint();
                row()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                await settle();
                expect(stepRows()).toEqual(["Exa · worked $0"]);
                expect(byId("usageReceiptWhy")?.textContent).toBe(NOTE);
                expect(byId("usageReceiptPartly")?.textContent).toBe("Partly done");
                expect(receiptText()).toContain("Computer, 3 minutes");
                expect(receiptText()).toContain("Given back $0.03");
                expect(receiptText()).not.toContain("Nothing taken");
                expect(receiptText()).not.toContain("Refunded");
                // nothing was owed: no "Paid by" line under it (Orbit says $0)
                expect(receiptText()).not.toContain("Paid by");
                expect(byId("usageReceipt")?.querySelector(".paid:not([data-testid])")).toBeNull();
            });

            it("keeps the Paid by line when something was owed (a partly done task that charged)", async () => {
                game.getMyUsage.mockResolvedValue(live({}, { activity: [{ ...receipt(), spentMicros: 9_000, actions: [{ ...delivered, amountMicros: 9_000 }] }] }));
                await open();
                row()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                await settle();
                expect(receiptText()).toContain("Paid by you");
            });

            it("keeps the Paid by line for a task that is simply done at $0 (only a partly done task with nothing owed hides it)", async () => {
                game.getMyUsage.mockResolvedValue(live({}, { activity: [{ ...receipt(), outcome: "done", outcomeText: undefined, outcomeNote: undefined, actions: [] }] }));
                await open();
                row()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                await settle();
                expect(receiptText()).toContain("Paid by you");
            });

            it("keeps the Paid by line for a partly done task whose total Orbit did not send (only a total of exactly $0 hides it)", async () => {
                game.getMyUsage.mockResolvedValue(live({}, { activity: [{ ...receipt(), spentMicros: null }] }));
                await open();
                row()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                await settle();
                expect(receiptText()).toContain("Paid by you");
            });

            it("says nothing about who paid on the collapsed row either when nothing was paid by anyone else (a sponsor or Universe paying a $0 partial)", async () => {
                for (const payer of ["universe", "sponsor"]) {
                    game.getMyUsage.mockResolvedValue(live({}, { activity: [{ ...receipt(), payer, payerName: payer === "sponsor" ? "Dana" : undefined }] }));
                    await open();
                    const hint = row()?.querySelector(".m")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
                    expect(hint, payer).toMatch(/Partly done/);
                    expect(hint, payer).not.toMatch(/Paid by/);
                }
            });
        });

        it("shows Orbit's headline and note for a refund that is pending, never Done, never Refunded, and no Paid by line", async () => {
            const hint = await show(
                task({
                    id: "act_pending",
                    title: "Weekly report",
                    category: "computer",
                    spentMicros: null,
                    refundPendingMicros: 50_000,
                    outcome: "refund_pending",
                    outcomeText: "$0.05 refund pending",
                    outcomeNote:
                        "We’re giving back the computer cost. It shows in your credit as soon as it’s confirmed.",
                    actions: [],
                    lines: [{ label: "Computer, 5 minutes", note: "Refund pending" }],
                })
            );
            expect(hint).toContain("$0.05 refund pending");
            expect(hint).not.toMatch(/Refunded|Done/);
            expect(byId("usageReceiptPartly")?.textContent).toBe("$0.05 refund pending");
            expect(byId("usageReceiptWhy")?.textContent).toBe(
                "We’re giving back the computer cost. It shows in your credit as soon as it’s confirmed."
            );
            expect(receiptText()).toContain("Refund pending");
            expect(receiptText()).not.toContain("Paid by");
            expect(receiptText()).not.toContain("nothing taken");
        });

        it("says the pending amount itself, the way Orbit does, when Orbit sends no headline (thousandths under a cent)", async () => {
            const hint = await show(
                task({
                    id: "act_pending2",
                    title: "Tiny report",
                    category: "computer",
                    spentMicros: null,
                    refundPendingMicros: 9_000,
                    outcome: "refund_pending",
                    lines: [],
                })
            );
            expect(hint).toContain("$0.009 refund pending");
            expect(byId("usageReceiptPartly")?.textContent).toBe("$0.009 refund pending");
        });

        it("reads a job stopped at the person's spending rule as Stopped at your spending rule, never Done", async () => {
            const hint = await show(
                task({
                    id: "act_rule",
                    title: "Book the table",
                    category: "computer",
                    spentMicros: 30_000,
                    outcome: "stopped",
                    outcomeText: "Stopped at your spending rule",
                    outcomeNote:
                        "It stopped before it finished, and nothing was confirmed as done. Computer time used $0.03.",
                    actions: [],
                    lines: [{ label: "Computer, 5 minutes", amountMicros: 30_000 }],
                })
            );
            expect(hint).toContain("Stopped at your spending rule");
            expect(hint).not.toContain("Done");
            expect(byId("usageReceiptPartly")?.textContent).toBe("Stopped at your spending rule");
            expect(byId("usageReceiptWhy")?.textContent).toBe(
                "It stopped before it finished, and nothing was confirmed as done. Computer time used $0.03."
            );
            // what it used is still said, and who paid
            expect(receiptText()).toContain("Computer, 5 minutes$0.03");
            expect(receiptText()).toMatch(/Paid by you$/);
        });

        it("reads a stop by the person, a stop with nothing charged, and a stop that sends no words", async () => {
            const hint = await show(
                task({
                    id: "act_stop",
                    title: "Look it up",
                    category: "computer",
                    spentMicros: null,
                    outcome: "stopped",
                    outcomeText: "Stopped",
                    lines: [],
                })
            );
            expect(hint).toContain("Stopped");
            expect(receiptText()).not.toContain("Paid by");
            const plain = await show(
                task({
                    id: "act_stop2",
                    title: "Look it up",
                    category: "computer",
                    spentMicros: null,
                    outcome: "stopped",
                    lines: [],
                })
            );
            expect(plain).toContain("Stopped");
            expect(plain).not.toContain("Done");
        });

        it("shows Still checking with Orbit's note: computer time is charged for now, never Done or Refunded", async () => {
            const hint = await show(
                task({
                    id: "act_deciding",
                    title: "Fill the form",
                    category: "computer",
                    spentMicros: 30_000,
                    outcome: "deciding",
                    outcomeText: "Still checking",
                    outcomeNote:
                        "We’re still deciding whether to give back the computer cost. Computer time $0.03 is charged for now.",
                    lines: [{ label: "Computer, 5 minutes", amountMicros: 30_000 }],
                })
            );
            expect(hint).toContain("Still checking");
            expect(hint).not.toMatch(/Refunded|Done/);
            expect(byId("usageReceiptWhy")?.textContent).toContain("charged for now");
        });

        it("shows the headline Orbit sends for a partly done task, and ours only when Orbit sends none", async () => {
            const orbit = await show(
                task({
                    id: "act_w1",
                    title: "Words",
                    outcome: "partial",
                    outcomeText: "Partly done, one step open",
                    actions: [gmail],
                    lines: [],
                })
            );
            expect(orbit).toContain("Partly done, one step open");
            const none = await show(
                task({ id: "act_w2", title: "No words", outcome: "partial", actions: [gmail], lines: [] })
            );
            expect(none).toContain("Partly done");
            expect(none).not.toContain("one step open");
        });

        it("a task Orbit calls done is still plain done: no headline, no note", async () => {
            const hint = await show(task({ id: "act_done", title: "Plain", outcome: "done" }));
            expect(hint).not.toMatch(/Partly|Stopped|deciding|pending/);
            expect(byId("usageReceiptPartly")).toBeNull();
        });
    });

    describe("a task that did not finish, or could not be confirmed (Orbit's outcome failed / unconfirmed, action unknown)", () => {
        const unknownStep = (over: Record<string, unknown> = {}) => ({
            label: "gmail",
            outcome: "unknown",
            text: "Gmail · couldn't confirm delivery",
            takenText: "Hold being released",
            ...over,
        });
        const failedTask = (over: Record<string, unknown> = {}) =>
            task({
                id: "act_failed",
                title: "Email the invoices",
                category: "computer",
                spentMicros: 30_000,
                outcome: "failed",
                outcomeText: "Didn't finish",
                outcomeNote: "The message wasn't sent. Computer time used $0.03. Gmail charged $0.",
                actions: [failedStep],
                lines: [{ label: "Computer time", amountMicros: 30_000 }],
                ...over,
            });
        const openTask = async (item: Record<string, unknown>) => {
            game.getMyUsage.mockResolvedValue(live({}, { activity: [item] }));
            await open();
            target.querySelector<HTMLElement>(`[data-activity="${item.id}"]`)?.click();
            await settle();
        };

        it("never reads a failed task as done: Orbit's headline, each step, and Orbit's note", async () => {
            await openTask(failedTask());
            expect(text()).toMatch(/Today, .+ · Didn't finish · \$0\.03 · Computer/);
            expect(stepRows()).toEqual(["Gmail · didn't work Nothing taken"]);
            expect(byId("usageReceiptWhy")?.textContent).toBe(
                "The message wasn't sent. Computer time used $0.03. Gmail charged $0."
            );
            expect(byId("usageReceiptPartly")?.textContent).toBe("Didn't finish");
            expect(byId("usageReceipt")?.textContent).not.toContain("Refunded");
        });

        it('reads a rule stop as Orbit\'s headline and note, never as done, and with nothing taken no "Paid by" line', async () => {
            await openTask(
                failedTask({
                    id: "act_rule",
                    outcome: "stopped",
                    outcomeText: "Stopped at your spending rule",
                    outcomeNote: "A rule you set stopped this task before it spent more.",
                    spentMicros: null,
                    actions: [],
                    lines: [],
                })
            );
            expect(text()).toMatch(/Today, .+ · Stopped at your spending rule · Computer/);
            expect(text()).not.toMatch(/· Done/);
            expect(byId("usageReceiptPartly")?.textContent).toBe("Stopped at your spending rule");
            expect(byId("usageReceiptWhy")?.textContent).toBe("A rule you set stopped this task before it spent more.");
            expect(byId("usageReceipt")?.textContent).not.toContain("Paid by");
        });

        it('shows "$0.05 refund pending" and a task still being decided with Orbit\'s words', async () => {
            game.getMyUsage.mockResolvedValue(
                live(
                    {},
                    {
                        activity: [
                            failedTask({
                                id: "act_pending",
                                outcome: "refund_pending",
                                outcomeText: "$0.05 refund pending",
                                outcomeNote: "We're giving this back. It will show here when it is done.",
                                spentMicros: null,
                                refundPendingMicros: 50_000,
                                actions: [],
                                lines: [],
                            }),
                            failedTask({
                                id: "act_deciding",
                                title: "Second task",
                                outcome: "deciding",
                                outcomeText: "Still deciding",
                                outcomeNote: "We're still checking how this one ended.",
                                spentMicros: null,
                                actions: [],
                                lines: [],
                            }),
                        ],
                    }
                )
            );
            await open();
            expect(text()).toMatch(/Email the invoices[^]*\$0\.05 refund pending/);
            expect(text()).toMatch(/Second task[^]*Still deciding/);
            target.querySelector<HTMLElement>('[data-activity="act_pending"]')?.click();
            await settle();
            expect(byId("usageReceiptPartly")?.textContent).toBe("$0.05 refund pending");
            expect(byId("usageReceiptWhy")?.textContent).toBe(
                "We're giving this back. It will show here when it is done."
            );
            expect(byId("usageReceipt")?.textContent).not.toContain("Refunded");
        });

        it("reads a task whose computer was returned and whose Gmail step was charged as Partly done, not Done", async () => {
            await openTask(
                failedTask({
                    id: "act_mixed",
                    outcome: "partial",
                    outcomeText: "Partly done",
                    outcomeNote: "The Gmail step worked. The computer's time was returned.",
                    spentMicros: 5_000,
                    returnedMicros: 30_000,
                    actions: [
                        {
                            label: "gmail",
                            outcome: "worked",
                            text: "Gmail · sent",
                            takenText: null,
                            amountMicros: 5_000,
                        },
                    ],
                    lines: [{ label: "Computer time", amountMicros: 30_000, note: "Returned" }],
                })
            );
            expect(text()).toMatch(/Today, .+ · Partly done/);
            expect(byId("usageReceiptPartly")?.textContent).toBe("Partly done");
        });

        it("shows an action Orbit could not confirm with its own words, and no claim of ours when it sends none", async () => {
            await openTask(
                failedTask({
                    id: "act_unconfirmed",
                    outcome: "unconfirmed",
                    outcomeText: "Couldn't confirm",
                    outcomeNote: "We couldn't confirm whether Exa finished. We're releasing your hold.",
                    spentMicros: null,
                    actions: [
                        unknownStep(),
                        unknownStep({ label: "exa", text: "Exa · couldn't confirm", takenText: undefined }),
                    ],
                    lines: [],
                })
            );
            expect(text()).toMatch(/Today, .+ · Couldn't confirm · Computer/);
            expect(stepRows()).toEqual([
                "Gmail · couldn't confirm delivery Hold being released",
                "Exa · couldn't confirm",
            ]);
            expect(byId("usageReceiptWhy")?.textContent).toBe(
                "We couldn't confirm whether Exa finished. We're releasing your hold."
            );
            // Nothing was taken from anyone, so there is no "Paid by you" line
            expect(byId("usageReceipt")?.textContent).not.toContain("Paid by");
        });

        it("shows the headline of an outcome it does not know when Orbit sends no note, and none for a genuine done task", async () => {
            const future = task({
                id: "act_future",
                title: "Future task",
                outcome: "something_new",
                outcomeText: "Held up",
            });
            // Orbit gives a genuine done task the word "Done" too: that is no headline
            const genuine = task({ id: "act_done", title: "Done task", outcome: "done", outcomeText: "Done" });
            // A known outcome with no evidence for it ("partial" with no step that worked) stays done, whatever its word
            const unproven = task({
                id: "act_unproven",
                title: "Unproven task",
                outcome: "partial",
                outcomeText: "Partly done",
            });
            game.getMyUsage.mockResolvedValue(live({}, { activity: [future, genuine, unproven] }));
            await open();
            expect(text()).toMatch(/Future task[^]*Held up/);
            expect(text()).not.toMatch(/Done task[^]*(Today|Yesterday),[^]*· Done/);
            expect(text()).not.toContain("Partly done");
            target.querySelector<HTMLElement>('[data-activity="act_future"]')?.click();
            await settle();
            expect(byId("usageReceiptPartly")?.textContent).toBe("Held up");
            target.querySelector<HTMLElement>('[data-activity="act_future"]')?.click();
            await settle();
            for (const id of ["act_done", "act_unproven"]) {
                target.querySelector<HTMLElement>(`[data-activity="${id}"]`)?.click();
                // eslint-disable-next-line no-await-in-loop
                await settle();
                expect(byId("usageReceiptPartly")).toBeNull();
                target.querySelector<HTMLElement>(`[data-activity="${id}"]`)?.click();
                // eslint-disable-next-line no-await-in-loop
                await settle();
            }
        });

        it("says a refunded task nobody could confirm as both: couldn't confirm, its steps and Orbit's note, and the refund", async () => {
            await openTask(
                failedTask({
                    id: "act_released",
                    state: "refunded",
                    outcome: "unconfirmed",
                    outcomeText: "Couldn't confirm",
                    outcomeNote: "We couldn't confirm whether Exa finished. We released your hold.",
                    spentMicros: null,
                    actions: [unknownStep({ takenText: "Hold released" })],
                    lines: [],
                })
            );
            expect(text()).toMatch(/Today, .+ · Couldn't confirm · Refunded/);
            expect(text()).not.toContain("Refunded, nothing taken");
            expect(stepRows()).toEqual(["Gmail · couldn't confirm delivery Hold released"]);
            expect(byId("usageReceiptWhy")?.textContent).toBe(
                "We couldn't confirm whether Exa finished. We released your hold."
            );
            expect(byId("usageReceiptPartly")?.textContent).toBe("Couldn't confirm");
            // Never the words that say it didn't go through: delivery is not known
            expect(byId("usageReceipt")?.textContent).not.toContain("This didn't go through on our side");
            expect(byId("usageReceipt")?.textContent?.replace(/\s+/g, " ")).toMatch(/Couldn't confirm\s*Refunded$/);
        });

        it("says our own words when Orbit sends an outcome with no headline", async () => {
            await openTask(failedTask({ outcomeText: undefined }));
            expect(text()).toContain("Didn't finish");
            game.getMyUsage.mockResolvedValue(
                live({}, { activity: [failedTask({ id: "act_u", outcome: "unconfirmed", outcomeText: undefined })] })
            );
            page?.$destroy();
            page = undefined;
            target.innerHTML = "";
            await open();
            expect(text()).toContain("Couldn't confirm");
        });

        it("shows the note of an outcome it does not know, and reads it as done only when Orbit has nothing to say", async () => {
            const future = task({
                id: "act_future",
                title: "Future task",
                outcome: "something_new",
                outcomeText: "Held up",
                outcomeNote: "Orbit's note for an outcome this page does not know.",
            });
            const plain = task({ id: "act_plain", title: "Plain task", outcome: "something_new" });
            game.getMyUsage.mockResolvedValue(live({}, { activity: [future, plain] }));
            await open();
            expect(text()).toMatch(/Future task[^]*Held up/);
            target.querySelector<HTMLElement>('[data-activity="act_future"]')?.click();
            await settle();
            expect(byId("usageReceiptWhy")?.textContent).toBe("Orbit's note for an outcome this page does not know.");
            target.querySelector<HTMLElement>('[data-activity="act_future"]')?.click();
            await settle();
            target.querySelector<HTMLElement>('[data-activity="act_plain"]')?.click();
            await settle();
            expect(byId("usageReceiptWhy")).toBeNull();
            expect(byId("usageReceiptPartly")).toBeNull();
            expect(byId("usageReceipt")?.textContent).toContain("Paid by you");
        });

        it("calls a task partly done when a step worked and one could not be confirmed", async () => {
            await openPartly({
                actions: [worked(20_000), unknownStep()],
            });
            expect(stepRows()).toEqual([
                "Gmail · worked $0.02",
                "Gmail · couldn't confirm delivery Hold being released",
            ]);
            expect(byId("usageReceiptPartly")?.textContent).toBe("Partly done");
        });
    });

    it("says amount unavailable when nobody can tell what a task took yet, never a number and never Nothing", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    activity: [
                        task({
                            id: "act_unknown",
                            title: "Set a price alert",
                            spentMicros: null,
                            lines: [
                                { label: "Instant Alerts, 1 use", note: "Price not known yet" },
                                { label: "Made a page", note: "Nothing" },
                            ],
                        }),
                    ],
                }
            )
        );
        await open();
        expect(text()).toMatch(/Today, .+ · amount unavailable · Apps/);
        target.querySelector<HTMLElement>('[data-activity="act_unknown"]')?.click();
        await settle();
        const receipt = byId("usageReceipt")?.textContent?.replace(/\s+/g, " ") ?? "";
        expect(receipt).toContain("Instant Alerts, 1 useamount unavailable");
        expect(receipt).toContain("Made a pageNothing");
        expect(receipt).not.toContain("Price not known yet");
    });

    it("opens the receipt a link asked for", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [task(), task({ id: "act_2", title: "Flights" })] }));
        await open({ receiptId: "act_2" });
        expect(byId("usageReceipt")).not.toBeNull();
        expect(target.querySelector('[data-activity="act_2"]')?.classList.contains("open")).toBe(true);
        expect(target.querySelector('[data-activity="act_1"]')?.classList.contains("open")).toBe(false);
    });

    it("opens no receipt for a task that is not there, and the page is still there", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [task()] }));
        await open({ receiptId: "act_404" });
        expect(byId("usageReceipt")).toBeNull();
        expect(byId("usagePage")).not.toBeNull();
    });

    it("says a refunded task as refunded with nothing taken, and why, and offers no Didn't work", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    activity: [
                        task({
                            id: "act_3",
                            title: "Welcome video, didn't work",
                            state: "refunded",
                            spentMicros: null,
                        }),
                    ],
                }
            )
        );
        await open({ receiptId: "act_3" });
        expect(text()).toContain("Refunded, nothing taken");
        expect(byId("usageReceipt")?.textContent).toContain("Refunded");
        expect(byId("usageReceiptWhy")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
            "This didn't go through on our side, so nothing was taken. You didn't have to ask."
        );
        expect(byId("usageDidntWork")).toBeNull();
    });

    it("offers no Didn't work on a task that ran, and says it is paid for", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [task()] }));
        await open({ receiptId: "act_1" });
        expect(byId("usageReceipt")?.textContent).toContain("Paid by you");
        expect(byId("usageReceiptWhy")).toBeNull();
        expect(byId("usageDidntWork")).toBeNull();
        expect(text()).toContain("A task that ran is paid for");
    });

    it("leaves out a task the system is still looking up (an older Orbit sends it as checking)", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                { activity: [task({ id: "act_9", title: "Flight search", state: "checking", spentMicros: null })] }
            )
        );
        await open();
        expect(text()).not.toContain("Flight search");
        expect(text()).not.toMatch(/checking/i);
    });

    it("says the reset time again in the new language when the language changes while the page is open", async () => {
        game.getMyUsage.mockResolvedValue(live({ fullAgainAt: "2026-11-25T15:40:00" }));
        // The clock is on another local day than the reset, so the date is in the words whatever day the test runs
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-10T12:00:00"));
        try {
            await open();
            expect(text()).toContain("25 Nov, 3:40 PM");
            loadLocale("fr-FR");
            setLocale("fr-FR");
            await settle();
            expect(text()).toContain("15:40");
            expect(text()).not.toContain("3:40 PM");
        } finally {
            vi.useRealTimers();
            setLocale("en-US");
        }
    });

    it("says the rows of tasks and credit again in the new language, an open receipt included, with no new read", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    activity: [task()],
                    credit: [
                        {
                            covers: ["apps"],
                            availableMicros: 3_100_000,
                            totalMicros: 5_000_000,
                            until: "2026-12-31T12:00:00",
                        },
                    ],
                }
            )
        );
        try {
            await open({ receiptId: "act_1" });
            expect(byId("usageReceipt")?.textContent).toContain("$0.06");
            expect(byId("usageActivity")?.textContent).toContain("$0.06");
            expect(text()).toContain("$3.10 of $5");
            loadLocale("fr-FR");
            setLocale("fr-FR");
            await settle();
            expect(game.getMyUsage).toHaveBeenCalledTimes(1);
            // Every figure is written the way the new language writes it, with nothing read again
            expect(byId("usageReceipt")?.textContent).toContain("0,06");
            expect(byId("usageReceipt")?.textContent).not.toContain("$0.06");
            expect(byId("usageActivity")?.textContent).toContain("0,06");
            expect(text()).not.toContain("$3.10");
        } finally {
            setLocale("en-US");
        }
    });

    it("opens a receipt again, and puts the keyboard on it, each time a link asks for it, even the same one", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [task()] }));
        await open({ receiptId: "act_1", receiptRequest: 1 });
        expect(byId("usageReceipt")).not.toBeNull();
        expect(document.activeElement).toBe(byId("usageActivity"));
        // The person closes it, and the same link is followed again
        byId("usageActivity")?.click();
        await settle();
        expect(byId("usageReceipt")).toBeNull();
        (page as unknown as { $set: (props: object) => void }).$set({ receiptRequest: 2 });
        await settle();
        expect(byId("usageReceipt")).not.toBeNull();
        expect(document.activeElement).toBe(byId("usageActivity"));
    });

    it("leaves a receipt closed that was closed, when nothing asks for it again", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [task()] }));
        await open({ receiptId: "act_1", receiptRequest: 1 });
        byId("usageActivity")?.click();
        await settle();
        expect(byId("usageReceipt")).toBeNull();
        (page as unknown as { $set: (props: object) => void }).$set({ receiptRequest: 1 });
        await settle();
        expect(byId("usageReceipt")).toBeNull();
    });

    it("waits on both request buttons while one request is out, and gives them back when it is done", async () => {
        let taken: (value: unknown) => void = () => undefined;
        game.askForMoreUsage.mockReturnValue(
            new Promise((resolve) => {
                taken = resolve;
            })
        );
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    apps: money({ availableMicros: 0, canAskForMore: true }),
                    computer: computer({
                        kind: "monthly",
                        availableMicros: 0,
                        totalMicros: 1_000_000,
                        canAskForMore: true,
                    }),
                }
            )
        );
        await open();
        const buttons = () =>
            [byId("usageAskForMoreApps"), byId("usageAskForMoreComputer")].filter(Boolean) as HTMLButtonElement[];
        expect(buttons()).toHaveLength(2);
        buttons()[0].click();
        await settle();
        expect(buttons().every((button) => button.disabled)).toBe(true);
        taken({ asked: true });
        await settle();
        // The one that was asked shows it was; the other is available again
        expect(byId("usageAskForMoreApps")).toBeNull();
        expect((byId("usageAskForMoreComputer") as HTMLButtonElement | null)?.disabled).toBe(false);
    });

    it("says less than a cent in progress, not $0, for a reservation below one cent", async () => {
        game.getMyUsage.mockResolvedValue(
            live({}, { apps: money({ inProgressMicros: 5_000 }), computer: computer({ money: undefined }) })
        );
        await open();
        expect(text()).toContain("Less than $0.01 held, not taken yet");
        expect(text()).not.toContain("$0 held");
        page?.$destroy();
        forgetMyUsage();
        game.getMyUsage.mockResolvedValue(live({}, { apps: money({ inProgressMicros: 250_000 }) }));
        await open();
        expect(text()).toContain("$0.25 held, not taken yet");
    });

    it("says 'about half left' for the old half bar, not 'plenty'", async () => {
        game.getMyUsage.mockResolvedValue(usage({ chat: { left: 0.4, words: "half", fullAgainAt: null } }));
        await open();
        expect(text()).toContain("About half left");
        expect(text()).not.toContain("Plenty left");
    });

    it("says who pays for storage when Orbit says Universe does", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { storage: { bytes: 1_200_000_000, payer: "universe" } }));
        await open();
        expect(text()).toContain("1.2 GB");
        expect(text()).toContain("Paid by Universe for now");
    });

    it("shows no Top up and nothing about a card or a gateway anywhere", async () => {
        game.getMyUsage.mockResolvedValue(
            live(
                {},
                {
                    apps: money({ availableMicros: 0, canAskForMore: true }),
                    computer: computer({
                        kind: "monthly",
                        availableMicros: 0,
                        totalMicros: 1_000_000,
                        canAskForMore: true,
                    }),
                }
            )
        );
        await open();
        expect(text()).not.toMatch(/top up|card|gateway|tap |stripe|payment/i);
    });

    it("says nothing about cents after each step: Activity lists tasks, never steps", async () => {
        game.getMyUsage.mockResolvedValue(live());
        await open();
        expect(byId("usageSecActivity")).toBeNull();
    });

    it("goes back to the Bricks", async () => {
        await open();
        const arrow = target.querySelector<HTMLElement>('[data-testid="edit-panel-back"]');
        expect(arrow?.getAttribute("aria-label")).toBe("Back to Bricks");
        arrow?.click();
        expect(back).toHaveBeenCalled();
    });
});
