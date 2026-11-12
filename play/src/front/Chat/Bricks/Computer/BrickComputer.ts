/**
 * A Brick's computer (game #2000), as Orbit describes it to the Brick's owner. Nothing in here talks to a server or reads a
 * store, so every rule can be unit tested. The game shows words, never counts or prices: the month is a bar and plain words.
 */

export type MachineState = "none" | "waking" | "resting" | "working" | "cold" | "broken" | "restoring" | "stopped";
export type JobStatus = "queued" | "running" | "waiting" | "done" | "stopped" | "failed";
export type QueuedFor = "turn" | "allowance" | "busy" | "pool";
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
const QUEUED: readonly string[] = ["turn", "allowance", "busy", "pool"];
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

/** What the bar says is true now: "waking" while the machine starts, otherwise the job. Null when nothing is happening. */
export type BarState = "waking" | "working" | "waiting" | "queued";
export function barState(view: BrickComputerView | undefined): BarState | null {
    if (!view || !view.on) return null;
    if (holdsComputer(view.job)) {
        if (view.job.status === "waiting") return "waiting";
        return view.machine === "waking" || view.machine === "restoring" ? "waking" : "working";
    }
    return view.queued.length > 0 ? "queued" : null;
}
