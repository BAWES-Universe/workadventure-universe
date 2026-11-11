// How the speech observer's detector is run for real: the Silero model on the ONNX Runtime's native CPU build.
// Nothing here is loaded unless the observer is switched on (config.ts): the runtime is only looked for when asked.
//
// The runtime's native library reports usage to its maker unless ORT_DISABLE_TELEMETRY=1 is in the environment BEFORE it
// starts. So the detector refuses to load unless the worker was started with it: no switch here, no reporting.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { CONTEXT, type DetectorLoader, STATE, WINDOW } from './speechObserver.ts';

/** silero_vad.onnx of Silero VAD v6.2.3 (MIT). Any other file is refused. */
export const SILERO_SHA256 = '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3';

interface Ort {
    InferenceSession: { create(model: Uint8Array, options?: Record<string, unknown>): Promise<OrtSession> };
    Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => unknown;
}
interface OrtSession {
    run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
    release?(): Promise<void>;
}

export function sileroLoader(settings: { modelPath: string; runtime?: string; env?: NodeJS.ProcessEnv }): DetectorLoader {
    return async () => {
        if ((settings.env ?? process.env).ORT_DISABLE_TELEMETRY !== '1') throw new Error('the worker was not started with ORT_DISABLE_TELEMETRY=1');
        const bytes = await readFile(settings.modelPath);
        if (createHash('sha256').update(bytes).digest('hex') !== SILERO_SHA256) throw new Error('not the pinned Silero model');
        const ort = createRequire(import.meta.url)(settings.runtime || 'onnxruntime-node') as Ort;
        // One thread, one call at a time: the detector may never take more than one core from the worker's audio
        const session = await ort.InferenceSession.create(bytes, { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential' });
        const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
        return {
            run: async (input, state) => {
                const out = await session.run({ input: new ort.Tensor('float32', input, [1, CONTEXT + WINDOW]), state: new ort.Tensor('float32', state, [2, 1, 128]), sr });
                return { probability: out.output.data[0], state: out.stateN.data };
            },
            // The model takes any number of people at once: its input is [people, samples] and its state [2, people, 128]
            runMany: async (windows) => {
                const n = windows.length;
                const half = STATE / 2;
                const input = new Float32Array(n * (CONTEXT + WINDOW));
                const state = new Float32Array(n * STATE);
                windows.forEach((w, i) => {
                    input.set(w.input, i * (CONTEXT + WINDOW));
                    state.set(w.state.subarray(0, half), i * half);
                    state.set(w.state.subarray(half), (n + i) * half);
                });
                const out = await session.run({ input: new ort.Tensor('float32', input, [n, CONTEXT + WINDOW]), state: new ort.Tensor('float32', state, [2, n, half]), sr });
                const next = out.stateN.data;
                if (out.output.data.length !== n || next.length !== n * STATE) throw new Error('the detector answered for a different number of people');
                return windows.map((_, i) => {
                    const own = new Float32Array(STATE);
                    own.set(next.subarray(i * half, (i + 1) * half));
                    own.set(next.subarray((n + i) * half, (n + i + 1) * half), half);
                    return { probability: out.output.data[i], state: own };
                });
            },
            release: async () => {
                await session.release?.();
            },
        };
    };
}
