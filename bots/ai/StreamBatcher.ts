/**
 * StreamBatcher — throttles streaming token delivery to the frontend.
 *
 * Default batching interval is 100ms as specified in Issue #216.
 * Chunks accumulate in a buffer and flush when the timer expires,
 * the stream resets (tool calls), or the stream completes.
 */

export interface BatchStreamState {
    buffer: string;
    timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_INTERVAL_MS = 100;

export function createBatchState(): BatchStreamState {
    return { buffer: '', timer: null };
}

/** Append text to the batch buffer; schedules a flush after intervalMs of silence. */
export function batchAppend(
    state: BatchStreamState,
    text: string,
    send: (batchedText: string) => void,
    intervalMs: number = DEFAULT_INTERVAL_MS
): void {
    state.buffer += text;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
        if (state.buffer) {
            send(state.buffer);
            state.buffer = '';
        }
        state.timer = null;
    }, intervalMs);
}

/** Force-flush any pending batched text immediately. */
export function batchFlush(
    state: BatchStreamState,
    send: (batchedText: string) => void
): void {
    if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    if (state.buffer) {
        send(state.buffer);
        state.buffer = '';
    }
}
