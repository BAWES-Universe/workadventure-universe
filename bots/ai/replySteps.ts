/**
 * A reply keeps its own steps (#1508): each round of tool calls goes back to the model as the chat messages providers
 * already know (what it said and called, then what came back), after the person's message, so step five still sees
 * what step one found. Steps are only ever added at the end, so the provider keeps matching what it read before; when
 * their results pass "Room for tool results in one reply", the older ones are set aside to a line, once, and adding
 * goes on.
 */
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
        const result = results[i];
        if (!result) return;
        const id = call.id || `call_${round}_${i}`;
        paired.calls.push({ id, name: call.name, arguments: call.arguments || '{}' });
        paired.results.push({ id, name: result.name, content: result.text });
    });
    return paired;
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

function sizeOf(step: ReplyStep): number {
    return step.results.reduce((total, result) => total + result.content.length, 0);
}

/** Text up to `max` characters, never ending in half an emoji. */
function clipped(text: string, max: number): string {
    if (text.length <= max) return text;
    const end = /[\uD800-\uDBFF]/.test(text[max - 1] ?? '') ? max - 1 : max;
    return text.slice(0, Math.max(0, end));
}

type StepResult = ReplyStep['results'][number];

/**
 * The steps of one reply within "Room for tool results in one reply". Adding a step that would pass it sets the older
 * results aside to one line each, once, and adding goes on; a single step larger than the room keeps as much of each
 * result as fits, saying so.
 */
export class StepRoom {
    readonly steps: ReplyStep[] = [];
    /** Each cut result's whole text and how much of it is kept, so cutting again cuts the text and not its note. */
    private readonly cut = new WeakMap<StepResult, { whole: string; kept: number }>();
    private readonly setAsideResults = new WeakSet<StepResult>();

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
     * The model turned the steps down for length: set the older results aside, or when there are none left, keep half
     * of what the newest step still has. False when nothing more can be made smaller.
     */
    makeRoom(): boolean {
        if (this.setAside(this.steps.slice(0, -1))) return true;
        const newest = this.steps.at(-1);
        if (!newest) return false;
        const kept = newest.results.reduce((total, result) => total + (this.cut.get(result)?.kept ?? result.content.length), 0);
        return this.fit(newest, Math.floor(kept / 2));
    }

    private setAside(steps: ReplyStep[]): boolean {
        let changed = false;
        for (const step of steps) {
            for (const result of step.results) {
                if (this.setAsideResults.has(result)) continue;
                const whole = this.cut.get(result)?.whole.length ?? result.content.length;
                result.content = `[${result.name}: ${whole.toLocaleString('en-US')} characters, set aside to make room. Call it again if you need it.]`;
                this.setAsideResults.add(result);
                changed = true;
            }
        }
        return changed;
    }

    private fit(step: ReplyStep, room: number): boolean {
        const each = Math.max(1, Math.floor(room / Math.max(1, step.results.length)));
        let changed = false;
        for (const result of step.results) {
            const cut = this.cut.get(result) ?? { whole: result.content, kept: result.content.length };
            if (cut.kept <= each) continue;
            const kept = clipped(cut.whole, each);
            result.content = `${kept}\n[Only the first ${kept.length.toLocaleString('en-US')} of ${cut.whole.length.toLocaleString('en-US')} characters fit in this reply's room for tool results ("Room for tool results in one reply").]`;
            this.cut.set(result, { whole: cut.whole, kept: kept.length });
            changed = true;
        }
        return changed;
    }
}
