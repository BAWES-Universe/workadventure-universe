// Speaking with Cartesia (#1748): one streamed request per reply to /tts/bytes, asking for raw 24 kHz mono s16 PCM so the
// audio plays as it arrives with nothing to decode. The key goes in the Authorization header of that one request and
// nowhere else.
import { ProviderError, type SpeechConnector, type SpeechRequest } from './connectors.ts';
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
    private readonly version: string;

    constructor(options: CartesiaOptions = {}) {
        this.version = options.version || DEFAULT_CARTESIA_VERSION;
    }

    async *speak(request: SpeechRequest): AsyncGenerator<Int16Array> {
        const { settings } = request;
        const base = (settings.endpoint || CARTESIA_ENDPOINT).replace(/\/+$/, '');
        const body: Record<string, unknown> = {
            model_id: settings.model,
            transcript: request.text,
            voice: { id: settings.voiceId },
            output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
        };
        const lang = request.lang ?? settings.language;
        if (lang) body.language = lang.split(/[-_]/)[0].toLowerCase();
        const emotion = request.expression ? EMOTION[request.expression] : undefined;
        if (emotion && TAKES_GENERATION_CONFIG.test(settings.model)) body.generation_config = { emotion };

        let response: Response;
        try {
            response = await fetch(`${base}/tts/bytes`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${settings.key.reveal()}`,
                    'cartesia-version': this.version,
                    'content-type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: request.signal,
            });
        } catch {
            if (request.signal.aborted) return;
            throw new ProviderError('cartesia could not be reached');
        }
        if (!response.ok || !response.body) {
            await response.body?.cancel().catch(() => undefined);
            throw new ProviderError('cartesia refused the reply', response.status);
        }

        // Samples are two bytes; a chunk can end half-way through one, so that byte waits for the next chunk
        let carry: Uint8Array | undefined;
        try {
            for await (const piece of response.body as AsyncIterable<Uint8Array>) {
                if (request.signal.aborted) return;
                let bytes = piece;
                if (carry) {
                    bytes = new Uint8Array(carry.length + piece.length);
                    bytes.set(carry);
                    bytes.set(piece, carry.length);
                    carry = undefined;
                }
                const even = bytes.length - (bytes.length % 2);
                if (even < bytes.length) carry = bytes.slice(even);
                if (even === 0) continue;
                // Copied into an aligned buffer: Int16Array needs an even offset
                const samples = new Int16Array(even / 2);
                new Uint8Array(samples.buffer).set(bytes.subarray(0, even));
                yield samples;
            }
        } catch {
            if (request.signal.aborted) return;
            throw new ProviderError('cartesia stream dropped');
        }
    }
}
