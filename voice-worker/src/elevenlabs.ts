// Speaking with ElevenLabs (#1748): one streamed request per reply, asking for raw 24 kHz mono PCM so the audio plays as
// it arrives with nothing to decode. The key goes in the xi-api-key header of that one request and nowhere else.
import { ProviderError, type SpeechConnector, type SpeechRequest } from './connectors.ts';
import type { Expression } from './protocol.ts';

export const ELEVENLABS_ADAPTER = 'elevenlabs';
export const ELEVENLABS_ENDPOINT = 'https://api.elevenlabs.io';

/**
 * How steady the voice is for each expression the maker can pick. Lower is livelier. "natural" sends nothing, so the
 * voice's own saved settings apply.
 */
const STABILITY: Partial<Record<Expression, number>> = { restrained: 0.75, expressive: 0.3 };

/** Models that take no language_code (ElevenLabs refuses it for them). */
const NO_LANGUAGE_CODE = /multilingual_v2|monolingual|english_v1/;

export class ElevenLabsSpeech implements SpeechConnector {
    async *speak(request: SpeechRequest): AsyncGenerator<Int16Array> {
        const { settings } = request;
        const base = (settings.endpoint || ELEVENLABS_ENDPOINT).replace(/\/+$/, '');
        const url = `${base}/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}/stream?output_format=pcm_24000`;
        const body: Record<string, unknown> = { text: request.text, model_id: settings.model };
        const lang = request.lang ?? settings.language;
        if (lang && !NO_LANGUAGE_CODE.test(settings.model)) body.language_code = lang.split(/[-_]/)[0].toLowerCase();
        const stability = request.expression ? STABILITY[request.expression] : undefined;
        if (stability !== undefined) body.voice_settings = { stability };

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'xi-api-key': settings.key.reveal(), 'content-type': 'application/json', accept: 'audio/pcm' },
                body: JSON.stringify(body),
                signal: request.signal,
            });
        } catch {
            if (request.signal.aborted) return;
            throw new ProviderError('elevenlabs could not be reached');
        }
        if (!response.ok || !response.body) {
            await response.body?.cancel().catch(() => undefined);
            throw new ProviderError('elevenlabs refused the reply', response.status);
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
            throw new ProviderError('elevenlabs stream dropped');
        }
    }
}
