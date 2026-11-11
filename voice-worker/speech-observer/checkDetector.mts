// What speech-observer/check.mts decides, kept apart so a test can hand it a detector made in the test.
import type { DetectorModel } from '../src/speechObserver.ts';
import { CONTEXT, STATE, WINDOW } from '../src/speechObserver.ts';

export interface DetectorCheck {
    ok: boolean;
    /** Why it is not ok, one line each; empty when it is. */
    failures: string[];
    silenceProbability: number;
}

/** One answer for silence from each way of calling the detector: it must be a probability, call it silence, and agree. */
export async function checkDetector(model: DetectorModel): Promise<DetectorCheck> {
    const silence = () => ({ input: new Float32Array(CONTEXT + WINDOW), state: new Float32Array(STATE) });
    const failures: string[] = [];
    const one = await model.run(silence().input, silence().state);
    const p = one.probability;
    if (!(p >= 0 && p <= 1)) failures.push(`one call: not a probability (${p})`);
    else if (p >= 0.5) failures.push(`one call: silence taken for speech (${p})`);
    if (one.state.length !== STATE) failures.push(`one call: state of ${one.state.length} values, not ${STATE}`);
    if (!model.runMany) failures.push('no way to call it for several people at once');
    else {
        const three = await model.runMany([silence(), silence(), silence()]);
        if (three.length !== 3) failures.push(`three at once: ${three.length} answers`);
        else if (!three.every((answer) => answer.probability === p)) failures.push(`three at once: answers differ from one call (${three.map((a) => a.probability).join(', ')} against ${p})`);
    }
    return { ok: failures.length === 0, failures, silenceProbability: Number.isFinite(p) ? Number(p.toFixed(6)) : p };
}
