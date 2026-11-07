// Speaking with Speechify (#1905), on the shared kit (#1883): one streamed request per reply to Speechify's
// /v1/audio/stream/with-timestamps, as Pipecat's SpeechifyHttpTTSService does. https://docs.speechify.ai
//
// The key goes as a bearer in that one request and nowhere else. The answer is server-sent events whose data names its own
// type: speech.chunk holds base64 s16 PCM at the rate asked for (24 kHz, the worker's own), speech.done ends the reply and
// speech.error is a failure after the stream began. The API version is pinned, as Pipecat pins it, so a workspace's own default
// never changes what comes back.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE, type AudioFrame } from './kit/httpSpeech.ts';
import { baseLanguage } from './kit/signIn.ts';

export const SPEECHIFY_ADAPTER = 'speechify';
export const SPEECHIFY_ENDPOINT = 'https://api.speechify.ai';
export const SPEECHIFY_API_VERSION = '2026-09-30';

/** Pipecat's default model and voice, used when a bot names none. */
const DEFAULT_MODEL = 'simba-3.5';
const DEFAULT_VOICE = 'geffen_32';

/** Speechify takes at most 20,000 spoken characters a request. */
const MAX_TEXT = 20000;

/** The locales Pipecat names for Speechify; Simba 3.0 speaks exactly these. */
const LOCALES: Record<string, string> = { de: 'de-DE', en: 'en-US', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-BR' };

/**
 * The locale to send for a reply, or none: then Speechify speaks in the voice's own language. Simba 3.2 speaks English only,
 * so it is never sent a language.
 */
export function speechifyLanguage(language: string | undefined, model: string): string | undefined {
    if (!language || model === 'simba-3.2') return undefined;
    return LOCALES[baseLanguage(language)];
}

interface SpeechifyEvent {
    type?: unknown;
    audio?: unknown;
}

export class SpeechifySpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: SPEECHIFY_ADAPTER,
        endpoint: SPEECHIFY_ENDPOINT,
        audio: {
            kind: 'lines',
            sampleRate: SPEECH_RATE,
            encoding: 'base64',
            read: (message: unknown): AudioFrame | undefined => {
                if (typeof message !== 'object' || message === null) return undefined;
                const event = message as SpeechifyEvent;
                if (event.type === 'speech.error') return { error: {} };
                if (event.type === 'speech.done') return { done: true };
                // Speech marks alone (often the last chunk) carry no audio
                if (event.type === 'speech.chunk') return { audio: typeof event.audio === 'string' && event.audio ? event.audio : undefined };
                return undefined;
            },
        },
        call: (request: SpeechRequest) => {
            const model = request.settings.model || DEFAULT_MODEL;
            const language = speechifyLanguage(request.lang || request.settings.language, model);
            return {
                url: '/v1/audio/stream/with-timestamps',
                headers: {
                    authorization: `Bearer ${request.settings.key.reveal()}`,
                    'content-type': 'application/json',
                    'speechify-version': SPEECHIFY_API_VERSION,
                },
                body: JSON.stringify({
                    input: request.text.slice(0, MAX_TEXT),
                    voice_id: request.settings.voiceId || DEFAULT_VOICE,
                    model,
                    output_format: `pcm_${SPEECH_RATE}`,
                    ...(language ? { language } : {}),
                }),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
