// Silero VAD (pinned ONNX model) for Node, on either runtime: the native CPU package (onnxruntime-node) or the
// WASM build (onnxruntime-web, single thread). One shared session; each stream keeps its own recurrent state, its
// own 64-sample context and its own sample FIFO, so any frame size can be fed (20 ms from a peer lane, 10 ms from a
// LiveKit room, or anything else) and the model always sees the same 512-sample windows.
import { readFileSync } from 'node:fs';

export type Runtime = 'native' | 'wasm';

export const WINDOW = 512; // samples at 16 kHz: 32 ms
export const WINDOW_MS = 32;
const CONTEXT = 64;
const STATE = 2 * 1 * 128;

interface Ort {
    InferenceSession: { create(model: Uint8Array, options?: Record<string, unknown>): Promise<Session> };
    Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => unknown;
    env?: { wasm?: { numThreads?: number } };
}
interface Session {
    run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
    release?(): Promise<void>;
}

export class SileroModel {
    private constructor(private readonly ort: Ort, private readonly session: Session, private readonly sr: unknown, readonly runtime: Runtime) {}

    static async load(modelPath: string, runtime: Runtime): Promise<SileroModel> {
        const bytes = readFileSync(modelPath);
        let ort: Ort;
        let options: Record<string, unknown>;
        if (runtime === 'native') {
            ort = (await import('onnxruntime-node')) as unknown as Ort;
            // One thread: the worker's media loop must never be starved by a thread pool
            options = { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential' };
        } else {
            ort = (await import('onnxruntime-web')) as unknown as Ort;
            if (ort.env?.wasm) ort.env.wasm.numThreads = 1;
            options = { executionProviders: ['wasm'] };
        }
        const session = await ort.InferenceSession.create(bytes, options);
        const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
        return new SileroModel(ort, session, sr, runtime);
    }

    stream(): SileroStream {
        return new SileroStream(this);
    }

    /** One 512-sample window with its 64 samples of context. Returns the speech probability and the next state. */
    async infer(input: Float32Array, state: Float32Array): Promise<{ prob: number; state: Float32Array }> {
        const out = await this.session.run({
            input: new this.ort.Tensor('float32', input, [1, CONTEXT + WINDOW]),
            state: new this.ort.Tensor('float32', state, [2, 1, 128]),
            sr: this.sr,
        });
        return { prob: out.output.data[0], state: Float32Array.from(out.stateN.data) };
    }
}

/** One person's stream. Feed int16 PCM of any length; get one probability per full 512-sample window, in order. */
export class SileroStream {
    private state: Float32Array = new Float32Array(STATE);
    private context: Float32Array = new Float32Array(CONTEXT);
    private fifo: Float32Array = new Float32Array(WINDOW);
    private filled = 0;
    private chain: Promise<unknown> = Promise.resolve();

    constructor(private readonly model: SileroModel) {}

    /** Probabilities for the windows completed by this audio. Calls are serialized per stream. */
    push(pcm: Int16Array): Promise<number[]> {
        const next = this.chain.then(() => this.take(pcm));
        this.chain = next.catch(() => undefined);
        return next;
    }

    private async take(pcm: Int16Array): Promise<number[]> {
        const probs: number[] = [];
        let at = 0;
        while (at < pcm.length) {
            const n = Math.min(WINDOW - this.filled, pcm.length - at);
            for (let i = 0; i < n; i++) this.fifo[this.filled + i] = pcm[at + i] / 32768;
            this.filled += n;
            at += n;
            if (this.filled === WINDOW) {
                const input = new Float32Array(CONTEXT + WINDOW);
                input.set(this.context);
                input.set(this.fifo, CONTEXT);
                const { prob, state } = await this.model.infer(input, this.state);
                this.state = state;
                this.context = input.slice(WINDOW);
                this.filled = 0;
                probs.push(prob);
            }
        }
        return probs;
    }

    /** After missing audio or a new path: old state must not colour what comes next. */
    reset(): void {
        this.state = new Float32Array(STATE);
        this.context = new Float32Array(CONTEXT);
        this.filled = 0;
    }
}
