// Speaking with Fish Audio (#1868): one streamed request per reply to /v1/tts, asking for raw 24 kHz mono s16 PCM so the
// audio plays as it arrives with nothing to decode. The key goes in the Authorization header of that one request and
// nowhere else. The model (`s2.1-pro`, or the free `s2.1-pro-free`) goes in the `model` header and the voice in `reference_id`.
import { ProviderError, type SpeechConnector, type SpeechRequest } from './connectors.ts';

export const FISH_ADAPTER = 'fish';
export const FISH_ENDPOINT = 'https://api.fish.audio';

/** A WAV header is 44 bytes. The docs do not say whether `pcm` carries one, so one that does is skipped rather than played as a click. */
const WAV_HEADER_BYTES = 44;

export class FishSpeech implements SpeechConnector {
    async *speak(request: SpeechRequest): AsyncGenerator<Int16Array> {
        const { settings } = request;
        const base = (settings.endpoint || FISH_ENDPOINT).replace(/\/+$/, '');
        const body: Record<string, unknown> = {
            text: request.text,
            reference_id: settings.voiceId,
            format: 'pcm',
            sample_rate: 24000,
            // Lower latency than the default, which favours quality: a reply is heard as it is made
            latency: 'balanced',
        };
        // Only used for reading numbers and dates aloud, so a base code such as `ar` is all it needs
        const lang = request.lang ?? settings.language;
        if (lang) body.language = lang.split(/[-_]/)[0].toLowerCase();

        let response: Response;
        try {
            response = await fetch(`${base}/v1/tts`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${settings.key.reveal()}`,
                    model: settings.model,
                    'content-type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: request.signal,
            });
        } catch {
            if (request.signal.aborted) return;
            throw new ProviderError('fish could not be reached');
        }
        if (!response.ok || !response.body) {
            await response.body?.cancel().catch(() => undefined);
            throw new ProviderError('fish refused the reply', response.status);
        }

        // Samples are two bytes; a chunk can end half-way through one, so that byte waits for the next chunk
        let carry: Uint8Array | undefined;
        // The start of the stream, held until there are enough bytes to tell whether a WAV header comes first
        let head: Uint8Array | undefined = new Uint8Array(0);
        try {
            for await (const piece of response.body as AsyncIterable<Uint8Array>) {
                if (request.signal.aborted) return;
                let bytes = piece;
                if (head) {
                    head = concat(head, piece);
                    if (head.length < 4) continue;
                    const riff = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
                    if (riff && head.length < WAV_HEADER_BYTES) continue;
                    bytes = riff ? head.subarray(WAV_HEADER_BYTES) : head;
                    head = undefined;
                }
                if (carry) {
                    bytes = concat(carry, bytes);
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
            throw new ProviderError('fish stream dropped');
        }
    }
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
    const out = new Uint8Array(first.length + second.length);
    out.set(first);
    out.set(second, first.length);
    return out;
}
