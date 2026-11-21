/**
 * Reads the events Orbit sends for a computer's turn (Server-Sent Events: `event: <type>` and one JSON `data:` line, `:` comment lines
 * for keep-alive). A stream that closes without a `completed` or `failed` event ends with a `failed` one (`stream_ended`), so a reader
 * always sees how a turn ended. Only the fields the runner uses are read; anything else is left out.
 */
import type { RunnerEvent } from './ComputerRunner';
import { redactSecrets, safeStepLabel } from './redactSecrets';

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
/** The end of what was said: for a reply the end is what counts (the marker that says how it ended is the last thing in it). */
const lastOf = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(-max) : '');
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);

export function runnerEventOf(data: string): RunnerEvent | null {
    let body: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(data);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        body = parsed as Record<string, unknown>;
    } catch {
        return null;
    }
    switch (body.type) {
        case 'created':
            return typeof body.id === 'string' && body.id ? { type: 'created', id: body.id.slice(0, 120), sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 80) : null } : null;
        case 'text':
            return typeof body.text === 'string' ? { type: 'text', text: body.text } : null;
        case 'tool': {
            const state = body.state;
            if (state !== 'generating' && state !== 'started' && state !== 'completed' && state !== 'failed') return null;
            return {
                type: 'tool',
                state,
                tool: text(body.tool, 80),
                // A step's label may be a raw command with the job's own key in it: only a description, with nothing secret in it, goes on
                ...(typeof body.label === 'string' ? { label: text(safeStepLabel(body.label.slice(0, 2000), text(body.tool, 80)), 200) } : {}),
                ...(count(body.durationMs) !== null ? { durationMs: count(body.durationMs) as number } : {}),
                ...(typeof body.error === 'string' ? { error: text(redactSecrets(body.error.slice(0, 2000)), 300) } : {}),
            };
        }
        case 'completed': {
            const usage = body.usage && typeof body.usage === 'object' ? (body.usage as Record<string, unknown>) : null;
            return { type: 'completed', outputText: lastOf(body.outputText, 200_000), usage: usage ? { inputTokens: count(usage.inputTokens), outputTokens: count(usage.outputTokens) } : null };
        }
        case 'failed':
            return { type: 'failed', code: text(body.code, 60) || 'failed', message: text(redactSecrets(typeof body.message === 'string' ? body.message.slice(0, 2000) : ''), 300) };
        default:
            return null;
    }
}

/** The most one line, and one whole event, may hold before the stream is dropped (a stream that never sends a newline or a blank line cannot fill memory). */
export const streamLimits = { line: 1024 * 1024, event: 4 * 1024 * 1024 };

export async function* readRunnerEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RunnerEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let data: string[] = [];
    let dataChars = 0;
    let ended = false;
    let tooBig = false;
    const frame = (): RunnerEvent | null => {
        const event = data.length > 0 ? runnerEventOf(data.join('\n')) : null;
        data = [];
        dataChars = 0;
        return event;
    };
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            if (pending.length > streamLimits.line && pending.indexOf('\n') < 0) {
                tooBig = true;
                break;
            }
            let at: number;
            while ((at = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, at).replace(/\r$/, '');
                pending = pending.slice(at + 1);
                if (line === '') {
                    const event = frame();
                    if (event) {
                        yield event;
                        if (event.type === 'completed' || event.type === 'failed') {
                            ended = true;
                            return;
                        }
                    }
                } else if (line.startsWith('data:')) {
                    data.push(line.slice(5).replace(/^ /, ''));
                    dataChars += line.length;
                    if (line.length > streamLimits.line || dataChars > streamLimits.event) {
                        tooBig = true;
                        break;
                    }
                }
            }
            // What is left has no newline: a line that is already past the bound, whatever came before it in this chunk, is too big
            if (tooBig || pending.length > streamLimits.line) {
                tooBig = true;
                break;
            }
        }
        // The last line, with no newline, counts toward the event too
        const rest = pending.replace(/\r$/, '');
        if (!tooBig && rest.startsWith('data:') && (rest.length > streamLimits.line || dataChars + rest.length > streamLimits.event)) tooBig = true;
        if (tooBig) {
            data = [];
            pending = '';
            yield { type: 'failed', code: 'stream_broke', message: 'Orbit sent an event that was too large to read' };
            return;
        }
        if (rest.startsWith('data:')) data.push(rest.slice(5).replace(/^ /, ''));
        const last = frame();
        if (last) {
            yield last;
            if (last.type === 'completed' || last.type === 'failed') ended = true;
        }
    } finally {
        reader.cancel().catch(() => undefined);
    }
    if (!ended) yield { type: 'failed', code: 'stream_ended', message: 'The connection to Orbit ended before the turn did' };
}
