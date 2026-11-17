import { get, writable, type Readable } from "svelte/store";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import { botApiService } from "../../external-modules/bots/services/BotApiService";

/**
 * Goals and tasks on a Brick's page (game #2002): what a Brick keeps for its owner, in three plain parts the way a
 * person's profile has them: In progress (goals), Scheduled (reminders, briefings, watches) and Done. Orbit decides
 * which part a row sits in and what a tap does to it; this reads the list, puts each row into words, and sends the
 * tap. Nothing here holds what was said in a chat.
 */

export const ITEM_KINDS = ["reminder", "schedule", "watch", "goal"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type ItemGroup = "progress" | "scheduled" | "done";
export type ItemState = "on" | "paused" | "done";
export type StepState = "todo" | "doing" | "done";
export type GoalAsk = "unsure" | "date_passed";

/** How often one runs, as Orbit keeps it: days are 0 (Sunday) to 6 (Saturday); `time` is "HH:MM" on its own clock. */
export type ItemCadence =
    | { type: "once"; at: number }
    | { type: "daily"; time: string; days: number[] }
    | { type: "every"; minutes: number }
    | { type: "none" };

export interface GoalItem {
    id: string;
    /** The Brick that keeps it, and its name as Orbit says it (empty when Orbit gave none). */
    brickId: string;
    brickName: string;
    kind: ItemKind;
    /** What it says, in the person's words. */
    words: string;
    condition: string | null;
    outcome: string | null;
    cadence: ItemCadence;
    /** The next time it comes, in milliseconds; null when nothing is due. While one is snoozed, that is the snoozed run. */
    nextDueAt: number | null;
    /** Where the recurrence itself comes next, in milliseconds: a snooze moves one run and never this. */
    nextRegularAt: number | null;
    /** The snoozed run that is still to come (it is `nextDueAt`), or null when nothing is snoozed. */
    snoozedUntil: number | null;
    waitingFor: string | null;
    /** The one line a goal keeps up to date for its person. */
    statusLine: string | null;
    steps: { text: string; state: StepState }[];
    state: ItemState;
    group: ItemGroup;
    /** Who set it: the person, or the Brick for itself on its own idea of a plan. */
    setBy: "you" | "brick";
    result: string | null;
    doneAt: number | null;
    /** Since when it waits because the person's usage for goals and tasks is used up. */
    heldSince: number | null;
    /** The one question this goal has open for its person. */
    asking: GoalAsk | null;
    /** The clock a daily time is read on (the zone it was set in), when Orbit says one the runtime knows. */
    timeZone: string | null;
    /** For a check a goal set for itself: the goal it belongs to. It sits under Scheduled, "by" the Brick. */
    goalId: string | null;
}

const time = (value: unknown): number | null => {
    if (typeof value !== "string") return null;
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
};
const line = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

function knownZone(value: unknown): string | null {
    if (typeof value !== "string" || value === "") return null;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return value;
    } catch {
        return null;
    }
}

/** "UTC" and "Etc/UTC" are one clock. */
const sameClock = (a: string, b: string) => a.replace(/^Etc\//, "") === b.replace(/^Etc\//, "");

/** A zone by the name a person says: "Asia/Kuwait" is "Kuwait". */
const zoneName = (zone: string) =>
    zone
        .replace(/^Etc\//, "")
        .split("/")
        .pop()
        ?.replace(/_/g, " ") ?? zone;

function parseCadence(value: unknown): ItemCadence {
    const one = (value ?? {}) as Record<string, unknown>;
    if (one.type === "once") {
        const at = time(one.at);
        if (at !== null) return { type: "once", at };
    }
    if (one.type === "daily" && typeof one.time === "string" && /^\d{1,2}:\d{2}$/.test(one.time)) {
        const days = Array.isArray(one.days)
            ? [...new Set(one.days)].filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
            : [];
        if (days.length > 0) return { type: "daily", time: one.time, days: days.sort((a, b) => a - b) };
    }
    if (one.type === "every" && typeof one.minutes === "number" && one.minutes > 0) {
        return { type: "every", minutes: one.minutes };
    }
    return { type: "none" };
}

const groupOf = (state: ItemState, kind: ItemKind): ItemGroup =>
    state === "done" ? "done" : kind === "goal" ? "progress" : "scheduled";

/** The Brick a row is for: its own `brickId`, or the one the list was read for. */
interface BrickOf {
    brickId: string | null;
    brickName: string;
}

function readItem(one: unknown, goalId: string | null, of: BrickOf): GoalItem | null {
    const row = (one ?? {}) as Record<string, unknown>;
    const { id, kind, state } = row;
    const words = line(row.words);
    if (typeof id !== "string" || id === "" || words === null) return null;
    const brickId = typeof row.brickId === "string" && row.brickId !== "" ? row.brickId : of.brickId;
    if (brickId === null) return null;
    if (!(ITEM_KINDS as readonly unknown[]).includes(kind)) return null;
    if (state !== "on" && state !== "paused" && state !== "done") return null;
    const steps = Array.isArray(row.steps)
        ? row.steps.flatMap((step: unknown) => {
              const { text, state: stepState } = (step ?? {}) as Record<string, unknown>;
              const said = line(text);
              return said !== null && (stepState === "todo" || stepState === "doing" || stepState === "done")
                  ? [{ text: said, state: stepState as StepState }]
                  : [];
          })
        : [];
    return {
        id,
        brickId,
        brickName: line(row.brickName) ?? of.brickName,
        kind: kind as ItemKind,
        words,
        condition: line(row.condition),
        outcome: line(row.outcome),
        cadence: parseCadence(row.cadence),
        nextDueAt: time(row.nextDueAt),
        nextRegularAt: time(row.nextRegularAt) ?? time(row.nextDueAt),
        snoozedUntil: time(row.snoozedUntil),
        waitingFor: line(row.waitingFor),
        statusLine: line(row.statusLine),
        steps,
        state,
        // A check sits with the scheduled ones, whatever kind it is
        group: goalId !== null ? "scheduled" : groupOf(state, kind as ItemKind),
        setBy: goalId !== null || row.setBy === "brick" ? "brick" : "you",
        result: line(row.result),
        doneAt: time(row.doneAt),
        heldSince: time(row.heldSince),
        asking: row.asking === "unsure" || row.asking === "date_passed" ? row.asking : null,
        timeZone: knownZone(row.timeZone),
        goalId,
    };
}

/**
 * A list as Orbit sends it (`{ items: [...] }`); a row that is not whole is left out. The checks a goal set for itself come
 * nested under it: they are listed under Scheduled, so a person sees when the Brick looks, but only the ones still running.
 * Read for one Brick, a row is that Brick's when it does not say; read across all of them, a row that does not say is left out.
 */
export function parseGoalItems(value: unknown, forBrickId: string | null = null): GoalItem[] {
    const list = (value as { items?: unknown } | null)?.items;
    if (!Array.isArray(list)) return [];
    const items: GoalItem[] = [];
    const add = (item: GoalItem | null) => {
        if (item && !items.some((other) => other.id === item.id)) items.push(item);
    };
    for (const one of list) {
        const row = (one ?? {}) as Record<string, unknown>;
        // A check that comes on its own is a goal's own business, not a row
        if (typeof row.parentId === "string" && row.parentId !== "") continue;
        const item = readItem(one, null, { brickId: forBrickId, brickName: "" });
        if (!item) continue;
        add(item);
        // The checks of a goal that is done are done with it: none of them is listed
        if (item.kind === "goal" && item.state !== "done" && Array.isArray(row.checks)) {
            for (const check of row.checks) {
                const read = readItem(check, item.id, { brickId: item.brickId, brickName: item.brickName });
                if (read && read.state !== "done" && read.kind !== "goal") add(read);
            }
        }
    }
    return items;
}

/** The three parts of the page: Scheduled with the soonest first, Done with the latest first. */
export function groupGoalItems(items: readonly GoalItem[]): Record<ItemGroup, GoalItem[]> {
    const parts: Record<ItemGroup, GoalItem[]> = { progress: [], scheduled: [], done: [] };
    for (const item of items) parts[item.group].push(item);
    parts.done.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    // A goal's own checks first, then the rest; each the soonest first, one with nothing due (paused) after the coming ones
    parts.scheduled.sort(
        (a, b) =>
            Number(a.goalId === null) - Number(b.goalId === null) ||
            (a.nextDueAt ?? Infinity) - (b.nextDueAt ?? Infinity)
    );
    return parts;
}

const clock = (hours: number, minutes: number, locale?: string): string =>
    new Date(Date.UTC(2000, 0, 1, hours, minutes)).toLocaleTimeString(locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
    });

const dayName = (day: number, locale?: string): string =>
    // 2023-01-01 was a Sunday
    new Date(Date.UTC(2023, 0, 1 + day)).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });

/** "Daily", "Sun to Thu", "Mon to Fri" or "Mon, Wed": the days a routine runs on. */
export function sayDays(days: readonly number[], ll: TranslationFunctions, locale?: string): string {
    const sorted = [...days].sort((a, b) => a - b);
    if (sorted.length === 7) return ll.chat.brick.goals.daily();
    const run = sorted.length > 1 && sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
    if (run) {
        return ll.chat.brick.goals.daysRange({
            from: dayName(sorted[0], locale),
            to: dayName(sorted[sorted.length - 1], locale),
        });
    }
    return sorted.map((day) => dayName(day, locale)).join(", ");
}

/** The day of a moment as people say it near now: "today", "tomorrow", or "Sun 15 Nov". */
function sayDay(at: number, now: number, ll: TranslationFunctions, locale?: string): string {
    const day = (ms: number) => {
        const date = new Date(ms);
        return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    };
    const apart = Math.round((day(at) - day(now)) / 86_400_000);
    if (apart === 0) return ll.chat.brick.goals.today();
    if (apart === 1) return ll.chat.brick.goals.tomorrow();
    const date = new Date(at);
    const weekday = date.toLocaleDateString(locale, { weekday: "short" });
    const rest = date.toLocaleDateString(locale?.toLowerCase().startsWith("en") ? "en-GB" : locale, {
        day: "numeric",
        month: "short",
    });
    return `${weekday} ${rest}`;
}

const at = (ms: number, locale?: string): string =>
    new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

/** When the next one comes, as a short phrase ("tomorrow, 8:00 AM"); empty when nothing is due. */
export function sayNext(ms: number | null, now: number, ll: TranslationFunctions, locale?: string): string {
    if (ms === null) return "";
    return `${sayDay(ms, now, ll, locale)}, ${at(ms, locale)}`;
}

/** When something happened, as a short phrase that starts a line ("Today, 8:00 AM", "Sat 14 Nov, 8:00 AM"). */
export function sayMoment(ms: number, now: number, ll: TranslationFunctions, locale?: string): string {
    const when = sayNext(ms, now, ll, locale);
    return when ? when[0].toUpperCase() + when.slice(1) : "";
}

/** How often and when it runs, in a few words: "Daily, 8:00 AM", "Sun to Thu, 7:30 AM", "Sun 15 Nov, 4:00 PM", "Every 6 hours". */
export function sayWhen(
    item: GoalItem,
    now: number,
    ll: TranslationFunctions,
    locale?: string,
    viewerZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
    const when = whenWords(item, now, ll, locale, viewerZone);
    return when ? when[0].toUpperCase() + when.slice(1) : "";
}

/**
 * A snoozed run, said under the row: when the snoozed run comes and, for a repeating one, where its own schedule goes on after it
 * ("Snoozed until today, 8:10 AM · Next regular run today, 9:00 AM"). Empty when nothing is snoozed.
 */
export function saySnoozed(item: GoalItem, now: number, ll: TranslationFunctions, locale?: string): string {
    if (item.snoozedUntil === null || item.state !== "on") return "";
    const g = ll.chat.brick.goals;
    const until = g.snoozedUntil({ when: sayNext(item.snoozedUntil, now, ll, locale) });
    // A one-off has no schedule of its own after it: its row already says the new time
    if (item.cadence.type === "once" || item.nextRegularAt === null || item.nextRegularAt <= item.snoozedUntil)
        return until;
    return `${until} · ${g.nextRegular({ when: sayNext(item.nextRegularAt, now, ll, locale) })}`;
}

function whenWords(
    item: GoalItem,
    now: number,
    ll: TranslationFunctions,
    locale: string | undefined,
    viewerZone: string
): string {
    const c = item.cadence;
    switch (c.type) {
        case "once":
            return `${sayDay(c.at, now, ll, locale)}, ${at(c.at, locale)}`;
        case "daily": {
            const [h, m] = c.time.split(":").map(Number);
            // A daily time is read on the clock it was set in: when that is not the viewer's, the label names it
            const zone =
                item.timeZone !== null && !sameClock(item.timeZone, viewerZone) ? ` ${zoneName(item.timeZone)}` : "";
            return `${sayDays(c.days, ll, locale)}, ${clock(h, m, locale)}${zone}`;
        }
        case "every":
            return c.minutes % 60 === 0
                ? ll.chat.brick.goals.everyHours({ count: c.minutes / 60 })
                : ll.chat.brick.goals.everyMinutes({ count: Math.round(c.minutes) });
        default:
            return item.nextDueAt !== null ? sayNext(item.nextDueAt, now, ll, locale) : "";
    }
}

/** The line under a goal's title: what it says about itself, or that nothing is needed from the person. */
export function sayStatus(item: GoalItem, ll: TranslationFunctions): string {
    const g = ll.chat.brick.goals;
    if (item.state === "paused") return g.statusPaused();
    if (item.heldSince !== null) return g.statusHeld();
    if (item.statusLine) return item.statusLine;
    if (item.waitingFor) return g.statusWaiting({ what: item.waitingFor });
    return g.statusOnTrack();
}

/** Under a Done row: when it was done, and its result when it has one. */
export function sayDone(item: GoalItem, ll: TranslationFunctions, locale?: string): string {
    const when =
        item.doneAt !== null
            ? ll.chat.brick.goals.doneOn({
                  date: new Date(item.doneAt).toLocaleDateString(
                      locale?.toLowerCase().startsWith("en") ? "en-GB" : locale,
                      { day: "numeric", month: "short" }
                  ),
              })
            : ll.chat.brick.goals.doneRow();
    return item.result ? `${when} · ${item.result}` : when;
}

/** The words under the group's title: what is going on, or that this is optional. */
export function sayBrief(items: readonly GoalItem[], now: number, ll: TranslationFunctions, locale?: string): string {
    const g = ll.chat.brick.goals;
    if (items.length === 0) return g.briefNone();
    const parts = groupGoalItems(items);
    if (parts.progress.length > 0) {
        // A goal in hand says when the Brick looks next: the soonest of its own and its checks
        const due = items
            .filter((item) => item.state === "on" && item.nextDueAt !== null && (item.kind === "goal" || item.goalId))
            .map((item) => item.nextDueAt as number)
            .sort((a, b) => a - b)[0];
        const goals = g.briefGoals({ count: parts.progress.length });
        return due !== undefined ? `${goals} · ${g.briefNext({ when: sayNext(due, now, ll, locale) })}` : goals;
    }
    // The checks of a goal belong to it, so they are not counted again as scheduled
    const scheduled = parts.scheduled.filter((item) => item.goalId === null).length;
    const bits: string[] = [];
    if (scheduled > 0) bits.push(g.briefScheduled({ count: scheduled }));
    if (parts.done.length > 0) {
        bits.push(
            parts.done.every((item) => item.kind === "goal")
                ? g.briefGoalsDone({ count: parts.done.length })
                : g.briefDone({ count: parts.done.length })
        );
    }
    return bits.length > 0 ? bits.join(" · ") : g.briefNone();
}

export type GoalsState = "loading" | "ready" | "failed";

/** What a tap does, by the name the screens' route takes. */
export type GoalTap = "pause" | "resume" | "done" | "reopen" | "snooze" | "keep" | "run";

/**
 * How a tap ended: Orbit took it and the list is fresh, Orbit refused it, or Orbit took it but the list could not be read again.
 * Run now says more: it `started` (the row itself does not change, so the person is told), or why Orbit would not start it: one is
 * already running (`busy`), the usage for goals and tasks is used up (`no_room`), or the runs for today are (`runs_a_day`).
 */
export type GoalTapResult = "taken" | "refused" | "stale" | "started" | "busy" | "no_room" | "runs_a_day";

/** What to tell the person about a tap that did not go through (null when nothing needs saying). */
export function sayTapProblem(result: GoalTapResult, ll: TranslationFunctions): string | null {
    const g = ll.chat.brick.goals;
    switch (result) {
        case "refused":
            return g.tapFailed();
        case "stale":
            return g.tapStale();
        case "busy":
            return g.runBusy();
        case "no_room":
            return g.runNoRoom();
        case "runs_a_day":
            return g.runsADay();
        default:
            return null;
    }
}

/** Run now's own key: the same tap sent twice is one run on Orbit's side. */
const newTapKey = (): string =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const RUN_REFUSALS: Record<string, GoalTapResult> = { busy: "busy", no_room: "no_room", runs_a_day: "runs_a_day" };

export interface BrickGoalsList {
    items: Readable<GoalItem[]>;
    state: Readable<GoalsState>;
    load(): Promise<void>;
    /** Forgets what shows and drops any read still on its way: the list belongs to somebody else now. */
    reset(): void;
    /** Sends a tap. The list is read again afterwards, whatever Orbit said: it is the one that knows. */
    tap(itemId: string, action: GoalTap): Promise<GoalTapResult>;
}

/** One Brick's goals and tasks. A read that fails says so; it never shows a list it did not read. */
export function brickGoalsList(brickId: string): BrickGoalsList {
    const own = goalsList(
        async () => parseGoalItems(await botApiService.getBrickItems(brickId), brickId),
        (item, action, key) =>
            key === undefined
                ? botApiService.tapBrickItem(brickId, item.id, action)
                : botApiService.tapBrickItem(brickId, item.id, action, key)
    );
    return {
        ...own,
        async tap(itemId, action) {
            const result = await own.tap(itemId, action);
            // The row and page across all Bricks show this too: read them again once Orbit has taken the tap, even if this page was left meanwhile
            myGoalsList.load().catch((error) => console.error(error));
            return result;
        },
    };
}

/**
 * The person's goals and tasks across all their Bricks (the "Goals and tasks" row of the Bricks page, mock t-7-all): one
 * list, read once for the row and the page it opens. Each row says its Brick; a tap goes to that Brick's own route.
 */
export function allGoalsList(): BrickGoalsList {
    const list = goalsList(
        async () => parseGoalItems(await botApiService.getAllBrickItems()),
        (item, action, key) =>
            key === undefined
                ? botApiService.tapBrickItem(item.brickId, item.id, action)
                : botApiService.tapBrickItem(item.brickId, item.id, action, key)
    );
    let watching = false;
    return {
        ...list,
        async load() {
            // This list outlives the page: when the account or Orbit changes in place, it must not show the one before
            if (!watching) {
                watching = true;
                botApiService.onIdentityChange(() => {
                    list.reset();
                    list.load().catch((error) => console.error(error));
                });
            }
            await list.load();
        },
    };
}

/** The one list the Bricks page and its Goals and tasks page share. */
export const myGoalsList: BrickGoalsList = allGoalsList();

function goalsList(
    readList: () => Promise<GoalItem[]>,
    send: (item: GoalItem, action: GoalTap, key?: string) => Promise<unknown>
): BrickGoalsList {
    const items = writable<GoalItem[]>([]);
    const state = writable<GoalsState>("loading");
    // Only the latest read shows: a slow answer to an earlier one never covers a newer list
    let reads = 0;
    const read = async (quiet = false): Promise<boolean> => {
        const mine = ++reads;
        try {
            const next = await readList();
            if (mine === reads) {
                items.set(next);
                state.set("ready");
            }
            return true;
        } catch (error) {
            console.warn("Could not read goals and tasks", error);
            // After a tap, a read that fails leaves the list that shows; only a first read says it failed
            if (mine === reads && !quiet) state.set("failed");
            return false;
        }
    };
    return {
        items: { subscribe: items.subscribe },
        state: { subscribe: state.subscribe },
        reset() {
            reads++;
            items.set([]);
            state.set("loading");
        },
        async load() {
            // A list that shows stays while it is read again (the page opened from its row); one that never came says it is coming
            if (get(state) !== "ready") state.set("loading");
            await read();
        },
        async tap(itemId, action) {
            const item = get(items).find((one) => one.id === itemId);
            let taken = item !== undefined;
            let refusal: GoalTapResult = "refused";
            if (item) {
                try {
                    // Run now carries its own key (this tap), so a retry of it can never start a second run
                    await send(item, action, action === "run" ? newTapKey() : undefined);
                } catch (error) {
                    console.warn("Could not change a goal or task", error);
                    taken = false;
                    const code = (error as { code?: unknown } | null)?.code;
                    if (action === "run" && typeof code === "string") refusal = RUN_REFUSALS[code] ?? "refused";
                }
            }
            // Read again either way: if it was refused, the list shows how it really stands.
            const fresh = await read(true);
            if (!taken) return refusal;
            // Run now changes nothing on the row: Orbit took it, so it started, whatever the list refresh did (that failing is a separate, quiet problem)
            if (action === "run") return "started";
            // Orbit took it but the list on screen is the old one: the row would look as if nothing happened
            if (!fresh) return "stale";
            return "taken";
        },
    };
}
