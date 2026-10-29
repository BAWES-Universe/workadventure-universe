/**
 * The steps line a reply shows while the bot uses its tools (#1545): one line per reply instead of a "🔍 tool_name..."
 * message per call. Each step says what the bot does in plain words, about what, and whether it worked. The game draws
 * it from the `universe.steps` field of one direct message that the bot server updates in place.
 */
import { CHANGE_ARTIFACT_TOOL, MAKE_ARTIFACT_TOOL } from './ArtifactTools';

/** The field of the steps message, read by the game. */
export const STEPS_KEY = 'universe.steps';

/** A tool call as the steps line shows it. */
export interface ToolStep {
    /** The call's id, so its result finds it. */
    id: string;
    /** While it runs, e.g. "Reading workadventu.re" or "Using Generate music". */
    doing: string;
    /** Once it ran, e.g. "Read a page". */
    done: string;
    /** What it is about: the prompt, search, link or title, on one short line. */
    detail?: string;
    /** Steps with the same group are counted together in the summary. */
    group: string;
}

/** How a call ended. */
export interface ToolStepResult {
    id: string;
    ok: boolean;
    /** Why it didn't work, short and without links. */
    note?: string;
}

export type StepState = 'running' | 'done' | 'failed';

export interface ShownStep {
    doing: string;
    done: string;
    detail?: string;
    state: StepState;
    /** The same call with the same detail ran earlier in this reply. */
    again?: boolean;
    note?: string;
}

/** What the `universe.steps` field carries. */
export interface StepsField {
    v: 1;
    /** working: steps are running. done: the answer came. stopped: the reply failed part-way. */
    state: 'working' | 'done' | 'stopped';
    /** The line itself: what runs now while working, the summary once done. */
    line: string;
    /** When the first step started, for the clock while working. */
    startedAt: number;
    steps: ShownStep[];
}

const DETAIL_MAX = 60;
const NOTE_MAX = 80;
/** Arguments worth showing, in order: what the call is about. */
const DETAIL_KEYS = ['prompt', 'query', 'q', 'search', 'url', 'title', 'topic', 'text', 'description', 'name'];
/** Never shown, whatever they hold. */
const PRIVATE_KEY = /key|token|secret|password|passwd|auth|cookie|session|email|phone/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** A long unbroken run of letters and digits with both: what keys and tokens look like, not words. */
const TOKEN_LIKE = /(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}/;

/** Our own tools that are work the person waits for. Moving around the map stays out of the line. */
const OWN_STEPS: Record<string, (args: Record<string, unknown>) => Omit<ToolStep, 'id'>> = {
    read_web_page: (args) => {
        const where = pageName(args.url);
        return { doing: where ? `Reading ${where}` : 'Reading a page', done: 'Read a page', detail: shown(args.url), group: 'page' };
    },
    [MAKE_ARTIFACT_TOOL]: (args) => ({ doing: 'Making an artifact', done: 'Made an artifact', detail: shown(args.title), group: 'make_artifact' }),
    [CHANGE_ARTIFACT_TOOL]: (args) => ({ doing: 'Changing an artifact', done: 'Changed an artifact', detail: shown(args.title), group: 'change_artifact' }),
};

/** How a group reads in the summary, by count. Groups without one say "<done> 3 times". */
const OWN_GROUPS: Record<string, (count: number) => string> = {
    page: (n) => (n === 1 ? 'Read 1 page' : `Read ${n} pages`),
    make_artifact: (n) => (n === 1 ? 'Made an artifact' : `Made ${n} artifacts`),
    change_artifact: (n) => (n === 1 ? 'Changed an artifact' : `Changed an artifact ${n} times`),
};

/** What a tool with no usable name reads as. */
const NO_NAME = 'Use a tool';

/** Whether the line shows this tool: the bot's tool servers, and our own tools above. */
export function showsAsStep(name: string, fromToolServer: boolean): boolean {
    return fromToolServer || name in OWN_STEPS;
}

/**
 * A call in plain words. A tool server's own title for the tool is used when it gave one, else its name tidied up
 * ("generate_music" reads "Generate music"), after "Using" and "Used" so it never reads as an order. The words stay
 * the tool server's: "Used Generate music 6 times".
 */
export function describeStep(call: { id: string; name: string; arguments?: unknown }, title?: string): ToolStep {
    const args = parseArgs(call.arguments);
    const own = OWN_STEPS[call.name];
    if (own && !title) return { id: call.id, ...own(args) };
    const words = oneLine(title) ?? tidyName(call.name);
    const named = words !== NO_NAME;
    return {
        id: call.id,
        doing: named ? `Using ${words}` : 'Using a tool',
        done: named ? `Used ${words}` : 'Used a tool',
        detail: detailOf(args),
        group: `tool:${call.name}`,
    };
}

/** "generate_music" and "generateMusic" read "Generate music". */
export function tidyName(name: string): string {
    const words = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_\-.]+/g, ' ')
        .trim()
        .toLowerCase();
    return words ? words[0].toUpperCase() + words.slice(1) : NO_NAME;
}

/** How a tool's result ended, from the shapes our tools and tool servers answer with. */
export function resultOf(id: string, result: unknown): ToolStepResult {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        const r = result as Record<string, unknown>;
        if (r.error || r.success === false || r.isError === true) {
            const why = typeof r.error === 'string' ? r.error : typeof r.message === 'string' ? r.message : undefined;
            return { id, ok: false, note: noteOf(why) };
        }
    }
    return { id, ok: true };
}

/**
 * The steps of one reply, kept by whoever shows them. Steps are only ever added, so the line keeps its order, and a
 * result only changes the step it belongs to.
 */
export class ReplySteps {
    private steps: Array<ToolStep & { state: StepState; again?: boolean; note?: string }> = [];
    private state: StepsField['state'] = 'working';
    readonly startedAt: number;

    constructor(now = Date.now()) {
        this.startedAt = now;
    }

    get size(): number {
        return this.steps.length;
    }

    start(steps: ToolStep[]): void {
        for (const step of steps) {
            // Only a call about something can be seen to repeat: two calls without a detail may differ
            const again = !!step.detail && this.steps.some((s) => s.group === step.group && s.detail === step.detail);
            this.steps.push({ ...step, state: 'running', ...(again ? { again } : {}) });
        }
    }

    finish(results: ToolStepResult[]): boolean {
        let changed = false;
        for (const result of results) {
            const step = this.steps.find((s) => s.id === result.id && s.state === 'running');
            if (!step) continue;
            step.state = result.ok ? 'done' : 'failed';
            if (result.note) step.note = result.note;
            changed = true;
        }
        return changed;
    }

    /** The answer came: anything still running counts as done, since its result was used. */
    end(): void {
        for (const step of this.steps) if (step.state === 'running') step.state = 'done';
        this.state = 'done';
    }

    /** The reply failed part-way: what didn't finish stays unfinished. */
    stop(): void {
        for (const step of this.steps) {
            if (step.state === 'running') step.state = 'failed';
        }
        this.state = 'stopped';
    }

    field(): StepsField {
        return {
            v: 1,
            state: this.state,
            line: this.state === 'working' ? this.liveLine() : summaryOf(this.steps),
            startedAt: this.startedAt,
            steps: this.steps.map(({ doing, done, detail, state, again, note }) => ({
                doing,
                done,
                ...(detail ? { detail } : {}),
                state,
                ...(again ? { again } : {}),
                ...(note ? { note } : {}),
            })),
        };
    }

    /** The plain text other chat apps show. */
    text(): string {
        const field = this.field();
        const failed = field.steps.filter((s) => s.state === 'failed').length;
        if (field.state === 'working') return `${field.line}…`;
        return failed ? `${field.line} · ${failed} didn't work` : field.line;
    }

    /** What runs now: the newest running step (the game shows its detail and how many are done beside it). */
    private liveLine(): string {
        const now = this.steps.filter((s) => s.state === 'running').at(-1) ?? this.steps.at(-1);
        return now?.doing ?? '';
    }
}

/** "Read 1 page · Used Generate music 6 times": every group that worked at least once, in the order it first ran. */
export function summaryOf(steps: Array<{ group?: string; done: string; state: StepState }>): string {
    const groups = new Map<string, { done: string; count: number }>();
    for (const step of steps) {
        if (step.state !== 'done') continue;
        const key = step.group ?? step.done;
        const group = groups.get(key);
        if (group) group.count++;
        else groups.set(key, { done: step.done, count: 1 });
    }
    const parts = [...groups.entries()].map(([key, { done, count }]) =>
        OWN_GROUPS[key] ? OWN_GROUPS[key](count) : count > 1 ? `${done} ${count} times` : done
    );
    if (parts.length) return parts.join(' · ');
    // Nothing worked: the line only counts, and says how many didn't work beside it
    return steps.length === 1 ? '1 step' : `${steps.length} steps`;
}

function parseArgs(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    if (typeof raw !== 'string' || !raw.trim()) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function detailOf(args: Record<string, unknown>): string | undefined {
    for (const key of DETAIL_KEYS) {
        const found = Object.keys(args).find((k) => k.toLowerCase() === key);
        if (found && !PRIVATE_KEY.test(found)) {
            const value = shown(args[found]);
            if (value) return value;
        }
    }
    return undefined;
}

/**
 * A detail as others in the chat may see it (nearby chat shows it to everyone there): links keep only where they go,
 * without sign-in parts, queries or fragments, and a value carrying an email address or a token-like string is not
 * shown at all.
 */
function shown(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const bare = value.replace(/\bhttps?:\/\/\S+/gi, (link) => {
        try {
            const url = new URL(link);
            return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`;
        } catch {
            return '';
        }
    });
    if (EMAIL.test(bare) || TOKEN_LIKE.test(bare)) return undefined;
    return oneLine(bare);
}

function oneLine(value: unknown, max = DETAIL_MAX): string | undefined {
    if (typeof value !== 'string') return undefined;
    const line = value.replace(/\s+/g, ' ').trim();
    if (!line) return undefined;
    const chars = Array.from(line);
    return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : line;
}

function pageName(url: unknown): string | undefined {
    if (typeof url !== 'string') return undefined;
    try {
        return new URL(url).hostname.replace(/^www\./, '') || undefined;
    } catch {
        return undefined;
    }
}

/** A failure in a few words: the tool's own message, without links (they can carry tokens) or our prefix. */
function noteOf(why: string | undefined): string | undefined {
    if (!why) return undefined;
    const words = why.replace(/^(?:MCP )?tool error:\s*/i, '').replace(/\bhttps?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
    return oneLine(words, NOTE_MAX);
}
