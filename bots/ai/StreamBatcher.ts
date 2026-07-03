/**
 * StreamBatcher — throttles streaming token delivery to the frontend.
 *
 * Default batching interval is 10ms as specified in Issue #216.
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
/** Default batching interval — 10ms for near-instant, word-by-word feel. */
export const BATCH_INTERVAL_MS = 10;

/** Append text to the batch buffer; flushes every intervalMs on a fixed cadence. */
export function batchAppend(
    state: BatchStreamState,
    text: string,
    send: (batchedText: string) => void,
    intervalMs: number = BATCH_INTERVAL_MS
): void {
    state.buffer += text;
    // Set timer only once per batch window — don't reset on every chunk
    // so the first visible content reaches the frontend quickly (~intervalMs)
    // instead of being delayed by N chunks × gap + intervalMs.
    if (!state.timer) {
        state.timer = setTimeout(() => {
            if (state.buffer) {
                send(state.buffer);
                state.buffer = '';
            }
            state.timer = null;
        }, intervalMs);
    }
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
