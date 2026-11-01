import { botIdFromChatId } from "./BotChatStatus";

/**
 * The steps line of a bot's reply (#1545): one notice per reply that the bot server updates while the bot uses its
 * tools, carried in its `universe.steps` field. Drawn as a quiet line, not a bubble.
 */
/** unknown: the call went out and no answer came back, so it may have run (#1692). */
export type BotStepState = "running" | "done" | "failed" | "unknown";

export interface BotStep {
    /** While it runs, e.g. "Reading workadventu.re". */
    doing: string;
    /** Once it ran, e.g. "Read a page". */
    done: string;
    /** What it is about: a prompt, search, link or title. */
    detail?: string;
    state: BotStepState;
    /** The same call about the same thing ran earlier in this reply. */
    again: boolean;
    /** Why it didn't work. */
    note?: string;
}

export interface BotSteps {
    /** working: steps run. done: the answer came. stopped: the reply failed part-way. */
    state: "working" | "done" | "stopped";
    /** What runs now while working, the summary once done. */
    line: string;
    /** When the first step started (the bot server's clock), for the clock while working. */
    startedAt: number;
    steps: BotStep[];
}

const STATES = ["working", "done", "stopped"];
const STEP_STATES = ["running", "done", "failed", "unknown"];
/** Each text is one short line from the bot server; a longer one is cut so it can't stretch the chat. */
const TEXT_MAX = 200;

/** The steps a bot's notice carries, or undefined when it is anything else, or not sent by a bot. */
export function readBotSteps(
    sender: string | null | undefined,
    content: Record<string, unknown> | undefined
): BotSteps | undefined {
    if (!content || !botIdFromChatId(sender) || content.msgtype !== "m.notice") return undefined;
    return parseBotSteps(content["universe.steps"]);
}

export function parseBotSteps(value: unknown): BotSteps | undefined {
    if (!value || typeof value !== "object") return undefined;
    const field = value as Record<string, unknown>;
    if (field.v !== 1 || !STATES.includes(field.state as string) || !Array.isArray(field.steps)) return undefined;
    const line = text(field.line);
    if (line === undefined) return undefined;
    const steps: BotStep[] = [];
    for (const raw of field.steps) {
        if (!raw || typeof raw !== "object") continue;
        const step = raw as Record<string, unknown>;
        const doing = text(step.doing);
        const done = text(step.done);
        if (!doing || !done || !STEP_STATES.includes(step.state as string)) continue;
        steps.push({
            doing,
            done,
            detail: text(step.detail) || undefined,
            state: step.state as BotStepState,
            again: step.again === true,
            note: text(step.note) || undefined,
        });
    }
    return {
        state: field.state as BotSteps["state"],
        line,
        startedAt: typeof field.startedAt === "number" && Number.isFinite(field.startedAt) ? field.startedAt : 0,
        steps,
    };
}

/** The step the line names while it works: the newest that still runs. */
export function currentStep(steps: BotSteps): BotStep | undefined {
    return [...steps.steps].reverse().find((step) => step.state === "running") ?? steps.steps.at(-1);
}

/** "1:05" for 65 seconds, "12:03" for longer; the clock beside a working line. */
export function stepsClock(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function text(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    return value.trim().slice(0, TEXT_MAX);
}
