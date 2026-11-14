/**
 * Reads the events Orbit sends for a computer's turn (Server-Sent Events: `event: <type>` and one JSON `data:` line, `:` comment lines
 * for keep-alive). A stream that closes without a `completed` or `failed` event ends with a `failed` one (`stream_ended`), so a reader
 * always sees how a turn ended. Only the fields the runner uses are read; anything else is left out.
 */
import type { RunnerEvent } from './ComputerRunner';

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
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
                ...(typeof body.label === 'string' ? { label: text(body.label, 200) } : {}),
                ...(count(body.durationMs) !== null ? { durationMs: count(body.durationMs) as number } : {}),
                ...(typeof body.error === 'string' ? { error: text(body.error, 300) } : {}),
            };
        }
        case 'completed': {
            const usage = body.usage && typeof body.usage === 'object' ? (body.usage as Record<string, unknown>) : null;
            return { type: 'completed', outputText: text(body.outputText, 200_000), usage: usage ? { inputTokens: count(usage.inputTokens), outputTokens: count(usage.outputTokens) } : null };
        }
        case 'failed':
            return { type: 'failed', code: text(body.code, 60) || 'failed', message: text(body.message, 300) };
        default:
            return null;
    }
}

export async function* readRunnerEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RunnerEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let data: string[] = [];
    let ended = false;
    const frame = (): RunnerEvent | null => {
        const event = data.length > 0 ? runnerEventOf(data.join('\n')) : null;
        data = [];
        return event;
    };
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
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
                }
            }
        }
        const rest = pending.replace(/\r$/, '');
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
