// Hearing and speaking with Together AI (#1906), against stand-in Together servers on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { TOGETHER_ADAPTER, TogetherRecognition, TogetherSpeech, togetherLanguage } from '../src/together.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'together-key-906';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in for Together's realtime socket, answered by `onMessage`. */
async function fakeRealtime(onMessage: (ws: WebSocket, message: Record<string, unknown>) => void = () => undefined) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { sockets: [] as { url: string; auth?: string }[], messages: [] as Record<string, unknown>[] };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        seen.sockets.push({ url: req.url ?? '', auth: req.headers.authorization });
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data) => {
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
    adapter: 'together',
    model: 'openai/whisper-large-v3',
    key: new Secret(KEY),
    endpoint,
    language: 'en-US',
    ...changes,
});

describe('hearing with Together AI', () => {
    it('sends base64 audio, shows the words so far, and ends with the transcript that answers the commit', async () => {
        const s = await fakeRealtime((ws, message) => {
            if (message.type === 'input_audio_buffer.commit') {
                ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: ' Hello there, friend. ' }));
            }
        });
        const { got, events } = heard();
        const stream = new TogetherRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array([1, -2]));
        await waitFor('the audio', () => s.seen.messages.length === 1);
        s.send({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Hello' });
        s.send({ type: 'conversation.item.input_audio_transcription.delta', transcript: 'Hello there' });
        await waitFor('the words so far', () => got.partials.length === 2);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Hello', 'Hello there', 'Hello there, friend.']);
        expect(got.finals).toEqual(['Hello there, friend.']);
        expect(s.seen.sockets).toEqual([
            {
                url: '/v1/realtime?intent=transcription&model=openai%2Fwhisper-large-v3&turn_detection=none&input_audio_format=pcm_s16le_16000',
                auth: `Bearer ${KEY}`,
            },
        ]);
        expect(s.seen.messages).toEqual([
            { type: 'input_audio_buffer.append', audio: Buffer.from(new Int16Array([1, -2]).buffer).toString('base64') },
            { type: 'input_audio_buffer.commit' },
        ]);
    });

    it('fails with the status of an error Together sends', async () => {
        const s = await fakeRealtime();
        const { got, events } = heard();
        new TogetherRecognition().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.sockets.length === 1);
        s.send({ type: 'error', error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Invalid API key' } });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });

    it('ends with what was heard, not a failure, when Together says the commit had no audio', async () => {
        const s = await fakeRealtime((ws, message) => {
            if (message.type === 'input_audio_buffer.commit') {
                ws.send(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', code: 'input_audio_buffer_commit_empty' } }));
            }
        });
        const { got, events } = heard();
        const stream = new TogetherRecognition().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.sockets.length === 1);
        stream.finish();
        await waitFor('the end', () => got.finals.length + got.failures.length === 1);
        expect(got.failures).toEqual([]);
        expect(got.finals).toEqual(['']);
    });

    it('reads a rate limit as one even when its words name the key', async () => {
        const s = await fakeRealtime();
        const { got, events } = heard();
        new TogetherRecognition().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.sockets.length === 1);
        s.send({ type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded for your API key' } });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 429 }]);
    });
});

/** A stand-in for Together's speaking address, answering with `answer`. */
async function fakeSpeaking(answer: (res: http.ServerResponse) => void) {
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

const s16 = (...values: number[]) => Buffer.from(new Int16Array(values).buffer).toString('base64');
const chunk = (b64: string) => `data: ${JSON.stringify({ object: 'audio.tts.chunk', model: 'hexgrad/Kokoro-82M', b64 })}\n\n`;

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Bonjour.',
    settings: { adapter: 'together', model: 'hexgrad/Kokoro-82M', voiceId: 'ff_siwis', key: new Secret(KEY), endpoint: base, language: 'fr-FR', ...settings },
    signal: new AbortController().signal,
    ...changes,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

describe('speaking with Together AI', () => {
    it('streams raw 24 kHz audio with the key as a bearer, playing every chunk until [DONE]', async () => {
        const s = await fakeSpeaking((res) => {
            res.setHeader('content-type', 'text/event-stream');
            res.write(chunk(s16(1, 2)));
            res.write(chunk(s16(-3)));
            res.end('data: [DONE]\n\n');
        });
        expect(await collect(new TogetherSpeech().speak(speaking(s.base)))).toEqual([1, 2, -3]);
        expect(s.seen[0]).toEqual({
            url: '/v1/audio/speech',
            auth: `Bearer ${KEY}`,
            body: {
                model: 'hexgrad/Kokoro-82M',
                input: 'Bonjour.',
                voice: 'ff_siwis',
                response_format: 'raw',
                response_encoding: 'pcm_s16le',
                sample_rate: 24000,
                stream: true,
                language: 'fr',
            },
        });
    });

    it("uses each model's default voice, and leaves a language Together doesn't speak to it", async () => {
        const s = await fakeSpeaking((res) => res.end('data: [DONE]\n\n'));
        await collect(new TogetherSpeech().speak(speaking(s.base, { lang: 'ar-KW' }, { model: 'canopylabs/orpheus-3b-0.1-ft', voiceId: '' })));
        expect(s.seen[0].body).toMatchObject({ model: 'canopylabs/orpheus-3b-0.1-ft', voice: 'tara' });
        expect(s.seen[0].body).not.toHaveProperty('language');
        await collect(new TogetherSpeech().speak(speaking(s.base, {}, { model: '', voiceId: '' })));
        expect(s.seen[1].body).toMatchObject({ model: 'hexgrad/Kokoro-82M', voice: 'af_heart' });
        expect(togetherLanguage('zh-HK')).toBe('zh-hk');
        expect(togetherLanguage('zh-CN')).toBe('zh');
        expect(togetherLanguage(undefined)).toBeUndefined();
    });

    it("fails with Together's status, whether it refuses the call or reports an error in the stream, the key in no failure", async () => {
        const refused = await fakeSpeaking((res) => {
            res.statusCode = 401;
            res.end('{"error":{"message":"Invalid API key"}}');
        });
        const first = await collect(new TogetherSpeech().speak(speaking(refused.base))).catch((e: unknown) => e);
        expect(first).toBeInstanceOf(ProviderError);
        expect((first as ProviderError).status).toBe(401);
        expect(`${(first as Error).message} ${JSON.stringify(first)}`).not.toContain(KEY);

        const broken = await fakeSpeaking((res) => res.end(`data: ${JSON.stringify({ error: { message: 'Insufficient credits' } })}\n\n`));
        const second = await collect(new TogetherSpeech().speak(speaking(broken.base))).catch((e: unknown) => e);
        expect(second).toBeInstanceOf(ProviderError);
        expect((second as ProviderError).status).toBe(402);
    });

    it('is registered as "together" for hearing and speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(TOGETHER_ADAPTER)).toBeInstanceOf(TogetherRecognition);
        expect(worker.connectors.speech(TOGETHER_ADAPTER)).toBeInstanceOf(TogetherSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('together', own) }).connectors.speech('together')).toBe(own);
    });
});
