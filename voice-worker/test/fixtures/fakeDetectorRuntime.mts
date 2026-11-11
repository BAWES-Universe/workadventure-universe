// Stands in for src/speechObserverRuntime.ts in one test: a detector that takes silence for speech.
import { type DetectorModel, STATE } from '../../src/speechObserver.ts';

export const sileroLoader = () => async (): Promise<DetectorModel> => {
    const answer = () => ({ probability: 0.9, state: new Float32Array(STATE) });
    return { run: async () => answer(), runMany: async (items) => items.map(answer), release: async () => undefined };
};
