import { get, writable, type Readable } from "svelte/store";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { ITEM_KINDS, sayMoment, type ItemKind } from "./BrickGoals";

/**
 * "Everything Brick did" (game #2002, mock t-5-closed): every run a Brick made by itself for its owner, newest first,
 * failed runs and quiet checks included, each with its result in a line. Nothing it did on its own is hidden. Orbit
 * keeps the runs and pages them; this reads a page at a time and puts each run into words.
 */

export type RunState = "claimed" | "done" | "failed" | "dropped";
export type RunOutcome = "quiet" | "spoke" | "waiting";

export interface DidRun {
    runId: string;
    itemId: string;
    /** What the goal or task asked for, in the person's words, so a row reads on its own. */
    words: string;
    kind: ItemKind;
    /** When it ran: the end of the run, or when it was due while it has not ended. */
    at: number;
    state: RunState;
    outcome: RunOutcome | null;
    /** The result in a line, or why it failed. */
    result: string | null;
}

const STATES: readonly RunState[] = ["claimed", "done", "failed", "dropped"];
const OUTCOMES: readonly RunOutcome[] = ["quiet", "spoke", "waiting"];

const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
const time = (value: unknown): number | null => {
    if (typeof value !== "string") return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
};

function readRun(value: unknown): DidRun | null {
    if (typeof value !== "object" || value === null) return null;
    const one = value as Record<string, unknown>;
    const runId = text(one.runId);
    const state = STATES.find((known) => known === one.state);
    const at = time(one.finishedAt) ?? time(one.dueAt);
    if (!runId || !state || at === null) return null;
    const kind = ITEM_KINDS.find((known) => known === one.kind) ?? "reminder";
    const outcome = OUTCOMES.find((known) => known === one.outcome) ?? null;
    // A failed run says why in `error`; the others say what came of it in `result`
    const result = state === "failed" ? text(one.error) ?? text(one.result) : text(one.result);
    return { runId, itemId: text(one.itemId) ?? "", words: text(one.words) ?? "", kind, at, state, outcome, result };
}

/** One page as Orbit sends it: the runs it can read, and the cursor for the next page (null at the end). */
export function parseDidPage(value: unknown): { runs: DidRun[]; next: string | null } {
    const page = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const runs = Array.isArray(page.runs) ? page.runs.flatMap((one) => readRun(one) ?? []) : [];
    return { runs, next: text(page.next) };
}

/** The line under a run: when it ran, then what came of it. */
export function sayRun(run: DidRun, now: number, ll: TranslationFunctions, locale?: string): string {
    const g = ll.chat.brick.goals;
    let what: string;
    if (run.state === "failed") what = run.result ? g.runFailedWhy({ why: run.result }) : g.runFailed();
    else if (run.state === "claimed") what = g.runRunning();
    else if (run.state === "dropped") what = run.result ?? g.runSkipped();
    else if (run.result) what = run.result;
    else if (run.outcome === "spoke") what = g.runSpoke();
    else if (run.outcome === "waiting") what = g.runWaiting();
    else what = g.runQuiet();
    return `${sayMoment(run.at, now, ll, locale)} · ${what}`;
}

export type DidState = "loading" | "ready" | "failed";

export interface BrickDidList {
    runs: Readable<DidRun[]>;
    state: Readable<DidState>;
    /** Whether Orbit has older runs than the ones shown. */
    more: Readable<boolean>;
    /** Whether the next page is being read. */
    loadingMore: Readable<boolean>;
    /** Reads the newest page. A list that shows stays while it is read again. */
    load(): Promise<void>;
    /** Reads the page after the last one shown and adds it. A failed read leaves what shows as it is and says so. */
    loadMore(): Promise<boolean>;
}

/** One Brick's runs. A read that fails says so; it never shows a list it did not read. */
export function brickDidList(brickId: string): BrickDidList {
    const runs = writable<DidRun[]>([]);
    const state = writable<DidState>("loading");
    const more = writable(false);
    const loadingMore = writable(false);
    let next: string | null = null;
    const keepNext = (cursor: string | null) => {
        next = cursor;
        more.set(cursor !== null);
    };
    // Only the latest first-page read shows, and a page asked for before it never lands after it
    let reads = 0;
    return {
        runs: { subscribe: runs.subscribe },
        state: { subscribe: state.subscribe },
        more: { subscribe: more.subscribe },
        loadingMore: { subscribe: loadingMore.subscribe },
        async load() {
            const mine = ++reads;
            if (get(state) !== "ready") state.set("loading");
            try {
                const page = parseDidPage(await botApiService.getBrickDid(brickId));
                if (mine !== reads) return;
                runs.set(page.runs);
                keepNext(page.next);
                state.set("ready");
            } catch (error) {
                console.warn("Could not read what a Brick did", error);
                if (mine === reads && get(state) !== "ready") state.set("failed");
            }
        },
        async loadMore() {
            const after = next;
            if (after === null || get(loadingMore)) return true;
            const mine = reads;
            loadingMore.set(true);
            try {
                const page = parseDidPage(await botApiService.getBrickDid(brickId, after));
                if (mine !== reads) return true;
                const seen = new Set(get(runs).map((one) => one.runId));
                runs.update((shown) => [...shown, ...page.runs.filter((one) => !seen.has(one.runId))]);
                keepNext(page.next);
                return true;
            } catch (error) {
                console.warn("Could not read more of what a Brick did", error);
                return false;
            } finally {
                loadingMore.set(false);
            }
        },
    };
}
