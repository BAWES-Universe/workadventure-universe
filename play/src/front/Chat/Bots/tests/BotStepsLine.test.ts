import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { readable } from "svelte/store";

vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount, onDestroy } = await import("svelte/internal");
    return { ...svelte, onMount, onDestroy };
});
vi.mock("../../../../i18n/i18n-svelte", () => {
    const deep = (): unknown => new Proxy(() => "", { get: () => deep() });
    return { LL: readable(deep()), default: readable(deep()) };
});

import BotStepsLine from "../BotStepsLine.svelte";
import type { BotStep, BotSteps } from "../BotSteps";

/** What the bot server sends when it asked which thing to forget: it is shown as what it did, not as a failure to hide. */
const nothingYet: BotStep = {
    doing: "Forgetting",
    done: "Forgot nothing yet",
    note: "Asked which one. Nothing forgotten yet",
    state: "failed",
    again: false,
};
const read: BotStep = { doing: "Reading", done: "Read a page", state: "done", again: false };

describe("the steps line of a reply that forgot nothing yet (#2003)", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    function mount(steps: BotSteps) {
        component = new BotStepsLine({ target, props: { steps: readable<BotSteps | undefined>(steps) } });
    }

    it("shows 'Forgot nothing yet' and why, as the one call of a finished reply", () => {
        mount({ state: "done", line: "Forgot nothing yet", startedAt: 0, steps: [nothingYet] });
        const row = target.querySelector('[data-testid="botStepsSingle"]');
        expect(row?.textContent).toContain("Forgot nothing yet");
        expect(row?.textContent).toContain("Asked which one. Nothing forgotten yet");
    });

    it("lists it among the finished calls while the bot still works", () => {
        mount({
            state: "working",
            line: "Reading a page",
            startedAt: 0,
            steps: [nothingYet, { ...read, state: "running" }],
        });
        const item = target.querySelector('[data-testid="botStepsEnded"] [data-testid="botStepItem"]');
        expect(item?.textContent).toContain("Forgot nothing yet");
        expect(item?.textContent).toContain("Asked which one. Nothing forgotten yet");
    });

    it("lists it in the opened summary of a reply with several calls", async () => {
        mount({ state: "done", line: "Did 2 things", startedAt: 0, steps: [read, nothingYet] });
        target.querySelector<HTMLButtonElement>('[data-testid="botStepsSummary"]')!.click();
        await tick();
        const items = [...target.querySelectorAll('[data-testid="botStepsList"] [data-testid="botStepItem"]')];
        expect(items).toHaveLength(2);
        expect(items[1].textContent).toContain("Forgot nothing yet");
        expect(items[1].textContent).toContain("Asked which one. Nothing forgotten yet");
    });
});

describe("the steps line: waiting, times and what a step did (#2061)", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    function mount(steps: BotSteps) {
        component = new BotStepsLine({ target, props: { steps: readable<BotSteps | undefined>(steps) } });
    }
    const waiting: BotStep = {
        doing: "Updating",
        done: "Used Update a draft",
        note: "Waiting for your OK. Nothing ran yet",
        state: "waiting",
        again: false,
    };

    it("shows a step that waits for an OK with its note, and no failure mark", async () => {
        mount({ state: "done", line: "Used Get a draft", startedAt: 0, steps: [{ ...read, secs: 1 }, waiting] });
        expect(target.querySelector(".bot-steps-icon.bad")).toBeNull();
        expect(target.querySelector(".bad")).toBeNull();
        // The folded line shows the waiting clock, not a check or a cross
        expect(target.querySelector('[data-testid="botStepsSummary"] svg')).not.toBeNull();
        target.querySelector<HTMLButtonElement>('[data-testid="botStepsSummary"]')!.click();
        await tick();
        const items = [...target.querySelectorAll('[data-testid="botStepItem"]')];
        expect(items).toHaveLength(2);
        expect(items[1].textContent).toContain("Waiting for your OK. Nothing ran yet");
        expect(items[1].querySelector('[data-testid="botStepSecs"]')).toBeNull();
        expect(target.querySelector(".bad")).toBeNull();
    });

    it("keeps a lone finished step openable, so what it sent stays reachable", async () => {
        mount({
            state: "done",
            line: "Used Update a draft",
            startedAt: 0,
            steps: [{ ...read, secs: 2, shows: [{ label: "Subject", text: "Review draft" }] }],
        });
        expect(target.querySelector('[data-testid="botStepsSingleOpen"]')).not.toBeNull();
        target.querySelector<HTMLButtonElement>('[data-testid="botStepOpen"]')!.click();
        await tick();
        expect(target.querySelector('[data-testid="botStepShows"]')?.textContent).toContain("Review draft");
    });

    it("keeps a lone step that sent something openable when the reply was stopped, and still says it was stopped", async () => {
        mount({
            state: "stopped",
            line: "Used Update a draft",
            startedAt: 0,
            steps: [{ ...read, secs: 2, shows: [{ label: "Subject", text: "Review draft" }] }],
        });
        expect(target.querySelector('[data-testid="botStepsSingleOpen"]')).not.toBeNull();
        expect(target.querySelector('[data-testid="botStepsSingle"]')).toBeNull();
        expect(target.querySelector('[data-testid="botStepsStopped"]')).not.toBeNull();
        target.querySelector<HTMLButtonElement>('[data-testid="botStepOpen"]')!.click();
        await tick();
        expect(target.querySelector('[data-testid="botStepShows"]')?.textContent).toContain("Review draft");
    });

    it("shows the total time on the folded line and each step's time once opened", async () => {
        mount({
            state: "done",
            line: "Did 2 things",
            startedAt: 0,
            took: 9,
            steps: [
                { ...read, secs: 1.3 },
                { ...read, secs: 42 },
            ],
        });
        expect(target.querySelector('[data-testid="botStepsSummary"]')?.textContent).toContain("9s");
        target.querySelector<HTMLButtonElement>('[data-testid="botStepsSummary"]')!.click();
        await tick();
        const times = [...target.querySelectorAll('[data-testid="botStepSecs"]')].map((el) => el.textContent?.trim());
        expect(times).toEqual(["1.3s", "42s"]);
    });

    it("opens a step that has lines in place, and a step with none has nothing to open", async () => {
        mount({
            state: "done",
            line: "Did 2 things",
            startedAt: 0,
            steps: [{ ...read, shows: [{ label: "To", text: "a@b.co" }, { text: "Draft updated" }] }, read],
        });
        target.querySelector<HTMLButtonElement>('[data-testid="botStepsSummary"]')!.click();
        await tick();
        expect(target.querySelectorAll('[data-testid="botStepOpen"]')).toHaveLength(1);
        expect(target.querySelector('[data-testid="botStepShows"]')).toBeNull();
        target.querySelector<HTMLButtonElement>('[data-testid="botStepOpen"]')!.click();
        await tick();
        const shows = target.querySelector('[data-testid="botStepShows"]')?.textContent?.replace(/\s+/g, " ") ?? "";
        expect(shows).toContain("To a@b.co");
        expect(shows).toContain("Draft updated");
    });
});

describe("a steps line still working over an hour after it began (game #2131)", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    function mount(steps: BotSteps) {
        component = new BotStepsLine({ target, props: { steps: readable<BotSteps | undefined>(steps) } });
    }
    const hoursAgo = (hours: number) => Date.now() - hours * 3_600_000;

    it("shows a lone finished step as stopped: its tick, no spinner, no clock, and no red", () => {
        mount({
            state: "working",
            line: "Writing the answer",
            startedAt: hoursAgo(15),
            steps: [
                { doing: "Connecting Google Calendar", done: "Connected Google Calendar", state: "done", again: false },
            ],
        });
        expect(target.querySelector('[data-testid="botStepsLive"]')).toBeNull();
        expect(target.querySelector(".bot-steps-spin")).toBeNull();
        const row = target.querySelector('[data-testid="botStepsSingle"]');
        expect(row?.textContent).toContain("Connected Google Calendar");
        expect(target.querySelector(".bad")).toBeNull();
        expect(target.querySelector(".bot-steps-icon.bad")).toBeNull();
    });

    it("shows a step that never finished with the neutral minus, in a grey header", () => {
        mount({
            state: "working",
            line: "Using Fetch emails",
            startedAt: hoursAgo(2),
            steps: [
                { doing: "Connecting", done: "Connected Gmail", state: "done", again: false },
                { doing: "Using Fetch emails", done: "Used Fetch emails", state: "running", again: false },
            ],
        });
        expect(target.querySelector('[data-testid="botStepsLive"]')).toBeNull();
        expect(target.querySelector('[data-testid="botStepsSummary"]')).not.toBeNull();
        expect(target.querySelector(".bad")).toBeNull();
        expect(target.querySelector(".bot-steps-icon.bad")).toBeNull();
    });

    it("keeps a line that began minutes ago working", () => {
        mount({
            state: "working",
            line: "Using Fetch emails",
            startedAt: Date.now() - 5 * 60_000,
            steps: [{ doing: "Using Fetch emails", done: "Used Fetch emails", state: "running", again: false }],
        });
        expect(target.querySelector('[data-testid="botStepsLive"]')).not.toBeNull();
    });

    it("still shows a reply that failed part-way in the game's coral", () => {
        mount({
            state: "stopped",
            line: "Connected Gmail",
            startedAt: hoursAgo(0.1),
            steps: [read, { ...read, state: "failed" }],
        });
        expect(target.querySelector(".bad")).not.toBeNull();
    });
});
