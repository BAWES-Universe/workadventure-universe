// Hearing and speaking with Gradium (#1885), against a stand-in Gradium on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { GRADIUM_ADAPTER, GRADIUM_DEFAULT_VOICE, GradiumRecognition, GradiumSpeech, gradiumLanguage } from '../src/gradium.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'gradium-key-864';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

async function fakeGradium(onMessage: (ws: WebSocket, message: Record<string, unknown>) => void) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { keys: [] as (string | string[] | undefined)[], paths: [] as string[], messages: [] as Record<string, unknown>[] };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        seen.keys.push(req.headers['x-api-key']);
        seen.paths.push(req.url ?? '');
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
            })
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

const hearing = (endpoint: string, changes: object = {}) => ({ adapter: 'gradium', model: 'default', key: new Secret(KEY), endpoint: `${endpoint}/api/speech/asr`, language: 'en-GB', ...changes });
const speaking = (endpoint: string, settings: object = {}): SpeechRequest => ({
    text: 'Hello there, friend.',
    settings: { adapter: 'gradium', model: 'default', voiceId: 'v-1', key: new Secret(KEY), endpoint: `${endpoint}/api/speech/tts`, ...settings },
    signal: new AbortController().signal,
});
const b64 = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer).toString('base64');

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

describe('hearing with Gradium', () => {
    it('sends the setup with the key in its header, then audio as base64, and ends with the last words', async () => {
        const g = await fakeGradium((ws, message) => {
            if (message.type === 'setup') ws.send(JSON.stringify({ type: 'ready', sample_rate: 16000 }));
            if (message.type === 'end_of_stream') {
                ws.send(JSON.stringify({ type: 'text', text: 'are you?', start_s: 1.2 }));
                ws.send(JSON.stringify({ type: 'end_of_stream' }));
            }
        });
        const { got, events } = heard();
        const stream = new GradiumRecognition().listen(hearing(g.base), events);
        stream.push(new Int16Array([1, 2]));
        await waitFor('the audio', () => g.seen.messages.some((m) => m.type === 'audio'));
        g.send({ type: 'step', vad: [{ horizon_s: 0.5, inactivity_prob: 0.1 }] });
        g.send({ type: 'text', text: 'Hello, how', start_s: 0 });
        await waitFor('the words so far', () => got.partials.length === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Hello, how', 'Hello, how are you?']);
        expect(got.finals).toEqual(['Hello, how are you?']);
        expect(g.seen.keys).toEqual([KEY]);
        expect(g.seen.paths).toEqual(['/api/speech/asr']);
        expect(g.seen.messages[0]).toEqual({ type: 'setup', model_name: 'default', input_format: 'pcm_16000', json_config: { language: 'en' } });
        expect(g.seen.messages[1]).toEqual({ type: 'audio', audio: b64(1, 2) });
        expect(g.seen.messages.at(-1)).toEqual({ type: 'end_of_stream' });
    });

    it('fails, keeping the words heard, when Gradium closes any way but normally after the end of the audio', async () => {
        const g = await fakeGradium((ws, message) => {
            if (message.type === 'end_of_stream') ws.close(1011);
        });
        const { got, events } = heard();
        const stream = new GradiumRecognition().listen(hearing(g.base), events);
        stream.push(new Int16Array([1, 2]));
        await waitFor('the audio', () => g.seen.messages.some((m) => m.type === 'audio'));
        g.send({ type: 'text', text: 'Hello', start_s: 0 });
        await waitFor('the words so far', () => got.partials.length === 1);
        stream.finish();
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.finals).toEqual([]);
        expect(got.failures).toEqual([{ text: 'Hello' }]);
    });

    it('lets Gradium work out a language it does not list, and fails with a refused key', async () => {
        expect(gradiumLanguage('ar-KW')).toBe('any');
        expect(gradiumLanguage(undefined)).toBe('any');
        expect(gradiumLanguage('pt-BR')).toBe('pt');

        const g = await fakeGradium((ws, message) => {
            if (message.type === 'setup') {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid API key', code: 1008 }));
                ws.close(1008, 'policy');
            }
        });
        const { got, events } = heard();
        new GradiumRecognition().listen(hearing(g.base), events);
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });
});

describe('speaking with Gradium', () => {
    it('sends the setup, the text and the end, with the key in its header, and plays the 24 kHz audio until the end', async () => {
        const g = await fakeGradium((ws, message) => {
            if (message.type === 'end_of_stream') {
                ws.send(JSON.stringify({ type: 'ready' }));
                ws.send(JSON.stringify({ type: 'audio', audio: b64(1, 2), start_s: 0, stop_s: 0.1 }));
                ws.send(JSON.stringify({ type: 'text', text: 'Hello', start_s: 0 }));
                ws.send(JSON.stringify({ type: 'audio', audio: b64(3), start_s: 0.1, stop_s: 0.2 }));
                ws.send(JSON.stringify({ type: 'end_of_stream' }));
            }
        });
        expect(await collect(new GradiumSpeech().speak(speaking(g.base)))).toEqual([1, 2, 3]);
        expect(g.seen.keys).toEqual([KEY]);
        expect(g.seen.paths).toEqual(['/api/speech/tts']);
        expect(g.seen.messages).toEqual([
            { type: 'setup', model_name: 'default', voice_id: 'v-1', output_format: 'pcm_24000' },
            { type: 'text', text: 'Hello there, friend.' },
            { type: 'end_of_stream' },
        ]);
    });

    it("uses Gradium's default voice when none is picked, and fails with a refused key", async () => {
        const quiet = await fakeGradium((ws, message) => {
            if (message.type === 'end_of_stream') ws.send(JSON.stringify({ type: 'end_of_stream' }));
        });
        await collect(new GradiumSpeech().speak(speaking(quiet.base, { voiceId: '' })));
        expect(quiet.seen.messages[0].voice_id).toBe(GRADIUM_DEFAULT_VOICE);

        const refused = await fakeGradium((ws) => ws.send(JSON.stringify({ type: 'error', message: 'Invalid API key', code: 1008 })));
        const error = await collect(new GradiumSpeech().speak(speaking(refused.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(401);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });
});

describe('the worker has Gradium by name', () => {
    it('is registered as "gradium" for hearing and speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(GRADIUM_ADAPTER)).toBeInstanceOf(GradiumRecognition);
        expect(worker.connectors.speech(GRADIUM_ADAPTER)).toBeInstanceOf(GradiumSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('gradium', own) }).connectors.speech('gradium')).toBe(own);
    });
});
