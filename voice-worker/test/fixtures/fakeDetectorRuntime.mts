// Stands in for src/speechObserverRuntime.ts in test/speechObserverCheck.test.ts: a detector that answers every window
// with FAKE_DETECTOR_PROBABILITY (0.9 unless set, so it takes silence for speech).
import { type DetectorModel, STATE } from '../../src/speechObserver.ts';

export const sileroLoader = () => async (): Promise<DetectorModel> => {
    const probability = Number(process.env.FAKE_DETECTOR_PROBABILITY ?? 0.9);
    const answer = () => ({ probability, state: new Float32Array(STATE) });
    return { run: async () => answer(), runMany: async (items) => items.map(answer), release: async () => undefined };
};
