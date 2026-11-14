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
