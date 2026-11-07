// Speaking with Cartesia (#1748), on the shared kit (#1883): one streamed request per reply to /tts/bytes, asking for raw 24 kHz mono s16 PCM so the
// audio plays as it arrives with nothing to decode. The key goes in the Authorization header of that one request and
// nowhere else.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';
import { socketHearing } from './kit/socketHearing.ts';
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

/** Cartesia's real-time listening socket (https://docs.cartesia.ai/api-reference/stt/stt). */
export const CARTESIA_HEARING_ENDPOINT = 'wss://api.cartesia.ai';
/** `language` is taken only by ink-whisper; the newer Ink models detect it. */
const TAKES_LANGUAGE = /^ink-whisper/;

interface CartesiaAnswer {
    type?: unknown;
    text?: unknown;
    is_final?: unknown;
    status_code?: unknown;
}

/**
 * Listening with Cartesia (#1878), on the shared kit (#1883): one socket per stretch of speech, 16 kHz s16 audio as binary frames,
 * the key in the X-API-Key header of that one connection. Each transcript is a piece of text: final pieces are kept as they come
 * (they carry their own spaces), the latest other one shows until it is final. "close" ends the audio: Cartesia sends the last
 * words, then `done`. Cartesia has no end-of-speech signal of its own, so the worker's own pause ends a stretch.
 */
export class CartesiaRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: CartesiaOptions & { finalTimeoutMs?: number } = {}) {
        const version = options.version || DEFAULT_CARTESIA_VERSION;
        this.connector = socketHearing({
            adapter: CARTESIA_ADAPTER,
            endpoint: CARTESIA_HEARING_ENDPOINT,
            connect: (settings, base) => {
                const query = new URLSearchParams({ model: settings.model, encoding: 'pcm_s16le', sample_rate: '16000', cartesia_version: version });
                if (settings.language && TAKES_LANGUAGE.test(settings.model)) query.set('language', baseLanguage(settings.language));
                return { url: `${base}/stt/websocket?${query}`, headers: { 'X-API-Key': settings.key.reveal() } };
            },
            finish: () => ['close'],
            // Glued with no space on purpose: each final `text` is a delta from the last final chunk and carries its own spaces.
            // Cartesia: "Do not strip whitespace from `text` or add whitespace between chunks as this will produce an incorrect
            // transcript." https://docs.cartesia.ai/api-reference/stt/stt
            join: 'tokens',
            finalTimeoutMs: options.finalTimeoutMs,
            read: (data, isBinary) => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as CartesiaAnswer;
                if (typeof answer !== 'object' || answer === null) return undefined;
                if (answer.type === 'error') return { error: { status: typeof answer.status_code === 'number' ? answer.status_code : undefined } };
                if (answer.type === 'done') return { finished: true };
                if (answer.type !== 'transcript' || typeof answer.text !== 'string') return undefined;
                return answer.is_final === true ? { committed: answer.text } : { interim: answer.text };
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}
