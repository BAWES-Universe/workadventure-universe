// Hearing and speaking with Mistral (#1897), against a stand-in Mistral server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { Float32ToS16 } from '../src/kit/httpSpeech.ts';
import { MISTRAL_ADAPTER, MistralRecognition, MistralSpeech } from '../src/mistral.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'mistral-key-907';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in Mistral: a socket for hearing, and /v1/audio/speech answered by `speech`. */
async function fakeMistral(options: { onMessage?: (ws: WebSocket, message: Record<string, unknown>) => void; created?: boolean; speech?: (res: http.ServerResponse) => void } = {}) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = {
        sockets: [] as { url: string; auth?: string }[],
        messages: [] as Record<string, unknown>[],
        appendsBeforeCreated: 0,
        requests: [] as { url?: string; auth?: string; body?: Record<string, unknown> }[],
    };
    let current: WebSocket | undefined;
    server.on('request', (req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.requests.push({ url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
            options.speech?.(res);
        });
    });
    server.on('upgrade', (req, socket, head) => {
        seen.sockets.push({ url: req.url ?? '', auth: req.headers.authorization });
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            let created = false;
            ws.on('message', (data) => {
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                seen.messages.push(message);
                if (message.type === 'input_audio.append' && !created) seen.appendsBeforeCreated += 1;
                options.onMessage?.(ws, message);
            });
            // Mistral opens the session a little after the socket, so audio sent too early would show up first
            if (options.created !== false)
                setTimeout(() => {
                    created = true;
                    ws.send(JSON.stringify({ type: 'session.created', session: { request_id: 'r1', model: 'voxtral-mini-transcribe-realtime-2602' } }));
                }, 30);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(
        () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                server.closeAllConnections();
                server.close(() => resolve());
            })
    );
    const port = (server.address() as AddressInfo).port;
    return { ws: `ws://127.0.0.1:${port}`, http: `http://127.0.0.1:${port}`, seen, send: (m: object) => current?.send(JSON.stringify(m)) };
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

const hearing = (endpoint: string, changes: object = {}) => ({ adapter: 'mistral', model: 'voxtral-mini-transcribe-realtime-2602', key: new Secret(KEY), endpoint, language: 'ar-KW', ...changes });

describe('hearing with Mistral', () => {
    it('opens the socket with the key as a bearer, sets the session once Mistral opens it, sends base64 audio, and ends with the last words', async () => {
        const m = await fakeMistral({
            onMessage: (ws, message) => {
                if (message.type === 'input_audio.end') {
                    ws.send(JSON.stringify({ type: 'transcription.text.delta', text: ' halak?' }));
                    ws.send(JSON.stringify({ type: 'transcription.done', text: 'Marhaba, kaif halak?', model: 'm', usage: {}, language: 'ar' }));
                }
            },
        });
        const { got, events } = heard();
        const stream = new MistralRecognition().listen(hearing(m.ws), events);
        stream.push(new Int16Array([1, 2]));
        await waitFor('the audio', () => m.seen.messages.some((message) => message.type === 'input_audio.append'));
        expect(m.seen.appendsBeforeCreated).toBe(0);
        m.send({ type: 'transcription.language', audio_language: 'ar' });
        m.send({ type: 'transcription.text.delta', text: 'Marhaba,' });
        m.send({ type: 'transcription.text.delta', text: ' kaif' });
        await waitFor('the words so far', () => got.partials.length === 2);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Marhaba,', 'Marhaba, kaif', 'Marhaba, kaif halak?']);
        expect(got.finals).toEqual(['Marhaba, kaif halak?']);
        expect(m.seen.sockets).toEqual([{ url: '/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-2602', auth: `Bearer ${KEY}` }]);
        expect(m.seen.messages[0]).toEqual({ type: 'session.update', session: { audio_format: { encoding: 'pcm_s16le', sample_rate: 16000 }, language: 'ar' } });
        expect(m.seen.messages[1]).toEqual({ type: 'input_audio.append', audio: Buffer.from(new Int16Array([1, 2]).buffer).toString('base64') });
        expect(m.seen.messages.slice(-2)).toEqual([{ type: 'input_audio.flush' }, { type: 'input_audio.end' }]);
    });

    it('lets Mistral work out the language when none is set', async () => {
        const m = await fakeMistral();
        const stream = new MistralRecognition().listen(hearing(m.ws, { language: undefined }), heard().events);
        await waitFor('the session', () => m.seen.messages.length === 1);
        expect(m.seen.messages[0]).toEqual({ type: 'session.update', session: { audio_format: { encoding: 'pcm_s16le', sample_rate: 16000 } } });
        stream.close();
    });

    it('fails with the status of an error Mistral sends', async () => {
        const m = await fakeMistral({ created: false });
        const { got, events } = heard();
        new MistralRecognition().listen(hearing(m.ws), events);
        await waitFor('the socket', () => m.seen.sockets.length === 1);
        m.send({ type: 'error', error: { message: 'Unauthorized', code: 401 } });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });
});

const f32 = (...values: number[]) => Buffer.from(new Float32Array(values).buffer).toString('base64');
const delta = (...values: number[]) => `event: speech.audio.delta\ndata: ${JSON.stringify({ type: 'speech.audio.delta', audio_data: f32(...values) })}\n\n`;

const speaking = (base: string, settings: object = {}): SpeechRequest => ({
    text: 'Hello there.',
    settings: { adapter: 'mistral', model: 'voxtral-mini-tts-2603', voiceId: 'voice-1', key: new Secret(KEY), endpoint: base, ...settings },
    signal: new AbortController().signal,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

describe('speaking with Mistral', () => {
    it('streams the text with the voice and the key as a bearer, and plays its float samples as s16 until done', async () => {
        const m = await fakeMistral({
            speech: (res) => {
                res.setHeader('content-type', 'text/event-stream');
                res.write(delta(0, 0.5, -0.5));
                res.write(delta(1, -1, 2));
                res.write(`event: speech.audio.done\ndata: ${JSON.stringify({ type: 'speech.audio.done', usage: {} })}\n\n`);
                res.end(delta(0.25));
            },
        });
        const samples = await collect(new MistralSpeech().speak(speaking(m.http)));
        expect(samples).toEqual([0, 16384, -16384, 32767, -32768, 32767]);
        expect(m.seen.requests[0]).toEqual({
            url: '/v1/audio/speech',
            auth: `Bearer ${KEY}`,
            body: { input: 'Hello there.', model: 'voxtral-mini-tts-2603', voice_id: 'voice-1', response_format: 'pcm', stream: true },
        });
    });

    it("leaves the voice to Mistral when none is picked, and fails with Mistral's status, the key in no failure", async () => {
        const quiet = await fakeMistral({ speech: (res) => res.end(`data: ${JSON.stringify({ type: 'speech.audio.done' })}\n\n`) });
        await collect(new MistralSpeech().speak(speaking(quiet.http, { voiceId: '' })));
        expect(quiet.seen.requests[0].body).not.toHaveProperty('voice_id');

        const refused = await fakeMistral({
            speech: (res) => {
                res.statusCode = 401;
                res.end('{"message":"Unauthorized"}');
            },
        });
        const error = await collect(new MistralSpeech().speak(speaking(refused.http))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(401);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('keeps a float sample split across two pieces whole', () => {
        const turn = new Float32ToS16();
        const bytes = new Uint8Array(new Float32Array([0.5, -0.5]).buffer);
        const first = turn.take(bytes.slice(0, 6));
        const second = turn.take(bytes.slice(6));
        expect([...new Int16Array(first.buffer), ...new Int16Array(second.buffer)]).toEqual([16384, -16384]);
    });
});

describe('Mistral in the worker', () => {
    it('is registered as "mistral" for hearing and speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(MISTRAL_ADAPTER)).toBeInstanceOf(MistralRecognition);
        expect(worker.connectors.speech(MISTRAL_ADAPTER)).toBeInstanceOf(MistralSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('mistral', own) }).connectors.speech('mistral')).toBe(own);
    });
});
