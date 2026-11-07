// Speaking with Cartesia (#1748), on the shared kit (#1883): one streamed request per reply to /tts/bytes, asking for raw 24 kHz mono s16 PCM so the
// audio plays as it arrives with nothing to decode. The key goes in the Authorization header of that one request and
// nowhere else.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE } from './kit/httpSpeech.ts';
import { baseLanguage } from './kit/signIn.ts';
import type { Expression } from './protocol.ts';

export const CARTESIA_ADAPTER = 'cartesia';
export const CARTESIA_ENDPOINT = 'https://api.cartesia.ai';
/** The API version every request names. Cartesia changes request shapes between versions, so it is pinned (VOICE_CARTESIA_VERSION). */
export const DEFAULT_CARTESIA_VERSION = '2026-08-14';

/**
 * The emotion sent for each expression the maker can pick. Left out, Cartesia reads the emotion from the words
 * themselves, which is what "natural" and "expressive" want: forcing one lively emotion would also brighten a sad reply.
 * "restrained" holds the voice calm whatever the words say.
 */
const EMOTION: Partial<Record<Expression, string>> = { restrained: 'calm' };

/** Models that take generation_config (Sonic 3 and newer). Older ones refuse it. */
const TAKES_GENERATION_CONFIG = /^sonic-(?:[3-9]|latest)/;

export interface CartesiaOptions {
    version?: string;
}

export class CartesiaSpeech implements SpeechConnector {
    private readonly connector: SpeechConnector;

    constructor(options: CartesiaOptions = {}) {
        const version = options.version || DEFAULT_CARTESIA_VERSION;
        this.connector = httpSpeech({
            adapter: CARTESIA_ADAPTER,
            endpoint: CARTESIA_ENDPOINT,
            audio: { kind: 'raw', sampleRate: SPEECH_RATE },
            call: (request) => {
                const { settings } = request;
                const body: Record<string, unknown> = {
                    model_id: settings.model,
                    transcript: request.text,
                    voice: { id: settings.voiceId },
                    output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: SPEECH_RATE },
                };
                const lang = request.lang ?? settings.language;
                if (lang) body.language = baseLanguage(lang);
                const emotion = request.expression ? EMOTION[request.expression] : undefined;
                if (emotion && TAKES_GENERATION_CONFIG.test(settings.model)) body.generation_config = { emotion };
                return {
                    url: '/tts/bytes',
                    headers: { authorization: `Bearer ${settings.key.reveal()}`, 'cartesia-version': version, 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                };
            },
        });
    }

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
