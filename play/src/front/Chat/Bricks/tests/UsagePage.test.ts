import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getMyUsage: vi.fn<() => Promise<unknown>>(),
    askForMoreUsage: vi.fn<(category?: string) => Promise<unknown>>(),
    reportActivityProblem: vi.fn<(id: string) => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the page reads the usage on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        getMyUsage: game.getMyUsage,
        askForMoreUsage: game.askForMoreUsage,
        reportActivityProblem: game.reportActivityProblem,
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
        renewsAt: "2026-12-01T00:00:00.000Z",
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
                extra: { multiplier: 2, noLimit: false, until: "2026-12-31T12:00:00.000Z" },
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
                extra: { multiplier: null, noLimit: true, until: "2026-12-31T12:00:00.000Z" },
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

    it("shows Instant Apps and computers in dollars, with when a monthly one renews", async () => {
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
        expect(text()).toContain("Instant Apps");
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
        expect(text()).toContain("$1.20 in progress");
    });

    it("asks for more Instant Apps credit, naming the category, and shows it asked", async () => {
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
                            until: "2026-12-31T12:00:00.000Z",
                        },
                    ],
                }
            )
        );
        await open();
        expect(text()).toContain("Extra credit");
        expect(text()).toContain("$3.10 of $5 available");
        expect(text()).toContain("From Universe, for Instant Apps and computers · until 31 Dec");
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
        expect(text()).toContain("$1.39 this month · Instant Apps and computer");
        expect(text()).toContain("$0.18 this month · Instant Apps");
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
        canReport: true,
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
        expect(text()).toMatch(/Today, .+ · \$0\.06 · Instant Apps/);
        expect(text()).toMatch(/Today, .+ · Paid by BAWES Universe/);
        expect(byId("usageReceipt")).toBeNull();
        target.querySelector<HTMLElement>('[data-activity="act_1"]')?.click();
        await settle();
        const receipt = byId("usageReceipt")?.textContent?.replace(/\s+/g, " ") ?? "";
        // A label and its amount sit at the two ends of one line
        expect(receipt).toContain("Instant research, 2 searches$0.06");
        expect(receipt).toContain("Made a pageNothing");
        expect(receipt).toContain("Paid by you");
        expect(text()).toContain("One line for each task. Tap one to see what it used.");
        target.querySelector<HTMLElement>('[data-activity="act_1"]')?.click();
        await settle();
        expect(byId("usageReceipt")).toBeNull();
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

    it("says a refunded task as refunded with nothing taken, and offers no Didn't work", async () => {
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
        expect(byId("usageDidntWork")).toBeNull();
    });

    it("says a task Orbit is still checking, with no amount made up", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [task({ state: "checking", spentMicros: null })] }));
        await open();
        expect(text()).toMatch(/Today, .+ · Checking/);
    });

    it("sends Didn't work, says what it came to, and reads the usage again", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [task()] }));
        game.reportActivityProblem.mockResolvedValue({ outcome: "refunded" });
        await open({ receiptId: "act_1" });
        game.getMyUsage.mockClear();
        byId("usageDidntWork")?.click();
        await settle();
        expect(game.reportActivityProblem).toHaveBeenCalledWith("act_1");
        expect(byId("usageReported")?.textContent).toBe("Sorry about that. It's been refunded.");
        expect(byId("usageDidntWork")).toBeNull();
        expect(game.getMyUsage).toHaveBeenCalled();
    });

    it("warns, and keeps the button, when Didn't work could not be sent", async () => {
        game.getMyUsage.mockResolvedValue(live({}, { activity: [task()] }));
        game.reportActivityProblem.mockRejectedValue(new Error("down"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await open({ receiptId: "act_1" });
        byId("usageDidntWork")?.click();
        await settle();
        warn.mockRestore();
        expect(game.warn).toHaveBeenCalledWith("Couldn't send that. Try again.");
        expect(byId("usageDidntWork")).not.toBeNull();
        expect(byId("usageReported")).toBeNull();
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
