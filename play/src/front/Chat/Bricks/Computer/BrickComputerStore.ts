import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../../external-modules/bots/services/BotApiService";
import {
    parseBrickComputer,
    parseJobActivity,
    parseJobAnswer,
    holdsComputer,
    inLine,
    type BrickComputerView,
    type ComputerStep,
    type JobControl,
} from "./BrickComputer";

/**
 * Each Brick's computer as its owner sees it (game #2000), read from Orbit. Reading never makes or wakes anything. A Brick
 * with nothing read yet has no entry: what shows it then says nothing rather than guess.
 */
const computers = writable<Map<string, BrickComputerView>>(new Map());
export const brickComputers: Readable<Map<string, BrickComputerView>> = { subscribe: computers.subscribe };

/** How often what is shown is read again while a job runs, waits or is in line. */
const POLL_MS = 4000;

/**
 * Answers can come back in a different order than they were asked for: a read that was on its way when the owner tapped Stop
 * can arrive after Stop's answer. Each ask takes a number when it is sent, and an answer older than the one on screen is dropped.
 */
const asked = new Map<string, number>();
const onScreen = new Map<string, number>();
const ticket = (brickId: string): number => {
    const next = (asked.get(brickId) ?? 0) + 1;
    asked.set(brickId, next);
    return next;
};

/**
 * One control's own id, made at the tap (GPT's sixth answer, finding 4): it goes with the request, so the same request sent again does the control once. In the shape Orbit takes
 * (letters, digits, `_` and `-`), with a plain fallback where the browser has no uuid of its own.
 */
export const newCommandId = (): string =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const put = (brickId: string, view: BrickComputerView, sentAs: number) => {
    if (sentAs < (onScreen.get(brickId) ?? 0)) return;
    onScreen.set(brickId, sentAs);
    computers.update((all) => {
        const next = new Map(all);
        next.set(brickId, view);
        return next;
    });
};

/** Reads one Brick's computer again. Resolves to what Orbit said, or undefined when it could not be read. */
export async function loadBrickComputer(brickId: string): Promise<BrickComputerView | undefined> {
    const sentAs = ticket(brickId);
    try {
        const view = parseBrickComputer(await botApiService.getBrickComputer(brickId));
        if (view) put(brickId, view, sentAs);
        return view;
    } catch (error) {
        console.warn("Could not read a Brick's computer", error);
        return undefined;
    }
}

export type ComputerAction = "give" | "turn-off" | "stop" | "take-over" | "hand-back" | "fill-details";

/**
 * One of the owner's calls. Orbit answers with the computer (give, turn off, stop) or with the job (take over, hand back, the
 * one tap): either way the computer is read again so the page and the bar agree. True when Orbit accepted it.
 */
export async function brickComputerAction(
    brickId: string,
    action: ComputerAction,
    shown?: { what: string; where: string },
    /** With "stop": the jobs the person saw when they tapped. Orbit ends only those (GPT's seventh note D2); a stop that names none is never sent. */
    confirmedJobIds?: string[]
): Promise<boolean> {
    if (action === "stop" && !(confirmedJobIds && confirmedJobIds.length > 0)) {
        // A bare stop would end whatever is live when it lands, a job that began after the tap included: nothing is sent, and the page is read again
        console.warn("A Stop that named no jobs was not sent");
        await loadBrickComputer(brickId);
        return false;
    }
    const sentAs = ticket(brickId);
    try {
        const answer = shown
            ? await botApiService.brickComputerAction(brickId, action, shown)
            : // Stop ends the jobs the person saw, so the tap carries its own id: a request sent again under it (a renewed sign-in) ends them once (finding 4)
            action === "stop"
            ? await botApiService.brickComputerAction(brickId, action, undefined, newCommandId(), [
                  ...(confirmedJobIds ?? []),
              ])
            : await botApiService.brickComputerAction(brickId, action);
        const view = parseBrickComputer(answer);
        if (view) put(brickId, view, sentAs);
        else if (parseJobAnswer(answer)) await loadBrickComputer(brickId);
        else return false;
        // Jobs Orbit LEFT (they began after the tap) are still running: the computer is read again so they show as they are
        const left = (answer as { left?: unknown } | null)?.left;
        if (action === "stop" && Array.isArray(left) && left.length > 0) await loadBrickComputer(brickId);
        return true;
    } catch (error) {
        console.warn(`Could not ${action} a Brick's computer`, error);
        // A refusal (nothing waits for the person any more) means the page was old: read it again
        await loadBrickComputer(brickId);
        return false;
    }
}

/** "Dismiss" on the notice of how a job ended: Orbit forgets that ending, so neither the page nor the chat says it again. True when it did. */
export async function dismissComputerNotice(brickId: string, jobId: string): Promise<boolean> {
    const sentAs = ticket(brickId);
    try {
        const view = parseBrickComputer(await botApiService.dismissBrickComputerNotice(brickId, jobId));
        if (!view) return false;
        put(brickId, view, sentAs);
        return true;
    } catch (error) {
        console.warn("Could not dismiss a Brick's computer notice", error);
        await loadBrickComputer(brickId);
        return false;
    }
}

/**
 * Why Orbit refused a call on one job, in the words the panel needs:
 * - taken-over: the person has the screen; Brick can't be paused until they hand it back.
 * - ending: the job is already ending (it finished, or a stop is on its way); the ending stands.
 * - gone: the job is no longer this Brick's to change (it ended, or it was never there).
 * - changed: the job moved on since the page was drawn (already resumed, already started); the page is read again.
 * - out-of-time: Resume while this month's computer time is still used up; the job stays paused (the panel offers Ask for more).
 * - over-limit: Resume while a spending limit the person set is still reached; the job stays paused.
 * - failed: Orbit could not be reached or said something else.
 */
export type JobRefusal =
    | "taken-over"
    | "ending"
    | "gone"
    | "changed"
    | "out-of-time"
    | "over-limit"
    | "failed"
    | "started";
export type JobCallResult = { ok: true } | { ok: false; why: JobRefusal };

function refusalOf(error: unknown): JobRefusal {
    const refused = error as { status?: number; reason?: string } | null;
    if (!refused || typeof refused !== "object") return "failed";
    if (refused.status === 404) return "gone";
    if (refused.status !== 409) return "failed";
    if (refused.reason === "taken_over") return "taken-over";
    if (refused.reason === "ending") return "ending";
    if (refused.reason === "over") return "gone";
    if (refused.reason === "allowance") return "out-of-time";
    if (refused.reason === "rule") return "over-limit";
    return "changed";
}

/** Orbit's answer to a Cancel that expected a job that had not started: it had started, and nothing was cancelled. */
const isStartedAnswer = (answer: unknown): boolean => {
    const refused = answer as { ok?: unknown; reason?: unknown } | null;
    return !!refused && typeof refused === "object" && refused.ok === false && refused.reason === "started";
};

/** The jobs with a call on its way, per Brick, so their row can show it and a second tap waits for the first. */
const pending = writable<Map<string, ReadonlySet<string>>>(new Map());
export const pendingJobCalls: Readable<Map<string, ReadonlySet<string>>> = { subscribe: pending.subscribe };
/** The call on its way for each job, and what it is ("pause", "cancel", a note's words), so only the very same tap is joined. */
const inFlight = new Map<string, { what: string; answer: Promise<JobCallResult> }>();

function markPending(brickId: string, jobId: string, on: boolean) {
    pending.update((all) => {
        const next = new Map(all);
        const jobs = new Set(next.get(brickId) ?? []);
        if (on) jobs.add(jobId);
        else jobs.delete(jobId);
        if (jobs.size > 0) next.set(brickId, jobs);
        else next.delete(brickId);
        return next;
    });
}

/**
 * One call on one job and what Orbit answered, the computer it sends back put on screen so every place that shows the Brick agrees.
 * The same tap again while it is on its way gets the first one's answer: nothing is sent twice. A different tap on the same job (Cancel
 * while Pause is on its way) waits for the first answer and then goes out, so Orbit sees them in the order they were tapped and none
 * is lost. Any refusal reads the computer again, since the page was showing something that is no longer true.
 */
async function jobCall(
    brickId: string,
    jobId: string,
    what: string,
    send: (commandId: string) => Promise<unknown>
): Promise<JobCallResult> {
    const key = `${brickId}\u0000${jobId}`;
    const running = inFlight.get(key);
    if (running?.what === what) return running.answer;
    const before = running?.answer;
    // This tap's own id, made HERE at the click and kept with the request while it is on its way (GPT's sixth answer, finding 4): a request that goes out
    // again under it (a renewed sign-in resends the same one) is done once by Orbit, and a later tap is a control of its own with its own id
    const commandId = newCommandId();
    const call = (async (): Promise<JobCallResult> => {
        if (before) await before;
        const sentAs = ticket(brickId);
        markPending(brickId, jobId, true);
        try {
            const answer = await send(commandId);
            // A Cancel sent as "never started" that Orbit found started cancelled nothing: the page is read again and the person is asked first
            if (isStartedAnswer(answer)) {
                await loadBrickComputer(brickId);
                return { ok: false, why: "started" };
            }
            const view = parseBrickComputer(answer);
            if (view) put(brickId, view, sentAs);
            else await loadBrickComputer(brickId);
            return { ok: true };
        } catch (error) {
            console.warn("A call on a Brick's computer job was refused", error);
            await loadBrickComputer(brickId);
            return { ok: false, why: refusalOf(error) };
        } finally {
            markPending(brickId, jobId, false);
        }
    })();
    const entry = { what, answer: call };
    inFlight.set(key, entry);
    try {
        return await call;
    } finally {
        if (inFlight.get(key) === entry) inFlight.delete(key);
    }
}

/** Pause, Resume, Do this next (now, pausing what runs, with "first-now") or Cancel, on one job. */
export function brickComputerJobAction(
    brickId: string,
    jobId: string,
    control: JobControl,
    options: { expected?: "not_started" } = {}
): Promise<JobCallResult> {
    return jobCall(brickId, jobId, options.expected ? `${control}\u0000${options.expected}` : control, (commandId) =>
        control === "first-now"
            ? botApiService.brickComputerJobAction(brickId, jobId, "first", { pauseRunning: true, commandId })
            : botApiService.brickComputerJobAction(brickId, jobId, control, {
                  commandId,
                  ...(control === "cancel" && options.expected ? { expected: options.expected } : {}),
              })
    );
}

/** Tells one job something new in the person's own words. Words that are only spaces send nothing. */
export async function noteToComputerJob(brickId: string, jobId: string, words: string): Promise<JobCallResult> {
    const note = words.trim();
    if (!note) return { ok: false, why: "changed" };
    return jobCall(brickId, jobId, `note\u0000${note}`, (commandId) =>
        botApiService.noteToBrickComputerJob(brickId, jobId, note, commandId)
    );
}

/** Each job's Activity, as last read: the steps it has done so far, oldest first. A job not read yet has no entry. */
const activities = writable<Map<string, ComputerStep[]>>(new Map());
export const jobActivities: Readable<Map<string, ComputerStep[]>> = { subscribe: activities.subscribe };
const activityAsked = new Map<string, number>();
const activityShown = new Map<string, number>();

/** Reads one job's Activity again. Resolves to the steps, or undefined when they could not be read (what was shown stays). */
export async function loadJobActivity(brickId: string, jobId: string): Promise<ComputerStep[] | undefined> {
    const sentAs = (activityAsked.get(jobId) ?? 0) + 1;
    activityAsked.set(jobId, sentAs);
    try {
        const steps = parseJobActivity(await botApiService.getBrickComputerJobActivity(brickId, jobId));
        if (!steps || sentAs < (activityShown.get(jobId) ?? 0)) return steps;
        activityShown.set(jobId, sentAs);
        activities.update((all) => new Map(all).set(jobId, steps));
        return steps;
    } catch (error) {
        console.warn("Could not read a computer job's Activity", error);
        return undefined;
    }
}

/** True while the job still has the computer or waits in line to: its Activity can still grow. */
const stillGoing = (brickId: string, jobId: string): boolean => {
    const view = get(computers).get(brickId);
    if (!view) return true;
    return (holdsComputer(view.job) && view.job.id === jobId) || view.queued.some((job) => job.id === jobId);
};

/**
 * Keeps one job's Activity up to date while it is shown: read at once, then again every few seconds while the job is still going,
 * and once more when it ends so its last step shows. Reading is all it does. `onRead` hears each read (undefined when it failed).
 * Returns the function that lets go.
 */
export function followJobActivity(
    brickId: string,
    jobId: string,
    onRead?: (steps: ComputerStep[] | undefined) => void
): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
        const going = stillGoing(brickId, jobId);
        const read = await loadJobActivity(brickId, jobId);
        if (stopped) return;
        onRead?.(read);
        if (!going) return;
        timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}

/** One loop per Brick, however many pieces on screen show it: the bar, the page card and the screen share it. */
const loops = new Map<string, { holders: number; stop: () => void }>();

function startLoop(brickId: string): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A read that failed says nothing about the computer: the pace stays what the last read that went through set it to
    let busy = false;
    const tick = async () => {
        const view = await loadBrickComputer(brickId);
        if (stopped) return;
        // A paused job does nothing until the person says Resume: only work that goes on by itself keeps the fast pace
        if (view) busy = holdsComputer(view.job) || inLine(view).length > 0;
        timer = setTimeout(() => void tick(), busy ? POLL_MS : POLL_MS * 5);
    };
    void tick();
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}

/**
 * Keeps one Brick's computer up to date while something shows it: read at once, then every few seconds while a job runs, waits or
 * is in line, and slowly otherwise. Reading is all it does. Pieces that show the same Brick share one loop, so the same read never
 * goes out twice: the first to follow starts it, one that joins later reads once now so it starts fresh, and the last to let go
 * stops it. Returns the function that lets go (letting go twice is harmless).
 */
export function followBrickComputer(brickId: string): () => void {
    const existing = loops.get(brickId);
    const loop = existing ?? { holders: 0, stop: startLoop(brickId) };
    if (!existing) loops.set(brickId, loop);
    else void loadBrickComputer(brickId);
    loop.holders += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        loop.holders -= 1;
        if (loop.holders > 0) return;
        loop.stop();
        if (loops.get(brickId) === loop) loops.delete(brickId);
    };
}

export const brickComputerOf = (brickId: string): BrickComputerView | undefined => get(computers).get(brickId);
