/**
 * A Brick's computer (game #2000), as Orbit describes it to the Brick's owner. Nothing in here talks to a server or reads a
 * store, so every rule can be unit tested. The game shows words, never counts or prices: the month is a bar and plain words.
 */

export type MachineState = "none" | "waking" | "resting" | "working" | "cold" | "broken" | "restoring" | "stopped";
export type JobStatus = "queued" | "running" | "waiting" | "done" | "stopped" | "failed";
/** Why a job in line has not started. "paused": the person (or the month running out) paused it; it waits for Resume and holds no room. */
export type QueuedFor = "turn" | "allowance" | "busy" | "pool" | "paused";
/**
 * Who paused a job: the person, the month's computer time running out while it ran ("allowance"), or a spending limit the person set
 * themselves being reached ("rule"). The last two carry on by themselves when more arrives.
 */
export type PausedWhy = "person" | "allowance" | "rule";
export type WaitingFor = "details" | "signin" | "upload" | "pay" | "submit" | "answer";

export interface ComputerJob {
    id: string;
    title: string;
    status: JobStatus;
    queuedFor: QueuedFor | null;
    stepDone: number;
    stepTotal: number | null;
    stepLabel: string | null;
    waitingFor: WaitingFor | null;
    control: "brick" | "person";
    /** What Brick is ready to put in at the hand-over, and where: the one tap approves exactly this. */
    ready: { what: string; where: string } | null;
    /** When a paused job was paused (ISO), and why. Null for every job that is not paused. */
    pausedAt: string | null;
    pausedWhy: PausedWhy | null;
}

/** How the last job ended, when the person should hear it: nobody answered its handover, or this month's computer time ran out. */
export type NoticeHow = "unanswered" | "month";
export interface ComputerNotice {
    jobId: string;
    how: NoticeHow;
}

export interface BrickComputerView {
    /** False on a server with no computers: the page says they are not open yet. */
    available: boolean;
    on: boolean;
    machine: MachineState;
    /** The job that has the computer, running or waiting for the person. */
    job: ComputerJob | null;
    /** Jobs in line behind it, or waiting for the person's own month. */
    queued: ComputerJob[];
    /** The share of the month left (0 to 1), never a count or a price; null when no allowance is set up. */
    month: { leftFraction: number; unlimited: boolean; endsAt: string } | null;
    files: { bytes: number; savedAt: string | null };
    restoredFrom: string | null;
    /** Told once: it is only the Brick's latest job, and a new job or Dismiss takes it away. Null when there is nothing to say. */
    notice: ComputerNotice | null;
}

const MACHINES: readonly string[] = ["none", "waking", "resting", "working", "cold", "broken", "restoring", "stopped"];
const STATUSES: readonly string[] = ["queued", "running", "waiting", "done", "stopped", "failed"];
const QUEUED: readonly string[] = ["turn", "allowance", "busy", "pool", "paused"];
const WAITING: readonly string[] = ["details", "signin", "upload", "pay", "submit", "answer"];
const TEXT_MAX = 200;

const text = (value: unknown, max = TEXT_MAX): string | null =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

export function parseComputerJob(value: unknown): ComputerJob | undefined {
    if (!value || typeof value !== "object") return undefined;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || typeof row.status !== "string" || !STATUSES.includes(row.status)) {
        return undefined;
    }
    const ready = row.ready as Record<string, unknown> | null | undefined;
    const what = ready ? text(ready.what, 150) : null;
    const where = ready ? text(ready.where, 150) : null;
    return {
        id: row.id,
        title: text(row.title) ?? "",
        status: row.status as JobStatus,
        queuedFor:
            typeof row.queuedFor === "string" && QUEUED.includes(row.queuedFor) ? (row.queuedFor as QueuedFor) : null,
        stepDone: typeof row.stepDone === "number" && row.stepDone >= 0 ? Math.trunc(row.stepDone) : 0,
        stepTotal: typeof row.stepTotal === "number" && row.stepTotal >= 1 ? Math.trunc(row.stepTotal) : null,
        stepLabel: text(row.stepLabel),
        waitingFor:
            typeof row.waitingFor === "string" && WAITING.includes(row.waitingFor)
                ? (row.waitingFor as WaitingFor)
                : null,
        control: row.control === "person" ? "person" : "brick",
        ready: what && where ? { what, where } : null,
        ...pausedOf(row),
    };
}

/** A job is paused only while it sits in line marked paused; anything else Orbit says about a pause is ignored. */
function pausedOf(row: Record<string, unknown>): { pausedAt: string | null; pausedWhy: PausedWhy | null } {
    if (row.status !== "queued" || row.queuedFor !== "paused") return { pausedAt: null, pausedWhy: null };
    return {
        pausedAt: typeof row.pausedAt === "string" && row.pausedAt ? row.pausedAt : null,
        pausedWhy: row.pausedWhy === "allowance" || row.pausedWhy === "rule" ? row.pausedWhy : "person",
    };
}

/** Orbit's answer (`{ computer }`) read safely; undefined when it is not one. */
export function parseBrickComputer(value: unknown): BrickComputerView | undefined {
    const root = value as { computer?: unknown } | null;
    const row = root && typeof root === "object" ? (root.computer as Record<string, unknown> | undefined) : undefined;
    if (!row || typeof row !== "object") return undefined;
    const month = row.month as Record<string, unknown> | null | undefined;
    const files = (row.files ?? {}) as Record<string, unknown>;
    return {
        available: row.available === true,
        on: row.on === true,
        machine:
            typeof row.machine === "string" && MACHINES.includes(row.machine) ? (row.machine as MachineState) : "none",
        job: parseComputerJob(row.job) ?? null,
        queued: Array.isArray(row.queued)
            ? row.queued.map(parseComputerJob).filter((job): job is ComputerJob => job !== undefined)
            : [],
        month:
            month && typeof month.leftFraction === "number" && typeof month.endsAt === "string"
                ? {
                      leftFraction: Math.max(0, Math.min(1, month.leftFraction)),
                      unlimited: month.unlimited === true,
                      endsAt: month.endsAt,
                  }
                : null,
        files: {
            bytes: typeof files.bytes === "number" && files.bytes >= 0 ? files.bytes : 0,
            savedAt: typeof files.savedAt === "string" ? files.savedAt : null,
        },
        restoredFrom: typeof row.restoredFrom === "string" ? row.restoredFrom : null,
        notice: parseNotice(row.notice),
    };
}

function parseNotice(value: unknown): ComputerNotice | null {
    const row = value as Record<string, unknown> | null | undefined;
    if (!row || typeof row !== "object") return null;
    if (typeof row.jobId !== "string" || !row.jobId) return null;
    return row.how === "unanswered" || row.how === "month" ? { jobId: row.jobId, how: row.how } : null;
}

/** What a job's answer from Orbit carries (`{ job }`), for take over, hand back and the one tap. */
export function parseJobAnswer(value: unknown): ComputerJob | undefined {
    const root = value as { job?: unknown } | null;
    return root && typeof root === "object" ? parseComputerJob(root.job) : undefined;
}

export type MonthWord = "plenty" | "half" | "little" | "none" | "unlimited";

/** The words under the bar: a share is never shown as a number. */
export function monthWord(month: NonNullable<BrickComputerView["month"]>): MonthWord {
    if (month.unlimited) return "unlimited";
    if (month.leftFraction <= 0) return "none";
    if (month.leftFraction > 0.5) return "plenty";
    if (month.leftFraction > 0.2) return "half";
    return "little";
}

/** The size of its files in the units a person knows: "1.2 GB", "340 MB". */
export function fileSize(bytes: number): string {
    if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
    if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** A line that starts a sentence starts with a capital, whatever case Brick named it in ("your name" shows as "Your name"). */
export const sentenceStart = (text: string): string =>
    text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;

/** A job holds the computer while it runs or waits for its person. */
export const holdsComputer = (job: ComputerJob | null | undefined): job is ComputerJob =>
    !!job && (job.status === "running" || job.status === "waiting");

/** True when the computer is doing something the person can watch. */
export const canWatch = (view: BrickComputerView | undefined): boolean =>
    !!view && view.on && view.machine === "working" && holdsComputer(view.job);

/** The notice is told only while the computer is on and nothing else is happening: a job that runs or waits has the screen's words. */
export const noticeToTell = (view: BrickComputerView | undefined): ComputerNotice | null =>
    view && view.on && view.notice && !holdsComputer(view.job) && view.queued.length === 0 ? view.notice : null;

/** A job that waits in line only for its person to say Resume. */
export const isPaused = (job: ComputerJob | null | undefined): job is ComputerJob =>
    !!job && job.status === "queued" && job.queuedFor === "paused";

/** The jobs in line that will start by themselves, in the order Orbit starts them. Paused jobs are not among them. */
export const inLine = (view: BrickComputerView | undefined): ComputerJob[] =>
    view ? view.queued.filter((job) => !isPaused(job)) : [];

/** The paused jobs, in the order Orbit sends them. */
export const pausedJobs = (view: BrickComputerView | undefined): ComputerJob[] =>
    view ? view.queued.filter(isPaused) : [];

/**
 * What the bar says is true now: "waking" while the machine starts, otherwise the job. "queued" when nothing holds the computer and
 * a job will start by itself; "paused" when the only jobs left are paused. Null when nothing is happening.
 */
export type BarState = "waking" | "working" | "waiting" | "queued" | "paused";
export function barState(view: BrickComputerView | undefined): BarState | null {
    if (!view || !view.on) return null;
    if (holdsComputer(view.job)) {
        if (view.job.status === "waiting") return "waiting";
        return view.machine === "waking" || view.machine === "restoring" ? "waking" : "working";
    }
    if (inLine(view).length > 0) return "queued";
    return pausedJobs(view).length > 0 ? "paused" : null;
}

/** The job the bar is about: the one holding the computer, else the next to start, else the first paused one. */
export function barJob(view: BrickComputerView | undefined): ComputerJob | null {
    if (!view) return null;
    if (holdsComputer(view.job)) return view.job;
    return inLine(view)[0] ?? pausedJobs(view)[0] ?? null;
}

/**
 * The calls a person can make on one job of a Brick's computer (game piece 7 of the computers plan). Orbit decides; these only say
 * which taps make sense for what the page shows now, so a tap Orbit would refuse is not offered.
 * - pause: the job holding the computer while Brick has it (not while the person has taken the screen over: they hand it back
 *   first), or a job waiting in line, which then stays out of the line until Resume.
 * - resume: a paused job.
 * - Do this next, one tap that does all of it: "first-now" pauses the job holding the computer, starts this one at once, and the
 *   paused one goes on by itself afterwards. While nothing can be paused (the computer is free, or the person holds its screen) it is
 *   "first": the job moves to the front of the line. Not offered on the job that is already next with the computer free: it starts
 *   by itself.
 * - cancel: any one job, running, waiting, in line or paused. The others carry on. It always asks first (see `endQuestion`).
 */
export type JobControl = "pause" | "resume" | "first" | "first-now" | "cancel";

export function jobControls(view: BrickComputerView | undefined, jobId: string): JobControl[] {
    if (!view || !view.on) return [];
    const holder = holdsComputer(view.job) ? view.job : null;
    if (holder && holder.id === jobId) {
        return holder.control === "brick" ? ["pause", "cancel"] : ["cancel"];
    }
    const job = view.queued.find((queued) => queued.id === jobId);
    if (!job) return [];
    if (isPaused(job)) return ["resume", "cancel"];
    const controls: JobControl[] = [];
    if (holder?.control === "brick") controls.push("first-now");
    // The job already next in line gains nothing from moving first: it starts as soon as the computer is free
    else if (inLine(view)[0]?.id !== jobId) controls.push("first");
    controls.push("pause", "cancel");
    return controls;
}

/** Every job Stop ends: the one holding the computer and every job in line, paused ones too. */
export const jobsStopEnds = (view: BrickComputerView | undefined): ComputerJob[] =>
    view ? [...(holdsComputer(view.job) ? [view.job] : []), ...view.queued] : [];

/**
 * The question Stop and Cancel always ask before anything ends, since Pause is the safe choice and the question teaches the difference.
 * - "one": a single job would end. It offers Pause instead when that job can be paused (`pauseInstead`), never while the person holds
 *   its screen.
 * - "all": Stop would end several jobs: "Keep going" or "Stop all", with how many.
 * Null when there is nothing to end.
 */
export type EndQuestion =
    | { kind: "one"; job: ComputerJob; pauseInstead: boolean }
    | { kind: "all"; jobs: ComputerJob[] };

export function endQuestion(
    view: BrickComputerView | undefined,
    what: { stop: true } | { cancel: string }
): EndQuestion | null {
    const ending = "stop" in what ? jobsStopEnds(view) : jobsStopEnds(view).filter((job) => job.id === what.cancel);
    if (ending.length === 0) return null;
    if (ending.length > 1) return { kind: "all", jobs: ending };
    const [job] = ending;
    return { kind: "one", job, pauseInstead: jobControls(view, job.id).includes("pause") };
}

/** One step of a job's Activity: what it did, in order. */
export interface ComputerStep {
    seq: number;
    label: string;
    at: string | null;
}

/** Orbit's answer for a job's Activity (`{ steps }`), read safely: oldest first, each step once. Undefined when it is not one. */
export function parseJobActivity(value: unknown): ComputerStep[] | undefined {
    const root = value as { steps?: unknown } | null;
    if (!root || typeof root !== "object" || !Array.isArray(root.steps)) return undefined;
    const bySeq = new Map<number, ComputerStep>();
    for (const item of root.steps) {
        const row = item as Record<string, unknown> | null;
        if (!row || typeof row !== "object") continue;
        const seq = typeof row.seq === "number" && Number.isFinite(row.seq) ? Math.trunc(row.seq) : undefined;
        const label = text(row.label);
        if (seq === undefined || !label) continue;
        bySeq.set(seq, { seq, label, at: typeof row.at === "string" && row.at ? row.at : null });
    }
    return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
