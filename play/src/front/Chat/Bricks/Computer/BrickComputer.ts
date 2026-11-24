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
    /** The job ran and was paused before, and now waits in line to carry on by itself ("Do this first" put it back). */
    pausedBefore: boolean;
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
        pausedBefore: row.pausedBefore === true || (typeof row.pauses === "number" && row.pauses > 0),
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
 * The calls a person can make on one job of a Brick's computer (game piece 7 of the computers plan, as the approved steering mock
 * draws them). Orbit decides; these only say which taps make sense for what the page shows now, so a tap Orbit would refuse is not
 * offered.
 * - pause: the job holding the computer while Brick has it. Never while the person holds the screen: they hand it back first.
 * - resume: a paused job.
 * - first ("Do this next"): a job waiting in line that is not already next. It moves to the front; nothing running is paused.
 *   Pausing what runs to start another at once ("first-now") is said to Brick in words ("do this first, then the visa").
 * - cancel: any one job, running, waiting, in line or paused. The others carry on. A job that has run is named back first (see
 *   `endQuestion`).
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
    // The job already next in line gains nothing from moving first: it starts as soon as the computer is free
    return inLine(view)[0]?.id === jobId ? ["cancel"] : ["first", "cancel"];
}

/**
 * What a job's row says it is doing, for the words beside its title:
 * - working / waking / waiting-you: it has the computer (waiting-you: it waits for the person's details, sign-in, and so on).
 * - paused: paused by the person, by this month's time running out, or at their own spending limit (see `pausedWhy`).
 * - comes-back: it ran, was paused to let another job go first, and carries on next, by itself.
 * - next / in-line / used-up / busy: it waits in line: next, further back, for more computer time, or for a free computer.
 */
export type JobRowState =
    | "working"
    | "waking"
    | "waiting-you"
    | "paused"
    | "comes-back"
    | "next"
    | "in-line"
    | "used-up"
    | "busy";

export function jobRowState(view: BrickComputerView, job: ComputerJob): JobRowState {
    if (job.status === "running" || job.status === "waiting") {
        if (job.status === "waiting") return "waiting-you";
        return view.machine === "waking" || view.machine === "restoring" ? "waking" : "working";
    }
    if (job.queuedFor === "paused") return "paused";
    if (job.queuedFor === "allowance") return "used-up";
    if (job.queuedFor === "busy" || job.queuedFor === "pool") return "busy";
    const next = inLine(view)[0]?.id === job.id;
    if (next && job.pausedBefore) return "comes-back";
    return next ? "next" : "in-line";
}

/** Every job of the computer in the order the person reads them: the one holding it, then the line as Orbit starts it, then paused jobs. */
export const allJobs = (view: BrickComputerView | undefined): ComputerJob[] =>
    view ? [...(holdsComputer(view.job) ? [view.job] : []), ...inLine(view), ...pausedJobs(view)] : [];

/** Every job Stop ends: the one holding the computer and every job in line, paused ones too. */
export const jobsStopEnds = (view: BrickComputerView | undefined): ComputerJob[] =>
    view ? [...(holdsComputer(view.job) ? [view.job] : []), ...view.queued] : [];

/**
 * Whether Stop or Cancel asks first on the panel, and what it asks (the approved steering mock, which wins over the earlier "always
 * ask" decision on the panel):
 * - Stop with several jobs: "all", each job named, Keep them or Stop all. Stop with one job ends it at once: null.
 * - Cancel of a job that has run (it holds the computer, or ran before it was paused): "one", the job named back before it ends.
 *   Cancel of a job that never started ends at once: nothing is lost and nothing was charged: null.
 * Null also when there is nothing to end.
 */
export type EndQuestion = { kind: "one"; job: ComputerJob } | { kind: "all"; jobs: ComputerJob[] };

/** A job that has used computer time: it holds the computer now, or it ran before it was paused or put back in line. */
export const hasStarted = (job: ComputerJob): boolean =>
    job.status === "running" || job.status === "waiting" || job.pausedBefore;

export function endQuestion(
    view: BrickComputerView | undefined,
    what: { stop: true } | { cancel: string }
): EndQuestion | null {
    if ("stop" in what) {
        const ending = jobsStopEnds(view);
        return ending.length > 1 ? { kind: "all", jobs: ending } : null;
    }
    const job = jobsStopEnds(view).find((each) => each.id === what.cancel);
    return job && hasStarted(job) ? { kind: "one", job } : null;
}

/** What a line of Activity is: a step the computer did, the person's own message to the job, or where it paused or carried on. */
export type StepKind = "step" | "note" | "pause" | "resume";
const STEP_KINDS: readonly string[] = ["step", "note", "pause", "resume"];

export interface ComputerStep {
    seq: number;
    label: string;
    at: string | null;
    kind: StepKind;
    /** A short line under the step ("evisa.gov.kw", "step 5 of 7"), when Orbit has one. */
    detail: string | null;
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
        bySeq.set(seq, {
            seq,
            label,
            at: typeof row.at === "string" && row.at ? row.at : null,
            kind: typeof row.kind === "string" && STEP_KINDS.includes(row.kind) ? (row.kind as StepKind) : "step",
            detail: text(row.detail, 150),
        });
    }
    return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
