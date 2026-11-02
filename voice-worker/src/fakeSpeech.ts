// The test speech engine: a generated tone shaped like syllables, 24 kHz mono, no files and no provider. The pitch comes
// from the text, so two different sentences sound different; the length follows the text. It is a SpeechConnector like
// any provider's, registered under the adapter name "fake", and it is what a bubble gets when it names no provider.
import { createHash } from 'node:crypto';
import { FRAME_MS, TTS_FRAME_SAMPLES, TTS_RATE, frameBytes } from './audioFormat.ts';
import { type SpeechConnector, type SpeechRequest, type SpeechSettings, Secret } from './connectors.ts';

export { TTS_RATE };

/** The name the test engine is registered under. */
export const FAKE_ADAPTER = 'fake';
/** What the test engine is handed when the bubble names no provider. It ignores all of it. */
export const FAKE_SPEECH_SETTINGS: SpeechSettings = { adapter: FAKE_ADAPTER, model: 'fake', voiceId: 'fake', key: new Secret('') };
/** How much audio the test engine hands over at a time: ten frames, so a reply arrives in pieces like a provider's stream. */
const CHUNK_FRAMES = 10;
const MS_PER_CHAR = 65;
const SYLLABLES_PER_SECOND = 4;

export class FakeSpeech implements SpeechConnector {
    /** Samples in one 20 ms frame. */
    readonly frameSamples = TTS_FRAME_SAMPLES;
    /** Bytes in one 20 ms frame: 24 kHz mono s16 gives 960, never 1920. */
    readonly frameBytes = frameBytes(TTS_RATE, 1, 2, FRAME_MS);

    durationMs(text: string): number {
        return Math.max(400, Math.round((MS_PER_CHAR * [...text].length) / FRAME_MS) * FRAME_MS);
    }

    /** The reply in pieces, the way a provider's stream arrives. */
    async *speak(request: SpeechRequest): AsyncGenerator<Int16Array> {
        const whole = this.synth(request.text);
        const chunk = CHUNK_FRAMES * this.frameSamples;
        for (let offset = 0; offset < whole.length; offset += chunk) {
            if (request.signal.aborted) return;
            yield whole.subarray(offset, offset + chunk);
        }
    }

    /** The whole reply at once. */
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
