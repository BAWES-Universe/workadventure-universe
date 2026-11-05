export const FRAME_MS = 20;

/** Chunk bytes = sample rate x channels x bytes per sample x duration. */
export const frameBytes = (sampleRate: number, channels: number, bytesPerSample: number, ms: number): number =>
    Math.round((sampleRate * channels * bytesPerSample * ms) / 1000);

/** Bot speech is 24 kHz mono s16, whatever the provider: a connector hands over exactly this. */
export const TTS_RATE = 24000;
/** Samples in one 20 ms frame of bot speech. */
export const TTS_FRAME_SAMPLES = (TTS_RATE * FRAME_MS) / 1000;
