export const FRAME_MS = 20;

/** Chunk bytes = sample rate x channels x bytes per sample x duration. */
export const frameBytes = (sampleRate: number, channels: number, bytesPerSample: number, ms: number): number =>
    Math.round((sampleRate * channels * bytesPerSample * ms) / 1000);
