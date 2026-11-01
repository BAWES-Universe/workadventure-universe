// Stand-in for speech synthesis until speaking lands: a generated tone shaped like syllables, 24 kHz mono, no files and
// no provider. The pitch comes from the text, so two different sentences sound different; the length follows the text.
import { createHash } from 'node:crypto';
import { FRAME_MS, frameBytes } from './audioFormat.ts';

export const TTS_RATE = 24000;
const MS_PER_CHAR = 65;
const SYLLABLES_PER_SECOND = 4;

export class FakeSpeech {
    /** Samples in one 20 ms frame. */
    readonly frameSamples = (TTS_RATE * FRAME_MS) / 1000;
    /** Bytes in one 20 ms frame: 24 kHz mono s16 gives 960, never 1920. */
    readonly frameBytes = frameBytes(TTS_RATE, 1, 2, FRAME_MS);

    durationMs(text: string): number {
        return Math.max(400, Math.round((MS_PER_CHAR * [...text].length) / FRAME_MS) * FRAME_MS);
    }

    synth(text: string): Int16Array {
        const samples = (this.durationMs(text) / FRAME_MS) * this.frameSamples;
        const pitch = 140 + (createHash('sha1').update(text, 'utf8').digest().readUInt16BE(0) % 160);
        const out = new Int16Array(samples);
        let phase = 0;
        for (let i = 0; i < samples; i++) {
            const t = i / TTS_RATE;
            // Syllables: a raised cosine that goes quiet between them, so the frames are not constant
            const envelope = 0.5 - 0.5 * Math.cos(2 * Math.PI * SYLLABLES_PER_SECOND * t);
            phase += (2 * Math.PI * pitch) / TTS_RATE;
            out[i] = Math.round(9000 * envelope * (Math.sin(phase) + 0.4 * Math.sin(2 * phase)));
        }
        return out;
    }
}
