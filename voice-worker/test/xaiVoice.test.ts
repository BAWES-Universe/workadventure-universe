// Hearing and speaking with xAI's own speech to text and text to speech (#1907), against stand-in xAI servers on loopback: no
// key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { XAI_VOICE_ADAPTER, XaiTranscription, XaiTts, xaiSpeechLanguage } from '../src/xaiVoice.ts';
import { waitFor } from './harness.ts';

const KEY = 'xai-key-907';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in for xAI's speech to text socket: says it is ready, then is answered by `onText` for each text message. */
async function fakeStt(onText: (ws: WebSocket, message: Record<string, unknown>) => void = () => undefined) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { sockets: [] as { url: string; auth?: string }[], audio: [] as Buffer[], messages: [] as Record<string, unknown>[] };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        seen.sockets.push({ url: req.url ?? '', auth: req.headers.authorization });
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.send(JSON.stringify({ type: 'transcript.created', id: 'tr-1' }));
            ws.on('message', (data, isBinary) => {
                if (isBinary) return void seen.audio.push(data as Buffer);
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                seen.messages.push(message);
                onText(ws, message);
            });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(
        () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    );
    return { base: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, send: (m: object) => current?.send(JSON.stringify(m)) };
}

function heard() {
    const got = { partials: [] as string[], finals: [] as string[], failures: [] as { text: string; status?: number }[] };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        endpoint: () => undefined,
        failed: (text, failure) => got.failures.push({ text, ...(failure?.status === undefined ? {} : { status: failure.status }) }),
    };
    return { got, events };
}

const hearing = (endpoint: string, changes: object = {}) => ({
    adapter: 'xai',
    model: 'grok-voice-transcribe-2.0',
    key: new Secret(KEY),
    endpoint,
    language: 'ar-KW',
    ...changes,
});

const partial = (text: string, is_final = false, speech_final = false) => ({ type: 'transcript.partial', text, is_final, speech_final });

describe("hearing with xAI's speech to text", () => {
    it('sends raw audio once ready, shows the words so far, and ends with the words that answer audio.done', async () => {
        const s = await fakeStt((ws, message) => {
            if (message.type === 'audio.done') {
                ws.send(JSON.stringify({ type: 'transcript.done', text: 'Hello there. How are you?', duration: 2.1 }));
                ws.close();
            }
        });
        const { got, events } = heard();
        const stream = new XaiTranscription().listen(hearing(s.base), events);
        stream.push(new Int16Array([1, -2]));
        await waitFor('the audio', () => s.seen.audio.length === 1);
        s.send(partial('Hello'));
        s.send(partial('Hello there.', true));
        s.send(partial('Hello there.', true, true));
        s.send(partial('How'));
        await waitFor('the words so far', () => got.partials.length === 3);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        // The utterance restating its locked chunk changes nothing on screen
        expect(got.partials).toEqual(['Hello', 'Hello there.', 'Hello there. How', 'Hello there. How are you?']);
        expect(got.finals).toEqual(['Hello there. How are you?']);
        expect(s.seen.sockets).toEqual([
            { url: '/v1/stt?sample_rate=16000&encoding=pcm&interim_results=true&model=grok-voice-transcribe-2.0&language=ar', auth: `Bearer ${KEY}` },
        ]);
        expect([...new Int16Array(new Uint8Array(s.seen.audio[0]).buffer)]).toEqual([1, -2]);
        expect(s.seen.messages).toEqual([{ type: 'audio.done' }]);
    });

    it('keeps the words already heard when the last answer holds only the rest', async () => {
        const s = await fakeStt((ws, message) => {
            if (message.type === 'audio.done') ws.send(JSON.stringify({ type: 'transcript.done', text: 'How are you?' }));
        });
        const { got, events } = heard();
        const stream = new XaiTranscription().listen(hearing(s.base), events);
        stream.push(new Int16Array([3]));
        await waitFor('the audio', () => s.seen.audio.length === 1);
        s.send(partial('Hello there.', true, true));
        await waitFor('the words so far', () => got.partials.length === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['Hello there. How are you?']);
    });

    it('fails with the status of an error xAI sends', async () => {
        const s = await fakeStt();
        const { got, events } = heard();
        new XaiTranscription().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.sockets.length === 1);
        s.send({ type: 'error', message: 'Invalid API key' });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });
});

/** A stand-in for xAI's text to speech address, answering with `answer`. */
async function fakeTts(answer: (res: http.ServerResponse) => void) {
    const seen: { url?: string; auth?: string; body?: Record<string, unknown> }[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
            answer(res);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Bonjour.',
    settings: { adapter: 'xai', model: 'grok-tts', voiceId: 'ara', key: new Secret(KEY), endpoint: base, language: 'fr-FR', ...settings },
    signal: new AbortController().signal,
    ...changes,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

describe("speaking with xAI's text to speech", () => {
    it('asks for raw 24 kHz PCM with the key as a bearer, and plays the audio as it comes', async () => {
        const s = await fakeTts((res) => {
            res.write(Buffer.from(new Int16Array([1, 2]).buffer));
            res.end(Buffer.from(new Int16Array([-3]).buffer));
        });
        expect(await collect(new XaiTts().speak(speaking(s.base)))).toEqual([1, 2, -3]);
        expect(s.seen[0]).toEqual({
            url: '/v1/tts',
            auth: `Bearer ${KEY}`,
            body: { text: 'Bonjour.', voice_id: 'ara', language: 'fr', output_format: { codec: 'pcm', sample_rate: 24000 } },
        });
    });

    it("uses Pipecat's voice when the bot names none, and the locale xAI speaks for each language", async () => {
        const s = await fakeTts((res) => res.end());
        await collect(new XaiTts().speak(speaking(s.base, { lang: 'ar-KW' }, { voiceId: '' })));
        expect(s.seen[0].body).toMatchObject({ voice_id: 'eve', language: 'ar-AE' });
        expect(xaiSpeechLanguage('ar-SA')).toBe('ar-SA');
        expect(xaiSpeechLanguage('ar')).toBe('ar-EG');
        expect(xaiSpeechLanguage('pt-BR')).toBe('pt-BR');
        expect(xaiSpeechLanguage('es-AR')).toBe('es-ES');
        expect(xaiSpeechLanguage('en-GB')).toBe('en');
        expect(xaiSpeechLanguage(undefined)).toBe('auto');
    });

    it("fails with xAI's status when it refuses the call, the key in no failure", async () => {
        const s = await fakeTts((res) => {
            res.statusCode = 401;
            res.end('{"error":"Incorrect API key provided"}');
        });
        const error = await collect(new XaiTts().speak(speaking(s.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(401);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });
});

describe('xAI under one name with its talking models', () => {
    const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };

    it('is registered as "xai" for hearing and speaking', () => {
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(XAI_VOICE_ADAPTER)).toBeInstanceOf(XaiTranscription);
        expect(worker.connectors.speech(XAI_VOICE_ADAPTER)).toBeInstanceOf(XaiTts);
    });

    it('leaves every other xAI model (talking live) to the connectors already there', async () => {
        const said: string[] = [];
        const talking = {
            speak: async function* (request: SpeechRequest) {
                said.push(request.settings.model);
                yield new Int16Array([7]);
            },
        };
        const worker = new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('xai', talking) });
        const speech = worker.connectors.speech('xai')!;
        expect(await collect(speech.speak(speaking('http://127.0.0.1:9', {}, { model: 'grok-voice-latest' })))).toEqual([7]);
        expect(said).toEqual(['grok-voice-latest']);
        const s = await fakeTts((res) => res.end(Buffer.from(new Int16Array([8]).buffer)));
        expect(await collect(speech.speak(speaking(s.base)))).toEqual([8]);
        expect(said).toEqual(['grok-voice-latest']);
    });
});
