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
    eleven_multilingual_v2: model('stream', false),
    eleven_flash_v2: model('stream', false),
    eleven_multilingual_v1: model('stream', false),
    eleven_monolingual_v1: model('stream', false),
};

/**
 * Ids ElevenLabs has superseded, and what it says to use instead. The Turbo v2 models are "functionally equivalent" to the
 * Flash ones, which have lower latency, and ElevenLabs recommends Flash "in all use cases"; a profile that still names a
 * Turbo id speaks with the Flash model.
 */
export const ELEVENLABS_SUCCESSORS: Readonly<Record<string, string>> = {
    eleven_turbo_v2_5: 'eleven_flash_v2_5',
    eleven_turbo_v2: 'eleven_flash_v2',
};

/** The model a reply is asked for with: the profile's, or the one ElevenLabs replaced it with. */
export const currentElevenLabsModel = (id: string): string => (Object.hasOwn(ELEVENLABS_SUCCESSORS, id) ? ELEVENLABS_SUCCESSORS[id] : id);

/**
 * A model not in the table is a newer one: ElevenLabs says a language_code a model does not support is ignored, and only
 * the old models above refuse it, so it gets the language too. It is asked for over the HTTP stream, which every
 * text to speech model ElevenLabs lists by id there takes unless the table says otherwise.
 */
const NEWER_MODEL = model('stream', true);

export function elevenLabsModel(id: string): ElevenLabsModel {
    const current = currentElevenLabsModel(id);
    return Object.hasOwn(ELEVENLABS_MODELS, current) ? ELEVENLABS_MODELS[current] : NEWER_MODEL;
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


/** How long a socket opened ahead of a reply waits for it before it is closed. Each open socket holds a dialogue session. */
export const WARM_SOCKET_MS = 45_000;
/** ElevenLabs closes a socket after 20 seconds with nothing from us; a waiting socket says it is still there this often. */
const KEEP_ALIVE_MS = 10_000;

/** What a reply needs from the call: the address, the model as it is asked for, and the parameters the model takes. */
interface Call {
    /** The address with no trailing slash. */
    base: string;
    model: string;
    voiceId: string;
    languageCode?: string;
    stability?: number;
}

type CallRequest = Pick<SpeechRequest, 'settings' | 'lang' | 'expression'>;

function callFor(request: CallRequest): { call: Call; traits: ElevenLabsModel } {
    const model = currentElevenLabsModel(request.settings.model);
    const traits = elevenLabsModel(model);
    const lang = request.lang ?? request.settings.language;
    return {
        traits,
        call: {
            base: (request.settings.endpoint || ELEVENLABS_ENDPOINT).replace(/\/+$/, ''),
            model,
            voiceId: request.settings.voiceId,
            languageCode: lang && traits.languageCode ? languageOf(lang) : undefined,
            stability: request.expression ? STABILITY[traits.stability][request.expression] : undefined,
        },
    };
}

const sameCall = (a: Call, b: Call): boolean =>
    a.base === b.base && a.model === b.model && a.voiceId === b.voiceId && a.languageCode === b.languageCode && a.stability === b.stability;

export class ElevenLabsSpeech implements SpeechConnector {
    /** A socket opened ahead of the next reply, per bubble (its settings). */
    private readonly warm = new WeakMap<object, { call: Call; socket: DialogueSocket }>();

    speak(request: SpeechRequest): AsyncGenerator<Int16Array> {
        const { call, traits } = callFor(request);
        if (traits.transport === 'stream') return speakOverStream(request, call);
        return this.speakOverDialogue(request, call);
    }

    /**
     * The bubble will likely want a reply soon (someone started talking): for a model served over the Text to Dialogue
     * WebSocket, the socket is opened and set up now, so the reply does not wait for the connection. Nothing is spoken or
     * billed until a reply is sent on it; unused, it closes after WARM_SOCKET_MS.
     */
    prepare(request: CallRequest): void {
        const { call, traits } = callFor(request);
        if (traits.transport !== 'dialogue') return;
        const held = this.warm.get(request.settings);
        if (held && sameCall(held.call, call) && held.socket.usable()) return;
        held?.socket.close();
        const socket = new DialogueSocket(call, request.settings.key.reveal(), WARM_SOCKET_MS, () => {
            if (this.warm.get(request.settings)?.socket === socket) this.warm.delete(request.settings);
        });
        this.warm.set(request.settings, { call, socket });
    }

    /** The bubble is closing: a socket opened ahead of a reply is closed. */
    release(settings: object): void {
        this.warm.get(settings)?.socket.close();
        this.warm.delete(settings);
    }

    private async *speakOverDialogue(request: SpeechRequest, call: Call): AsyncGenerator<Int16Array> {
        if (request.signal.aborted) return;
        const held = this.warm.get(request.settings);
        this.warm.delete(request.settings);
        let socket: DialogueSocket;
        if (held && sameCall(held.call, call) && held.socket.usable()) {
            socket = held.socket;
        } else {
            held?.socket.close();
            socket = new DialogueSocket(call, request.settings.key.reveal());
        }
        yield* socket.say(request.text, request.signal);
    }
}

async function* speakOverStream(request: SpeechRequest, call: Call): AsyncGenerator<Int16Array> {
    const { settings } = request;
    const url = `${call.base}/v1/text-to-speech/${encodeURIComponent(call.voiceId)}/stream?output_format=${OUTPUT_FORMAT}`;
    const body: Record<string, unknown> = { text: request.text, model_id: call.model };
    if (call.languageCode) body.language_code = call.languageCode;
    if (call.stability !== undefined) body.voice_settings = { stability: call.stability };

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

/**
 * One Text to Dialogue WebSocket, for one reply. It is set up as soon as it opens (the voice and its settings), so it can be
 * opened ahead of the reply; the reply is the whole text and then close_socket, which flushes it (nothing waits for the
 * ~40 characters the socket otherwise buffers). Text normalization is on, so numbers, dates and amounts are read as words:
 * the reply's text is also what the chat shows, so it cannot be written out in words for the voice.
 */
class DialogueSocket {
    private readonly ws: WebSocket;
    private readonly events: DialogueEvent[] = [];
    private readonly samples = new Samples();
    private wake?: () => void;
    private settled = false;
    private used = false;
    private keepAlive?: NodeJS.Timeout;
    private expiry?: NodeJS.Timeout;
    private readonly voiceId: string;

    constructor(call: Call, key: string, waitMs?: number, private readonly onGone: () => void = () => undefined) {
        this.voiceId = call.voiceId;
        const query = new URLSearchParams({ model_id: call.model, output_format: OUTPUT_FORMAT, apply_text_normalization: 'on' });
        if (call.languageCode) query.set('language_code', call.languageCode);
        this.ws = new WebSocket(`${call.base.replace(/^http/, 'ws')}/v1/text-to-dialogue/stream-input?${query}`, { headers: { 'xi-api-key': key } });
        this.ws.on('open', () => {
            const start: Record<string, unknown> = { voices: [call.voiceId] };
            if (call.stability !== undefined) start.voice_settings = { stability: call.stability };
            this.ws.send(JSON.stringify(start));
            if (!this.used) {
                this.keepAlive = setInterval(() => this.ws.send(JSON.stringify({ keep_alive: true })), KEEP_ALIVE_MS);
                this.keepAlive.unref?.();
            }
        });
        this.ws.on('message', (data, isBinary) => {
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
                this.push({ kind: 'failed', error: new ProviderError('elevenlabs refused the reply', dialogueErrorStatus(message.error)) });
                return;
            }
            if (typeof message.audio === 'string' && message.audio) {
                const out = this.samples.take(Buffer.from(message.audio, 'base64'));
                if (out) this.push({ kind: 'audio', samples: out });
            }
            if (message.is_final === true) this.push({ kind: 'end' });
        });
        // Refused before the socket opened (a wrong key answers 401 here)
        this.ws.on('unexpected-response', (_req, res) => {
            this.push({ kind: 'failed', error: new ProviderError('elevenlabs refused the reply', res.statusCode) });
            res.resume();
            this.ws.terminate();
        });
        this.ws.on('error', () => this.push({ kind: 'failed', error: new ProviderError('elevenlabs could not be reached') }));
        this.ws.on('close', () => this.push({ kind: 'failed', error: new ProviderError('elevenlabs stream dropped') }));
        if (waitMs !== undefined) {
            this.expiry = setTimeout(() => this.close(), waitMs);
            this.expiry.unref?.();
        }
    }

    /** Not used for a reply yet, and neither failed nor closed. */
    usable(): boolean {
        return !this.used && !this.settled && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING);
    }

    async *say(text: string, signal: AbortSignal): AsyncGenerator<Int16Array> {
        this.used = true;
        clearTimeout(this.expiry);
        clearInterval(this.keepAlive);
        const onAbort = (): void => {
            this.settled = true;
            this.wake?.();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        const sendReply = (): void => {
            this.ws.send(JSON.stringify({ inputs: [{ text, voice_id: this.voiceId }] }));
            // Flushes what is buffered, sends the last audio and a final message, then closes
            this.ws.send(JSON.stringify({ close_socket: true }));
        };
        if (this.ws.readyState === WebSocket.OPEN) sendReply();
        else this.ws.once('open', sendReply);
        try {
            while (true) {
                if (signal.aborted) return;
                const event = this.events.shift();
                if (!event) {
                    await new Promise<void>((resolve) => (this.wake = resolve));
                    this.wake = undefined;
                    continue;
                }
                if (event.kind === 'audio') yield event.samples;
                else if (event.kind === 'end') return;
                else throw event.error;
            }
        } finally {
            signal.removeEventListener('abort', onAbort);
            this.close();
        }
    }

    close(): void {
        clearTimeout(this.expiry);
        clearInterval(this.keepAlive);
        this.settled = true;
        this.wake?.();
        this.ws.removeAllListeners('close');
        this.ws.on('error', () => undefined);
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
        this.onGone();
    }

    private push(event: DialogueEvent): void {
        if (this.settled) return;
        if (event.kind !== 'audio') {
            this.settled = true;
            clearInterval(this.keepAlive);
        }
        this.events.push(event);
        this.wake?.();
    }
}
