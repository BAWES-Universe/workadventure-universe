// Speaking with ElevenLabs (#1748, #1847): one connection per reply, asking for raw 24 kHz mono PCM so the audio plays as it
// arrives with nothing to decode. The key goes in the xi-api-key header of that one connection and nowhere else.
//
// ElevenLabs serves its models over different calls, so how a reply is asked for comes from the model, using one table
// kept in line with https://elevenlabs.io/docs/overview/models:
// - most models stream over HTTP (POST /v1/text-to-speech/{voice}/stream);
// - the real-time v3 and v4 models (eleven_v3_conversational, eleven_v4_turbo) are served only over the Text to Dialogue
//   WebSocket (/v1/text-to-dialogue/stream-input). The whole reply is sent at once and the socket is told to close, which
//   flushes it, so nothing waits for more text; a reply that is no longer wanted closes the socket.
import WebSocket from 'ws';
import { ProviderError, type SpeechConnector, type SpeechRequest } from './connectors.ts';
import type { Expression } from './protocol.ts';

export const ELEVENLABS_ADAPTER = 'elevenlabs';
export const ELEVENLABS_ENDPOINT = 'https://api.elevenlabs.io';
const OUTPUT_FORMAT = 'pcm_24000';

export interface ElevenLabsModel {
    /** How the model is served: the HTTP stream, or the Text to Dialogue WebSocket. */
    transport: 'stream' | 'dialogue';
    /**
     * Whether the model takes language_code. The old models answer 400 when it is sent (multilingual v1/v2 and the
     * English-only ones); every newer one takes it, and ignores a code it cannot use.
     */
    languageCode: boolean;
    /** v3 models take stability only as 0.0 (Creative), 0.5 (Natural) or 1.0 (Robust); the others take any value 0..1. */
    stability: 'any' | 'presets';
}

const model = (transport: ElevenLabsModel['transport'], languageCode: boolean, stability: ElevenLabsModel['stability'] = 'any'): ElevenLabsModel => ({
    transport,
    languageCode,
    stability,
});

/** Every text to speech model ElevenLabs documents. */
export const ELEVENLABS_MODELS: Readonly<Record<string, ElevenLabsModel>> = {
    eleven_v4: model('stream', true),
    eleven_v4_turbo: model('dialogue', true),
    eleven_v3: model('stream', true, 'presets'),
    eleven_v3_conversational: model('dialogue', true, 'presets'),
    eleven_flash_v2_5: model('stream', true),
    // Superseded by eleven_flash_v2_5 (the same voice, lower latency), still served
    eleven_turbo_v2_5: model('stream', true),
    eleven_multilingual_v2: model('stream', false),
    eleven_flash_v2: model('stream', false),
    eleven_turbo_v2: model('stream', false),
    eleven_multilingual_v1: model('stream', false),
    eleven_monolingual_v1: model('stream', false),
};

/**
 * A model not in the table is a newer one: ElevenLabs says a language_code a model does not support is ignored, and only
 * the old models above refuse it, so it gets the language too. It is asked for over the HTTP stream, which every
 * text to speech model ElevenLabs lists by id there takes unless the table says otherwise.
 */
const NEWER_MODEL = model('stream', true);

export function elevenLabsModel(id: string): ElevenLabsModel {
    return Object.hasOwn(ELEVENLABS_MODELS, id) ? ELEVENLABS_MODELS[id] : NEWER_MODEL;
}

/**
 * How steady the voice is for each expression the maker can pick. Lower is livelier. "natural" sends nothing, so the
 * voice's own saved settings apply.
 */
const STABILITY: Record<ElevenLabsModel['stability'], Partial<Record<Expression, number>>> = {
    any: { restrained: 0.75, expressive: 0.3 },
    presets: { restrained: 1, expressive: 0 },
};

/** The primary language of "ar-KW" or "ar_KW": ElevenLabs takes ISO 639-1 codes (639-3 where a language has none). */
const languageOf = (lang: string): string => lang.split(/[-_]/)[0].toLowerCase();

/** Turns pieces of a little-endian s16 byte stream into whole samples. A piece can end half-way through a sample. */
class Samples {
    private carry?: Uint8Array;

    take(piece: Uint8Array): Int16Array | undefined {
        let bytes = piece;
        if (this.carry) {
            bytes = new Uint8Array(this.carry.length + piece.length);
            bytes.set(this.carry);
            bytes.set(piece, this.carry.length);
            this.carry = undefined;
        }
        const even = bytes.length - (bytes.length % 2);
        if (even < bytes.length) this.carry = bytes.slice(even);
        if (even === 0) return undefined;
        // Copied into an aligned buffer: Int16Array needs an even offset
        const samples = new Int16Array(even / 2);
        new Uint8Array(samples.buffer).set(bytes.subarray(0, even));
        return samples;
    }
}

export class ElevenLabsSpeech implements SpeechConnector {
    speak(request: SpeechRequest): AsyncGenerator<Int16Array> {
        const traits = elevenLabsModel(request.settings.model);
        const lang = request.lang ?? request.settings.language;
        const options = {
            base: (request.settings.endpoint || ELEVENLABS_ENDPOINT).replace(/\/+$/, ''),
            languageCode: lang && traits.languageCode ? languageOf(lang) : undefined,
            stability: request.expression ? STABILITY[traits.stability][request.expression] : undefined,
        };
        return traits.transport === 'dialogue' ? speakOverDialogue(request, options) : speakOverStream(request, options);
    }
}

interface CallOptions {
    /** The address with no trailing slash. */
    base: string;
    languageCode?: string;
    stability?: number;
}

async function* speakOverStream(request: SpeechRequest, options: CallOptions): AsyncGenerator<Int16Array> {
    const { settings } = request;
    const url = `${options.base}/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}/stream?output_format=${OUTPUT_FORMAT}`;
    const body: Record<string, unknown> = { text: request.text, model_id: settings.model };
    if (options.languageCode) body.language_code = options.languageCode;
    if (options.stability !== undefined) body.voice_settings = { stability: options.stability };

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

    const samples = new Samples();
    try {
        for await (const piece of response.body as AsyncIterable<Uint8Array>) {
            if (request.signal.aborted) return;
            const out = samples.take(piece);
            if (out) yield out;
        }
    } catch {
        if (request.signal.aborted) return;
        throw new ProviderError('elevenlabs stream dropped');
    }
}

/**
 * The status a Text to Dialogue error stands for, from its error id, so a refused key is told apart from a passing failure
 * the way the same failure over HTTP would be (ElevenLabs answers a bad key or a spent quota with 401 there).
 */
function dialogueErrorStatus(error: string): number | undefined {
    if (error === 'authentication_required' || error === 'invalid_api_key' || error === 'quota_exceeded') return 401;
    if (error === 'too_many_concurrent_requests' || error === 'system_busy') return 429;
    return undefined;
}

type DialogueEvent = { kind: 'audio'; samples: Int16Array } | { kind: 'end' } | { kind: 'failed'; error: ProviderError };

async function* speakOverDialogue(request: SpeechRequest, options: CallOptions): AsyncGenerator<Int16Array> {
    const { settings } = request;
    if (request.signal.aborted) return;
    const query = new URLSearchParams({ model_id: settings.model, output_format: OUTPUT_FORMAT });
    if (options.languageCode) query.set('language_code', options.languageCode);
    const url = `${options.base.replace(/^http/, 'ws')}/v1/text-to-dialogue/stream-input?${query}`;

    const events: DialogueEvent[] = [];
    let wake: (() => void) | undefined;
    let settled = false;
    const push = (event: DialogueEvent): void => {
        if (settled) return;
        if (event.kind !== 'audio') settled = true;
        events.push(event);
        wake?.();
    };
    const samples = new Samples();

    const ws = new WebSocket(url, { headers: { 'xi-api-key': settings.key.reveal() } });
    const onAbort = (): void => {
        settled = true;
        wake?.();
    };
    request.signal.addEventListener('abort', onAbort, { once: true });

    ws.on('open', () => {
        const start: Record<string, unknown> = { voices: [settings.voiceId] };
        if (options.stability !== undefined) start.voice_settings = { stability: options.stability };
        ws.send(JSON.stringify(start));
        ws.send(JSON.stringify({ inputs: [{ text: request.text, voice_id: settings.voiceId }] }));
        // Flushes what is buffered, sends the last audio and a final message, then closes
        ws.send(JSON.stringify({ close_socket: true }));
    });
    ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        // Nothing ElevenLabs sends may throw out of here: a socket handler that throws takes the whole worker down
        let message: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(data.toString());
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
            message = parsed as Record<string, unknown>;
        } catch {
            return;
        }
        if (typeof message.error === 'string') {
            push({ kind: 'failed', error: new ProviderError('elevenlabs refused the reply', dialogueErrorStatus(message.error)) });
            return;
        }
        if (typeof message.audio === 'string' && message.audio) {
            const out = samples.take(Buffer.from(message.audio, 'base64'));
            if (out) push({ kind: 'audio', samples: out });
        }
        if (message.is_final === true) push({ kind: 'end' });
    });
    // Refused before the socket opened (a wrong key answers 401 here)
    ws.on('unexpected-response', (_req, res) => {
        push({ kind: 'failed', error: new ProviderError('elevenlabs refused the reply', res.statusCode) });
        res.resume();
        ws.terminate();
    });
    ws.on('error', () => push({ kind: 'failed', error: new ProviderError('elevenlabs could not be reached') }));
    ws.on('close', () => push({ kind: 'failed', error: new ProviderError('elevenlabs stream dropped') }));

    try {
        while (true) {
            if (request.signal.aborted) return;
            const event = events.shift();
            if (!event) {
                await new Promise<void>((resolve) => (wake = resolve));
                wake = undefined;
                continue;
            }
            if (event.kind === 'audio') yield event.samples;
            else if (event.kind === 'end') return;
            else throw event.error;
        }
    } finally {
        request.signal.removeEventListener('abort', onAbort);
        ws.removeAllListeners('close');
        ws.on('error', () => undefined);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
    }
}
