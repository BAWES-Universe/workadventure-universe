// Speaking with Neuphonic (#1898), on the shared kit (#1883): one streamed request per reply to Neuphonic's
// /sse/speak/{language}, as Pipecat's NeuphonicHttpTTSService does. https://docs.neuphonic.com
//
// The key goes in the X-API-KEY header of that one request and nowhere else. The answer is server-sent events, each holding
// base64 s16 PCM in data.audio at the rate asked for (24 kHz, the worker's own); a failure comes as an event with "errors".
// Neuphonic has no model to pick (the voice sets it). It speaks one language a request, named in the address.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE, type AudioFrame } from './kit/httpSpeech.ts';
import { baseLanguage } from './kit/signIn.ts';

export const NEUPHONIC_ADAPTER = 'neuphonic';
export const NEUPHONIC_ENDPOINT = 'https://api.neuphonic.com';

/** The languages Neuphonic speaks (Pipecat's list); any other is spoken as English. */
const LANGUAGES = new Set(['ar', 'de', 'en', 'es', 'fr', 'hi', 'nl', 'pt', 'ru', 'zh']);

/** Neuphonic's code for a reply's language: its base language when Neuphonic speaks it, else English. */
export function neuphonicLanguage(language: string | undefined): string {
    const base = language ? baseLanguage(language) : '';
    return LANGUAGES.has(base) ? base : 'en';
}

interface NeuphonicEvent {
    data?: { audio?: unknown; stop?: unknown };
    errors?: unknown;
    status_code?: unknown;
}

export class NeuphonicSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: NEUPHONIC_ADAPTER,
        endpoint: NEUPHONIC_ENDPOINT,
        audio: {
            kind: 'lines',
            sampleRate: SPEECH_RATE,
            encoding: 'base64',
            read: (message: unknown): AudioFrame | undefined => {
                if (typeof message !== 'object' || message === null) return undefined;
                const event = message as NeuphonicEvent;
                if (event.errors !== undefined && event.errors !== null) {
                    const status = typeof event.status_code === 'number' && event.status_code >= 400 && event.status_code < 600 ? event.status_code : undefined;
                    return { error: { status } };
                }
                const audio = event.data?.audio;
                return {
                    audio: typeof audio === 'string' && audio ? audio : undefined,
                    done: event.data?.stop === true,
                };
            },
        },
        call: (request: SpeechRequest) => {
            const language = neuphonicLanguage(request.lang || request.settings.language);
            const voice = request.settings.voiceId;
            return {
                url: `/sse/speak/${language}`,
                headers: {
                    'X-API-KEY': request.settings.key.reveal(),
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    text: request.text,
                    lang_code: language,
                    encoding: 'pcm_linear',
                    sampling_rate: SPEECH_RATE,
                    // No voice picked: Neuphonic's own default for the language
                    ...(voice ? { voice_id: voice } : {}),
                }),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
