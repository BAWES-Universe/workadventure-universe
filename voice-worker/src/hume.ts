// Speaking with Hume (#1885), on the shared kit (#1883): Octave, one streamed request per reply to Hume's /v0/tts/stream/json, as
// Pipecat's HumeTTSService does (instant mode, raw PCM). https://dev.hume.ai/docs/text-to-speech-tts/overview
//
// The key goes in the X-Hume-Api-Key header of that one request and nowhere else. The answer is one JSON object a line: an
// "audio" chunk holds base64 48 kHz s16 PCM. Hume may split the text into several snippets, each with its own last chunk, so
// the reply ends when the stream does, as in Pipecat. The model picks Octave's version ("octave-2" is 2).
// Hume needs a voice for instant mode; with none picked, Hume chooses one and instant mode is off.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, type AudioFrame } from './kit/httpSpeech.ts';

export const HUME_ADAPTER = 'hume';
export const HUME_ENDPOINT = 'https://api.hume.ai';
/** Hume streams PCM at this rate. */
export const HUME_SAMPLE_RATE = 48_000;

/** Octave's version for a model: "octave-2" is "2", and a model Hume names by number is that number. */
export function octaveVersion(model: string): string | undefined {
    const number = /^(?:octave-?)?(\d+)$/i.exec(model)?.[1];
    return number;
}

export class HumeSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: HUME_ADAPTER,
        endpoint: HUME_ENDPOINT,
        audio: {
            kind: 'lines',
            sampleRate: HUME_SAMPLE_RATE,
            encoding: 'base64',
            // Asked for raw PCM without headers; one is skipped rather than played as a click if Hume sends it anyway
            mayStartWithWav: true,
            read: (message: unknown): AudioFrame | undefined => {
                if (typeof message !== 'object' || message === null) return undefined;
                const chunk = message as { type?: unknown; audio?: unknown };
                if (chunk.type !== 'audio') return undefined;
                return { audio: typeof chunk.audio === 'string' && chunk.audio ? chunk.audio : undefined };
            },
        },
        call: (request) => {
            const voice = request.settings.voiceId;
            // Hume rejects version 2 without a voice: with none picked, Hume routes the request to the model that fits
            const version = voice ? octaveVersion(request.settings.model) : undefined;
            return {
                url: '/v0/tts/stream/json',
                headers: { 'X-Hume-Api-Key': request.settings.key.reveal(), 'content-type': 'application/json' },
                body: JSON.stringify({
                    utterances: [{ text: request.text, ...(voice ? { voice: { id: voice } } : {}) }],
                    format: { type: 'pcm' },
                    instant_mode: Boolean(voice),
                    strip_headers: true,
                    ...(version ? { version } : {}),
                }),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
