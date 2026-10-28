/**
 * A reply keeps its own steps (#1508): each round of tool calls goes back to the model as the chat messages providers
 * already know (what it said and called, then what came back), after the person's message, so step five still sees
 * what step one found. Steps are only ever added at the end, so the provider keeps matching what it read before; when
 * they pass "Room for tool results in one reply" (what came back, and what the calls were made with, such as an
 * artifact's whole page), the older ones are set aside to a line, once, and adding goes on.
 */
import { jsonrepair } from 'jsonrepair';
import type { ToolCall } from './types';

/** One round of a reply: what the model said and called, and what each call gave back. */
export interface ReplyStep {
    content: string;
    /** The model's reasoning for this round, when its provider sent it: thinking models want it back between steps. */
    reasoning?: string;
    calls: ToolCall[];
    results: { id: string; name: string; content: string }[];
}

/** The steps so far, and a last line from the bot server after them (how to carry on). */
export interface ReplySteps {
    steps: ReplyStep[];
    after?: string;
}

/**
 * The round's calls paired with what each gave back, with an id each so the two always match. Calls the bot server
 * could not run (no name) gave nothing back and are left out, as they were never run.
 */
export function stepOf(round: number, content: string, calls: ToolCall[], results: { id: string; name: string; text: string }[], reasoning?: string): ReplyStep {
    const run = calls.filter((call) => call.name && call.name.trim() !== '');
    const paired: ReplyStep = { content, calls: [], results: [], ...(reasoning ? { reasoning } : {}) };
    run.forEach((call, i) => {
        // By id when the call has one, so the pairs hold even if what ran is ever filtered differently
        const result = (call.id ? results.find((given) => given.id === call.id) : undefined) ?? results[i];
        if (!result) return;
        const id = call.id || `call_${round}_${i}`;
        paired.calls.push({ id, name: call.name, arguments: argumentsToSendBack(call.arguments) });
        paired.results.push({ id, name: result.name, content: result.text });
    });
    return paired;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A call's arguments as they go back to the model: valid JSON of an object, as providers want, repaired when the stream
 * cut or broke them (they were repaired the same way to run the call), or `{}` when nothing can be read.
 */
function argumentsToSendBack(args: string | undefined): string {
    if (!args || args.trim() === '') return '{}';
    try {
        if (isObject(JSON.parse(args))) return args;
    } catch {
        // repaired below
    }
    try {
        const repaired = jsonrepair(args);
        if (isObject(JSON.parse(repaired))) return repaired;
    } catch {
        // nothing to read
    }
    return '{}';
}

/** The steps as chat messages after the person's message, in the OpenAI shape both providers take. */
export function stepMessages(steps: ReplySteps | undefined, options: { reasoning?: boolean } = {}): Record<string, unknown>[] {
    if (!steps) return [];
    const messages: Record<string, unknown>[] = [];
    for (const step of steps.steps) {
        if (step.calls.length === 0) continue;
        messages.push({
            role: 'assistant',
            content: step.content || null,
            tool_calls: step.calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments || '{}' } })),
            ...(options.reasoning && step.reasoning ? { reasoning_content: step.reasoning } : {}),
        });
        for (const result of step.results) messages.push({ role: 'tool', tool_call_id: result.id, content: result.content });
    }
    if (steps.after) messages.push({ role: 'user', content: steps.after });
    return messages;
}

/** The steps as text, for a call that takes one message (a provider without streaming, or the last answer at the step limit). */
export function stepsAsText(steps: ReplyStep[]): string {
    return steps
        .map((step, i) => `=== Step ${i + 1} ===\n${step.results.map((result) => result.content).join('\n\n')}`)
        .join('\n\n');
}

/** The person's message with the steps after it as text, for a provider that takes one message. */
export function withStepsAsText(userMessage: string, steps: ReplySteps | undefined): string {
    if (!steps || steps.steps.length === 0) return steps?.after ? `${userMessage}\n\n${steps.after}` : userMessage;
    return `${userMessage}\n\n${stepsAsText(steps.steps)}${steps.after ? `\n\n${steps.after}` : ''}`;
}

/** The provider turned the call down because it is longer than the model takes. */
export function saysTooLong(text: string): boolean {
    return /context[_ ]length|context window|maximum context|too many tokens|prompt is too long|exceeds? (the )?(model'?s? )?(maximum|max|context)|input is too long|reduce the length/i.test(text);
}

/** The tokens the model takes and the tokens it was asked, when its error says both. */
export interface ContextNumbers {
    limit: number;
    asked: number;
}

const tokensIn = (text: string, wording: RegExp): number | undefined => {
    const match = wording.exec(text);
    return match ? Number(match[1]!.replace(/,/g, '')) : undefined;
};

/**
 * The numbers in a "too long" error: "maximum context length is 8192 tokens. However, you requested 9100 tokens",
 * LM Studio's "keep the first 9000 tokens … context length of only 8192 tokens", "210000 tokens > 200000 maximum".
 */
export function contextNumbersOf(text: string): ContextNumbers | undefined {
    const over = /(\d[\d,]*) tokens? > (\d[\d,]*)(?: tokens?)? maximum/i.exec(text);
    if (over) return { asked: Number(over[1]!.replace(/,/g, '')), limit: Number(over[2]!.replace(/,/g, '')) };
    const limit =
        tokensIn(text, /maximum context length is (\d[\d,]*) tokens/i) ??
        tokensIn(text, /context length of only (\d[\d,]*) tokens/i) ??
        tokensIn(text, /context (?:window|length) (?:of|is) (\d[\d,]*) tokens/i);
    const asked =
        tokensIn(text, /requested (\d[\d,]*) tokens/i) ??
        tokensIn(text, /resulted in (\d[\d,]*) tokens/i) ??
        tokensIn(text, /keep the first (\d[\d,]*) tokens/i) ??
        tokensIn(text, /\((\d[\d,]*) in the messages/i);
    return limit && asked && asked > limit ? { limit, asked } : undefined;
}

/** What a provider's done chunk says about a call turned down for length: nothing for any other error. */
export function tooLongOf(message: unknown): { tooLong?: true; context?: ContextNumbers } {
    const text = String(message ?? '');
    if (!saysTooLong(text)) return {};
    const context = contextNumbersOf(text);
    return { tooLong: true, ...(context ? { context } : {}) };
}

/**
 * Characters the steps give up so the call fits: what it went over, at this prompt's characters per token, with a
 * fifth more for the guess. Undefined without the numbers (the room is then halved instead).
 */
export function charsToFree(context: ContextNumbers | undefined, promptChars: number): number | undefined {
    if (!context || promptChars <= 0) return undefined;
    return Math.ceil((context.asked - context.limit) * (promptChars / context.asked) * 1.2);
}

function resultsSizeOf(step: ReplyStep): number {
    return step.results.reduce((total, result) => total + result.content.length, 0);
}

/** All a step sends back each time: what the model said, its reasoning, what it called with, and what came back. */
function sizeOf(step: ReplyStep): number {
    const calls = step.calls.reduce((total, call) => total + call.name.length + call.arguments.length, 0);
    return step.content.length + (step.reasoning?.length ?? 0) + calls + resultsSizeOf(step);
}

const asideValue = (whole: number) => `[${whole.toLocaleString('en-US')} characters, set aside to make room]`;

/**
 * A call's arguments with each long text in them set aside to a line (an artifact's whole page, a long prompt), so the
 * call still says what it did and stays valid JSON. As they were when there is nothing long in them.
 */
function argumentsAside(args: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(args);
    } catch {
        return args;
    }
    let changed = false;
    const walk = (value: unknown): unknown => {
        if (typeof value === 'string') {
            const line = asideValue(value.length);
            if (line.length >= value.length) return value;
            changed = true;
            return line;
        }
        if (Array.isArray(value)) return value.map(walk);
        if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, walk(inner)]));
        return value;
    };
    const aside = walk(parsed);
    return changed ? JSON.stringify(aside) : args;
}

/** Text up to `max` characters, never ending in half an emoji. */
function clipped(text: string, max: number): string {
    if (text.length <= max) return text;
    const end = /[\uD800-\uDBFF]/.test(text[max - 1] ?? '') ? max - 1 : max;
    return text.slice(0, Math.max(0, end));
}

type StepResult = ReplyStep['results'][number];

const asideLine = (name: string, whole: number) =>
    `[${name}: ${whole.toLocaleString('en-US')} characters, set aside to make room. Call it again if you need it.]`;
const cutNote = (kept: number, whole: number) =>
    `\n[Only the first ${kept.toLocaleString('en-US')} of ${whole.toLocaleString('en-US')} characters fit in this reply's room for tool results ("Room for tool results in one reply").]`;

/**
 * The steps of one reply within "Room for tool results in one reply". Adding a step that would pass it sets the older
 * results, and the long texts their calls were made with, aside to one line each, once, and adding goes on; a single
 * step larger than the room keeps as much of each result as fits, saying so.
 */
export class StepRoom {
    readonly steps: ReplyStep[] = [];
    /** Each cut result's whole text and how much of it is kept, so cutting again cuts the text and not its note. */
    private readonly cut = new WeakMap<StepResult, { whole: string; kept: number }>();
    private readonly setAsideResults = new WeakSet<StepResult>();
    private readonly setAsideCalls = new WeakSet<ToolCall>();

    constructor(private readonly room: number) {}

    size(): number {
        return this.steps.reduce((total, step) => total + sizeOf(step), 0);
    }

    add(step: ReplyStep): void {
        if (this.size() + sizeOf(step) > this.room) this.setAside(this.steps);
        if (sizeOf(step) > this.room) this.fit(step, this.room);
        this.steps.push(step);
    }

    /**
     * The model turned the steps down for length: set the older results aside, then cut the newest step, by `free`
     * characters when the error said how far over it went (its notes counted), else to half of what it still has.
     * False when the steps could not be made any smaller, so asking again always ends.
     */
    makeRoom(free?: number): boolean {
        const before = this.size();
        const goal = free !== undefined ? before - free : undefined;
        const enough = (changed: boolean) => changed && (goal === undefined || this.size() <= goal);
        if (enough(this.setAside(this.steps.slice(0, -1)))) return this.size() < before;
        const newest = this.steps.at(-1);
        // The newest step's own long arguments next: what it asked for is in its results, which it still needs
        if (newest && enough(this.setAsideArguments(newest))) return this.size() < before;
        if (newest) {
            const kept = newest.results.reduce((total, result) => total + (this.cut.get(result)?.kept ?? result.content.length), 0);
            const others = this.size() - resultsSizeOf(newest);
            const notes = this.notesOf(newest);
            const want = Math.max(0, goal === undefined ? Math.floor(kept / 2) : Math.min(kept - 1, goal - others - notes));
            // Only when it makes the steps smaller: a short result cut to half would only gain a note
            if (others + want + notes < this.size()) this.fit(newest, want);
        }
        return this.size() < before;
    }

    /** The most characters the notes of this step's results take once they are cut. */
    private notesOf(step: ReplyStep): number {
        return step.results.reduce((total, result) => {
            const whole = this.cut.get(result)?.whole.length ?? result.content.length;
            return total + cutNote(whole, whole).length;
        }, 0);
    }

    /** Sets the long texts in a step's call arguments aside, once. */
    private setAsideArguments(step: ReplyStep): boolean {
        let changed = false;
        for (const call of step.calls) {
            if (this.setAsideCalls.has(call)) continue;
            const aside = argumentsAside(call.arguments);
            if (aside.length >= call.arguments.length) continue;
            call.arguments = aside;
            this.setAsideCalls.add(call);
            changed = true;
        }
        return changed;
    }

    private setAside(steps: ReplyStep[]): boolean {
        let changed = false;
        for (const step of steps) {
            if (this.setAsideArguments(step)) changed = true;
            for (const result of step.results) {
                if (this.setAsideResults.has(result)) continue;
                const whole = this.cut.get(result)?.whole.length ?? result.content.length;
                const line = asideLine(result.name, whole);
                // A result shorter than its line stays as it is: setting it aside would take more room
                if (line.length >= result.content.length) continue;
                result.content = line;
                this.setAsideResults.add(result);
                changed = true;
            }
        }
        return changed;
    }

    private fit(step: ReplyStep, room: number): boolean {
        // Shortest first, so the room a short result leaves goes to the longer ones
        const cuts = step.results
            .map((result) => ({ result, cut: this.cut.get(result) ?? { whole: result.content, kept: result.content.length } }))
            .sort((a, b) => a.cut.kept - b.cut.kept);
        let left = room;
        let changed = false;
        cuts.forEach(({ result, cut }, i) => {
            const each = Math.max(1, Math.floor(left / (cuts.length - i)));
            left = Math.max(0, left - Math.min(cut.kept, each));
            if (cut.kept <= each) return;
            const kept = clipped(cut.whole, each);
            result.content = `${kept}${cutNote(kept.length, cut.whole.length)}`;
            this.cut.set(result, { whole: cut.whole, kept: kept.length });
            changed = true;
        });
        return changed;
    }
}
