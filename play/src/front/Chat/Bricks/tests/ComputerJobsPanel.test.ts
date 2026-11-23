import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The job controls as the person sees them (computers plan, piece 7; steering mock approved 23 Nov): the bar opens every job, each
 * row has its own buttons, a job opens its Activity, Stop and Cancel ask first, and a paused job shows Resume on the bar. Orbit is
 * a stand-in that answers the way the agreed contract says.
 */
const game = vi.hoisted(() => ({
    getBrickComputer: vi.fn<(brickId: string) => Promise<unknown>>(),
    brickComputerAction: vi.fn<(brickId: string, action: string) => Promise<unknown>>(),
    dismissBrickComputerNotice: vi.fn<(brickId: string, jobId: string) => Promise<unknown>>(),
    brickComputerJobAction:
        vi.fn<
            (brickId: string, jobId: string, action: string, options?: { pauseRunning?: boolean }) => Promise<unknown>
        >(),
    noteToBrickComputerJob: vi.fn<(brickId: string, jobId: string, text: string) => Promise<unknown>>(),
    getBrickComputerJobActivity: vi.fn<(brickId: string, jobId: string) => Promise<unknown>>(),
    screenTicketForBrick: vi.fn<(brickId: string, mode: string) => Promise<unknown>>(),
    screenSocketUrl: vi.fn<(ticket: string) => string | null>(),
    warn: vi.fn<(message: string) => void>(),
}));
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: game }));
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));
// The sheets that are open: each is destroyed at teardown (removing the host alone would leave its component, and its read of the computer, running into the next test)
const modals = vi.hoisted(() => new Set<{ $destroy: () => void }>());
vi.mock("svelte-modals", () => ({
    closeModal: vi.fn(),
    openModal: (
        component: new (options: { target: HTMLElement; props: Record<string, unknown> }) => { $destroy: () => void },
        props: Record<string, unknown> = {}
    ) => {
        const host = document.createElement("div");
        host.dataset.modal = "true";
        document.body.appendChild(host);
        const made = new component({
            target: host,
            props: {
                ...props,
                isOpen: true,
                close: () => {
                    modals.delete(made);
                    made.$destroy();
                    host.remove();
                },
            },
        });
        modals.add(made);
    },
}));
/** Destroys every sheet still open, then clears what is left of their hosts. */
const closeAllModals = () => {
    modals.forEach((modal) => modal.$destroy());
    modals.clear();
    document.querySelectorAll("[data-modal]").forEach((modal) => modal.remove());
};

import { get } from "svelte/store";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import BrickComputerBar from "../Computer/BrickComputerBar.svelte";
import ComputerGroup from "../Computer/ComputerGroup.svelte";
import ComputerJobsSheet from "../Computer/ComputerJobsSheet.svelte";
import { loadBrickComputer } from "../Computer/BrickComputerStore";
import { brickScreenStore, closeBrickScreen } from "../Computer/BrickScreenStore";

const BRICK = "1c8d2e3f-2222-4333-8444-a55566667777";
const brick = {
    id: BRICK,
    name: "Brick",
    description: "",
    characterTextureId: "brick-orange",
    enabled: true,
    isDefault: true,
    createdAt: "2026-11-11T10:00:00.000Z",
    hello: null,
};
const computer = (over: Record<string, unknown> = {}) => ({
    computer: {
        available: true,
        on: true,
        machine: "working",
        job: null,
        queued: [],
        month: { leftFraction: 0.8, unlimited: false, endsAt: "2026-12-01T00:00:00.000Z" },
        files: { bytes: 0, savedAt: null },
        ...over,
    },
});
const taxi = { id: "taxi", title: "Airport taxi", status: "running", control: "brick", stepLabel: null };
const visaBack = { id: "visa", title: "Visa form", status: "queued", queuedFor: "turn", pausedBefore: true };
const hotel = { id: "hotel", title: "Hotel booking form", status: "queued", queuedFor: "turn" };
const visaPaused = {
    id: "visa",
    title: "Visa form",
    status: "queued",
    queuedFor: "paused",
    pausedAt: "2026-11-23T07:13:00.000Z",
    pausedWhy: "person",
    pausedBefore: true,
};
// The mock's first sheet: the taxi runs, the visa carries on next by itself, the hotel waits its turn
const three = computer({ job: taxi, queued: [visaBack, hotel] });

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
}

describe("the job controls on a Brick's computer", () => {
    let target: HTMLElement;
    let piece: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        piece?.$destroy();
        piece = undefined;
        target.remove();
        closeAllModals();
    });

    const one = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const sheet = () => document.querySelector<HTMLElement>("[data-modal]");
    const inSheet = (id: string) => document.querySelector<HTMLElement>(`[data-modal] [data-testid="${id}"]`);
    const row = (jobId: string) =>
        document.querySelector<HTMLElement>(`[data-modal] [data-testid="computerJob-${jobId}"]`);
    const inRow = (jobId: string, id: string) => row(jobId)?.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const words = (element: HTMLElement | null | undefined) => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

    async function showBar(read: unknown) {
        game.getBrickComputer.mockResolvedValue(read);
        await loadBrickComputer(BRICK);
        piece = new BrickComputerBar({ target, props: { brick } });
        await settle();
    }
    async function openJobs(read: unknown) {
        await showBar(read);
        one("brickComputerBarOpen")?.click();
        await settle();
    }

    it("names the job that comes back next on the bar", async () => {
        await showBar(three);
        expect(words(one("brickComputerBar"))).toContain("Airport taxi · getting it ready · Visa form next");
    });

    it("opens every job from the bar, each row with the buttons of the mock", async () => {
        await openJobs(three);
        expect(words(sheet())).toContain("One job uses it at a time. You can also just tell Brick in the chat.");
        expect(words(row("taxi"))).toContain("Working · getting it ready");
        expect(inRow("taxi", "computerJobPause")).not.toBeNull();
        expect(inRow("taxi", "computerJobWatch")).not.toBeNull();
        expect(inRow("taxi", "computerJobCancel")).toBeNull();
        expect(words(row("visa"))).toContain("Paused · carries on next, by itself");
        expect(inRow("visa", "computerJobCancel")).not.toBeNull();
        expect(inRow("visa", "computerJobFirst")).toBeNull();
        expect(words(row("hotel"))).toContain("Waiting its turn");
        expect(inRow("hotel", "computerJobCancel")).not.toBeNull();
        expect(words(inRow("hotel", "computerJobFirst"))).toBe("Do this next");
    });

    it("pauses the working job from its row, and shows the paused job with Resume and Cancel", async () => {
        await openJobs(computer({ job: { ...taxi, id: "visa", title: "Visa form" } }));
        game.brickComputerJobAction.mockResolvedValue(computer({ machine: "resting", queued: [visaPaused] }));
        inRow("visa", "computerJobPause")?.click();
        await settle();
        expect(game.brickComputerJobAction).toHaveBeenCalledWith(BRICK, "visa", "pause", { commandId: expect.any(String) });
        expect(words(row("visa"))).toContain("Paused · progress kept · not using computer time");
        expect(inRow("visa", "computerJobResume")).not.toBeNull();
        expect(inRow("visa", "computerJobCancel")).not.toBeNull();
        // The bar says it and offers Resume instead of Watch
        expect(words(one("brickComputerBar"))).toContain("Visa form · paused");
        expect(one("brickComputerBarResume")).not.toBeNull();
        expect(one("brickComputerBarWatch")).toBeNull();
    });

    it("resumes a paused job from the bar", async () => {
        await showBar(computer({ machine: "resting", queued: [visaPaused] }));
        game.brickComputerJobAction.mockResolvedValue(computer({ job: { ...taxi, id: "visa", title: "Visa form" } }));
        one("brickComputerBarResume")?.click();
        await settle();
        expect(game.brickComputerJobAction).toHaveBeenCalledWith(BRICK, "visa", "resume", { commandId: expect.any(String) });
        expect(one("brickComputerBarResume")).toBeNull();
        expect(words(one("brickComputerBar"))).toContain("Visa form");
    });

    it("says why a Resume could not carry on yet, and the job stays paused", async () => {
        await showBar(computer({ machine: "resting", queued: [{ ...visaPaused, pausedWhy: "allowance" }] }));
        expect(words(one("brickComputerBar"))).toContain("Visa form · paused · this month's computer time is used up");
        game.brickComputerJobAction.mockRejectedValue(
            Object.assign(new Error("no"), { status: 409, reason: "allowance" })
        );
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        one("brickComputerBarResume")?.click();
        await settle();
        warn.mockRestore();
        expect(game.warn).toHaveBeenCalledWith(
            "This month's computer time is used up, so it stays paused. Tap Ask for more in Usage."
        );
        expect(one("brickComputerBarResume")).not.toBeNull();
    });

    it("moves a waiting job first with Do this next, without pausing what runs", async () => {
        await openJobs(three);
        game.brickComputerJobAction.mockResolvedValue(computer({ job: taxi, queued: [hotel, visaBack] }));
        inRow("hotel", "computerJobFirst")?.click();
        await settle();
        expect(game.brickComputerJobAction).toHaveBeenCalledWith(BRICK, "hotel", "first", { commandId: expect.any(String) });
        expect(words(row("hotel"))).toContain("Next in line");
        expect(inRow("hotel", "computerJobFirst")).toBeNull();
    });

    it("cancels a job that never started at once, and only that one", async () => {
        await openJobs(three);
        game.brickComputerJobAction.mockResolvedValue(computer({ job: taxi, queued: [visaBack] }));
        inRow("hotel", "computerJobCancel")?.click();
        await settle();
        expect(inSheet("computerEndAsk")).toBeNull();
        expect(game.brickComputerJobAction).toHaveBeenCalledWith(BRICK, "hotel", "cancel", { commandId: expect.any(String) });
        // Back to the jobs: the other two carry on
        expect(row("hotel")).toBeNull();
        expect(row("taxi")).not.toBeNull();
        expect(row("visa")).not.toBeNull();
    });

    it("names a job that has run back before cancelling it, and keeps it when the person changes their mind", async () => {
        await openJobs(three);
        inRow("visa", "computerJobCancel")?.click();
        await settle();
        expect(game.brickComputerJobAction).not.toHaveBeenCalled();
        expect(words(inSheet("computerEndAsk"))).toContain("Cancel “Visa form”?");
        expect(words(inSheet("computerEndAsk"))).toContain("It ends here and its files are kept.");
        inSheet("computerEndAskKeep")?.click();
        await settle();
        expect(game.brickComputerJobAction).not.toHaveBeenCalled();
        expect(row("visa")).not.toBeNull();
        inRow("visa", "computerJobCancel")?.click();
        await settle();
        game.brickComputerJobAction.mockResolvedValue(computer({ job: taxi, queued: [hotel] }));
        inSheet("computerEndAskEnd")?.click();
        await settle();
        expect(game.brickComputerJobAction).toHaveBeenCalledWith(BRICK, "visa", "cancel", { commandId: expect.any(String) });
        expect(row("visa")).toBeNull();
    });

    it("asks before Stop ends several jobs, naming each, and stops them all only on Stop all", async () => {
        await showBar(computer({ job: taxi, queued: [hotel, visaPaused] }));
        one("brickComputerBarStop")?.click();
        await settle();
        const asked = words(inSheet("computerEndAsk"));
        expect(asked).toContain("Stop all 3 jobs?");
        expect(asked).toContain("Airport taxi stops now.");
        expect(asked).toContain("Hotel booking form (waiting) ends too.");
        expect(asked).toContain("Visa form (paused) ends too.");
        expect(asked).toContain("To end just one, tap the bar and Cancel it there, or tell Brick.");
        inSheet("computerEndAskKeep")?.click();
        await settle();
        expect(game.brickComputerAction).not.toHaveBeenCalled();
        expect(sheet()).toBeNull();
        one("brickComputerBarStop")?.click();
        await settle();
        game.brickComputerAction.mockResolvedValue(computer({ machine: "resting" }));
        expect(words(inSheet("computerEndAskEnd"))).toBe("Stop all 3");
        inSheet("computerEndAskEnd")?.click();
        await settle();
        expect(game.brickComputerAction).toHaveBeenCalledWith(BRICK, "stop", undefined, expect.any(String));
        expect(sheet()).toBeNull();
    });

    it("ends a single job at once on Stop, with no question", async () => {
        await showBar(computer({ job: taxi }));
        game.brickComputerAction.mockResolvedValue(computer({ machine: "resting" }));
        one("brickComputerBarStop")?.click();
        await settle();
        expect(sheet()).toBeNull();
        expect(game.brickComputerAction).toHaveBeenCalledWith(BRICK, "stop", undefined, expect.any(String));
        expect(one("brickComputerBar")).toBeNull();
    });

    it("CodeRabbit: Stop on the bar is off while its request is on its way, so a second tap sends no second Stop", async () => {
        await showBar(computer({ job: taxi }));
        let answer!: (value: unknown) => void;
        game.brickComputerAction.mockImplementationOnce(() => new Promise((resolve) => {
            answer = resolve;
        }));
        one("brickComputerBarStop")?.click();
        await settle();
        expect((one("brickComputerBarStop") as HTMLButtonElement | null)?.disabled).toBe(true);
        one("brickComputerBarStop")?.click();
        await settle();
        expect(game.brickComputerAction).toHaveBeenCalledTimes(1);
        // Orbit refuses (the job still runs): the button is on again once the request is over
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        answer(Promise.reject(new Error("nope")));
        await settle();
        warn.mockRestore();
        expect((one("brickComputerBarStop") as HTMLButtonElement | null)?.disabled).toBe(false);
    });

    it("CodeRabbit: Watch from the jobs sheet opens the computer screen and closes the sheet (it would sit above the screen)", async () => {
        await openJobs(computer({ job: taxi }));
        expect(sheet()).not.toBeNull();
        inRow("taxi", "computerJobWatch")?.click();
        await settle();
        expect(get(brickScreenStore)?.id).toBe(BRICK);
        expect(sheet()).toBeNull();
        closeBrickScreen();
    });

    it("CodeRabbit: a jobs sheet that is not the open modal never closes on its own when its last job goes (the close would take the modal above it away)", async () => {
        game.getBrickComputer.mockResolvedValue(computer({ machine: "resting", job: null }));
        await loadBrickComputer(BRICK);
        const close = vi.fn();
        const hidden = new ComputerJobsSheet({ target, props: { brick, isOpen: false, close } });
        await settle();
        expect(close).not.toHaveBeenCalled();
        // once it is the open one again, it closes
        hidden.$set({ isOpen: true });
        await settle();
        expect(close).toHaveBeenCalledTimes(1);
        hidden.$destroy();
    });

    it("offers no Pause on the row while the person holds the screen", async () => {
        await openJobs(computer({ job: { ...taxi, status: "waiting", waitingFor: "signin", control: "person" } }));
        expect(inRow("taxi", "computerJobPause")).toBeNull();
        expect(words(row("taxi"))).toContain("Waiting for you · your sign-in");
    });

    it("says hand it back first when Orbit finds the person took the screen meanwhile", async () => {
        await openJobs(computer({ job: taxi }));
        game.brickComputerJobAction.mockRejectedValue(
            Object.assign(new Error("no"), { status: 409, reason: "taken_over" })
        );
        game.getBrickComputer.mockResolvedValue(computer({ job: { ...taxi, control: "person" } }));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        inRow("taxi", "computerJobPause")?.click();
        await settle();
        warn.mockRestore();
        expect(game.warn).toHaveBeenCalledWith("You have the screen right now. Hand it back first.");
        expect(inRow("taxi", "computerJobPause")).toBeNull();
    });

    it("opens a job's Activity: its steps with their times, the person's messages, and where it paused", async () => {
        game.getBrickComputerJobActivity.mockResolvedValue({
            steps: [
                { seq: 1, label: "Opened the visa site", at: "2026-11-23T07:02:00.000Z", detail: "evisa.gov.kw" },
                { seq: 2, label: "Your message: business visa", at: "2026-11-23T07:06:00.000Z", kind: "note" },
                { seq: 3, label: "Paused by you", at: "2026-11-23T07:13:00.000Z", kind: "pause" },
            ],
        });
        await openJobs(computer({ machine: "resting", queued: [visaPaused] }));
        row("visa")?.querySelector<HTMLElement>('[data-testid="computerJobOpen"]')?.click();
        await settle();
        const activity = words(inSheet("computerJobActivity"));
        expect(game.getBrickComputerJobActivity).toHaveBeenCalledWith(BRICK, "visa");
        expect(activity).toContain("Visa form");
        expect(activity).toContain("Paused · progress kept · not using computer time");
        expect(activity).toContain("Opened the visa site");
        expect(activity).toContain("evisa.gov.kw");
        expect(activity).toContain("Your message: business visa");
        expect(activity).toContain("Paused by you");
        expect(activity).not.toMatch(/\$|credits|\d+ ?%/);
        expect(inSheet("computerJobResume")).not.toBeNull();
        expect(inSheet("computerJobCancel")).not.toBeNull();
        inSheet("computerJobActivityBack")?.click();
        await settle();
        expect(row("visa")).not.toBeNull();
    });

    it("says when a job has done nothing yet", async () => {
        game.getBrickComputerJobActivity.mockResolvedValueOnce({ steps: [] });
        await openJobs(computer({ job: { ...taxi, id: "fresh" } }));
        row("fresh")?.querySelector<HTMLElement>('[data-testid="computerJobOpen"]')?.click();
        await settle();
        expect(words(inSheet("computerJobActivityNone"))).toContain("Nothing done yet.");
    });

    it("says when a job's Activity could not be read, and Try again reads it", async () => {
        game.getBrickComputerJobActivity.mockRejectedValueOnce(new Error("offline"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await openJobs(computer({ machine: "resting", queued: [{ ...hotel, id: "unread" }] }));
        row("unread")?.querySelector<HTMLElement>('[data-testid="computerJobOpen"]')?.click();
        await settle();
        warn.mockRestore();
        expect(words(inSheet("computerJobActivity"))).toContain("What it has done couldn't be read just now.");
        game.getBrickComputerJobActivity.mockResolvedValueOnce({ steps: [{ seq: 1, label: "Opened the hotel site" }] });
        inSheet("computerJobActivityRetry")?.click();
        await settle();
        expect(words(inSheet("computerJobActivity"))).toContain("Opened the hotel site");
    });

    it("lists the jobs in line and the paused ones on the computer page, each with its buttons", async () => {
        game.getBrickComputer.mockResolvedValue(three);
        await loadBrickComputer(BRICK);
        piece = new ComputerGroup({ target, props: { brick, open: true, onToggle: () => undefined } });
        await settle();
        const rows = target.querySelector<HTMLElement>('[data-testid="computerJobRows"]');
        expect(words(rows)).toContain("Visa form");
        expect(words(rows)).toContain("Hotel booking form");
        // The working job is the card above, with Stop and Watch, not a second row
        expect(rows?.querySelector('[data-testid="computerJob-taxi"]')).toBeNull();
        const cancelOn = (jobId: string) =>
            rows?.querySelector<HTMLElement>(`[data-testid="computerJob-${jobId}"] [data-testid="computerJobCancel"]`);
        // The visa ran before: named back first
        cancelOn("visa")?.click();
        await settle();
        expect(words(inSheet("computerEndAsk"))).toContain("Cancel “Visa form”?");
        closeAllModals();
        // The hotel never started: it goes at once
        game.brickComputerJobAction.mockResolvedValue(computer({ job: taxi, queued: [visaBack] }));
        cancelOn("hotel")?.click();
        await settle();
        expect(game.brickComputerJobAction).toHaveBeenCalledWith(BRICK, "hotel", "cancel", { commandId: expect.any(String) });
        expect(sheet()).toBeNull();
    });
});
