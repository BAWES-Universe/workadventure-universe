// Hearing and speaking with Smallest AI (#1904), against a stand-in Smallest server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { SMALLEST_ADAPTER, SmallestRecognition, SmallestSpeech, smallestHearing, smallestSpeaking } from '../src/smallest.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'smallest-key-158';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in Smallest: both sockets, answered by `onMessage`. */
async function fakeSmallest(onMessage: (ws: WebSocket, message: Record<string, unknown> | Buffer) => void = () => undefined) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { sockets: [] as { url: string; auth?: string }[], messages: [] as Record<string, unknown>[], bytes: 0 };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        seen.sockets.push({ url: req.url ?? '', auth: req.headers.authorization });
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    seen.bytes += (data as Buffer).length;
                    return onMessage(ws, data as Buffer);
                }
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                seen.messages.push(message);
                onMessage(ws, message);
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
    adapter: 'smallest',
    model: 'pulse',
    key: new Secret(KEY),
    endpoint,
    language: 'hi-IN',
    ...changes,
});

describe('hearing with Smallest AI', () => {
    it('opens the socket with the key as a bearer, sends binary audio, and ends with the words marked last', async () => {
        const s = await fakeSmallest((ws, message) => {
            if (!Buffer.isBuffer(message) && message.type === 'close_stream') {
                ws.send(JSON.stringify({ transcript: 'aap kaise hain?', is_final: true, is_last: true }));
                ws.close(1000);
            }
        });
        const { got, events } = heard();
        const stream = new SmallestRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array(160));
        await waitFor('the audio', () => s.seen.bytes === 320);
        s.send({ transcript: 'Namas', is_final: false });
        s.send({ transcript: 'Namaste,', is_final: true });
        await waitFor('the words so far', () => got.partials.length === 2);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Namas', 'Namaste,', 'Namaste, aap kaise hain?']);
        expect(got.finals).toEqual(['Namaste, aap kaise hain?']);
        expect(s.seen.sockets).toEqual([
            { url: '/waves/v1/stt/live?model=pulse&language=hi&encoding=linear16&sample_rate=16000&format=true', auth: `Bearer ${KEY}` },
        ]);
        expect(s.seen.messages).toEqual([{ type: 'close_stream' }]);
    });

    it('leaves a language Pulse does not hear to Smallest, and fails when Smallest closes any way but normally', async () => {
        expect(smallestHearing('ar-KW')).toBeUndefined();
        const s = await fakeSmallest((ws, message) => {
            if (!Buffer.isBuffer(message) && message.type === 'close_stream') ws.close(1011);
        });
        const { got, events } = heard();
        const stream = new SmallestRecognition().listen(hearing(s.base, { language: 'ar-KW' }), events);
        stream.push(new Int16Array(160));
        await waitFor('the audio', () => s.seen.bytes === 320);
        expect(s.seen.sockets[0].url).not.toContain('language=');
        stream.finish();
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.finals).toEqual([]);
    });

    it('fails with the status of an error Smallest sends', async () => {
        const s = await fakeSmallest();
        const { got, events } = heard();
        new SmallestRecognition().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.sockets.length === 1);
        s.send({ type: 'error', message: 'Invalid API key', code: 401 });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });
});

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Marhaba.',
    settings: { adapter: 'smallest', model: 'lightning_v3.1_pro', voiceId: 'layla', key: new Secret(KEY), endpoint: base, language: 'ar-KW', ...settings },
    signal: new AbortController().signal,
    ...changes,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

const s16 = (...values: number[]) => Buffer.from(new Int16Array(values).buffer).toString('base64');

describe('speaking with Smallest AI', () => {
    it('sends the whole reply in one message with the key as a bearer, and plays the chunks until complete', async () => {
        const s = await fakeSmallest((ws) => {
            ws.send(JSON.stringify({ status: 'chunk', data: { audio: s16(1, 2) } }));
            ws.send(JSON.stringify({ status: 'chunk', data: { audio: s16(3) } }));
            ws.send(JSON.stringify({ status: 'complete' }));
        });
        expect(await collect(new SmallestSpeech().speak(speaking(s.base)))).toEqual([1, 2, 3]);
        expect(s.seen.sockets).toEqual([{ url: '/waves/v1/tts/live', auth: `Bearer ${KEY}` }]);
        expect(s.seen.messages).toEqual([
            {
                text: 'Marhaba.',
                voice_id: 'layla',
                model: 'lightning_v3.1_pro',
                language: 'ar',
                sample_rate: 24000,
                context_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
                continue: false,
                output_format: 'pcm',
            },
        ]);
    });

    it("gives the model's default voice when none is picked, lets Smallest work out a language the model lacks, and fails with its error", async () => {
        expect(smallestSpeaking('lightning_v3.1', 'ar')).toBe('auto');
        expect(smallestSpeaking('lightning_v3.1_pro', 'ar-KW')).toBe('ar');
        const s = await fakeSmallest((ws) => ws.send(JSON.stringify({ status: 'error', message: 'Insufficient credits', code: 402 })));
        const error = await collect(new SmallestSpeech().speak(speaking(s.base, {}, { model: 'lightning_v3.1', voiceId: '' }))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(402);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
        expect(s.seen.messages[0]).toMatchObject({ voice_id: 'sophia', model: 'lightning_v3.1', language: 'auto' });
    });
});

describe('Smallest AI in the worker', () => {
    it('is registered as "smallest" for hearing and speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(SMALLEST_ADAPTER)).toBeInstanceOf(SmallestRecognition);
        expect(worker.connectors.speech(SMALLEST_ADAPTER)).toBeInstanceOf(SmallestSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('smallest', own) }).connectors.speech('smallest')).toBe(own);
    });
});
