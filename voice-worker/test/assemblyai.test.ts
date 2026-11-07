// Listening with AssemblyAI (#1884), against a stand-in AssemblyAI socket on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ASSEMBLYAI_ADAPTER, ASSEMBLYAI_CHUNK_MS, ASSEMBLYAI_FALLBACK_PAUSE_MS, AssemblyAiRecognition, assemblyAiStatus } from '../src/assemblyai.ts';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'aai-hear-key-321';

interface Fake {
    url: string;
    seen: { url?: string; key?: string | string[] }[];
    chunks: number[];
    terminated: boolean;
    send: (m: object) => void;
    close: (code: number, reason: string) => void;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

async function fakeAssemblyAi(options: { onTerminate?: (send: (m: object) => void) => void; onOpen?: (ws: WebSocket) => void } = {}): Promise<Fake> {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    let current: WebSocket | undefined;
    const fake: Fake = {
        url: '',
        seen: [],
        chunks: [],
        terminated: false,
        send: (m) => current?.send(JSON.stringify(m)),
        close: (code, reason) => current?.close(code, reason),
    };
    server.on('upgrade', (req, socket, head) => {
        fake.seen.push({ url: req.url, key: req.headers.authorization });
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            options.onOpen?.(ws);
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    fake.chunks.push((data as Buffer).length);
                    return;
                }
                if (JSON.parse(data.toString()).type === 'Terminate') {
                    fake.terminated = true;
                    options.onTerminate?.(fake.send);
                }
            });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    fake.url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closers.push(
        () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                server.closeAllConnections();
                server.close(() => resolve());
            })
    );
    return fake;
}

function heard() {
    const got = { partials: [] as string[], finals: [] as string[], endpoints: 0, failures: [] as { text: string; status?: number }[] };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        endpoint: () => got.endpoints++,
        failed: (text, failure) => got.failures.push({ text, ...(failure?.status === undefined ? {} : { status: failure.status }) }),
    };
    return { got, events };
}

const settings = (endpoint: string) => ({ adapter: 'assemblyai', model: 'universal-3-6-pro', key: new Secret(KEY), endpoint, language: 'ar-KW' });
const words = (...text: string[]) => text.map((word) => ({ text: word, start: 0, end: 0, confidence: 1, word_is_final: true }));
const BYTES_PER_MS = 32;

describe('listening with AssemblyAI', () => {
    it('opens one socket with the key as it is in its header, the model and 16 kHz s16 audio', async () => {
        const fake = await fakeAssemblyAi();
        const stream = new AssemblyAiRecognition().listen(settings(fake.url), heard().events);
        stream.push(new Int16Array(16 * ASSEMBLYAI_CHUNK_MS));
        await waitFor('the audio', () => fake.chunks.length === 1);
        const url = new URL(fake.seen[0].url!, 'ws://x');
        expect(url.pathname).toBe('/v3/ws');
        expect(Object.fromEntries(url.searchParams)).toEqual({ speech_model: 'universal-3-6-pro', encoding: 'pcm_s16le', sample_rate: '16000' });
        expect(fake.seen[0].key).toBe(KEY);
        expect(stream.pauseMs).toBe(ASSEMBLYAI_FALLBACK_PAUSE_MS);
        stream.close();
    });

    it('gathers small frames into 100 ms pieces, and makes the last one at least 50 ms', async () => {
        const fake = await fakeAssemblyAi({ onTerminate: (send) => send({ type: 'Termination', audio_duration_seconds: 0.3, session_duration_seconds: 1 }) });
        const { got, events } = heard();
        const stream = new AssemblyAiRecognition().listen(settings(fake.url), events);
        // Twelve 20 ms frames: two whole pieces, and 40 ms left
        for (let i = 0; i < 12; i++) stream.push(new Int16Array(320));
        stream.finish();
        await waitFor('the end', () => got.finals.length === 1);
        expect(fake.chunks).toEqual([100 * BYTES_PER_MS, 100 * BYTES_PER_MS, 50 * BYTES_PER_MS]);
        expect(fake.terminated).toBe(true);
    });

    it('shows a turn as it grows, keeps it when AssemblyAI says it ended, says so, and ends with the last words', async () => {
        const fake = await fakeAssemblyAi({
            onTerminate: (send) => {
                send({ type: 'Turn', turn_order: 1, end_of_turn: true, turn_is_formatted: true, transcript: 'How are you?', words: words('How', 'are', 'you?') });
                send({ type: 'Termination', audio_duration_seconds: 2, session_duration_seconds: 3 });
            },
        });
        const { got, events } = heard();
        const stream = new AssemblyAiRecognition().listen(settings(fake.url), events);
        await waitFor('the socket', () => fake.seen.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 30));
        fake.send({ type: 'Begin', id: 's1', expires_at: 0 });
        fake.send({ type: 'Turn', turn_order: 0, end_of_turn: false, transcript: 'Marhaba', words: words('Marhaba', 'hab') });
        fake.send({ type: 'Turn', turn_order: 0, end_of_turn: true, transcript: 'Marhaba habibi.', words: words('Marhaba', 'habibi.') });
        await waitFor('the end of the turn', () => got.endpoints === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Marhaba hab', 'Marhaba habibi.', 'Marhaba habibi. How are you?']);
        expect(got.finals).toEqual(['Marhaba habibi. How are you?']);
        expect(got.failures).toEqual([]);
    });

    it('fails with the status AssemblyAI gives a wrong key, no funds or too many sessions, from the close or an Error message', async () => {
        for (const [reason, status] of [
            ['Unauthorized Connection: Invalid API key', 401],
            ['Unauthorized Connection: Insufficient funds', 402],
            ['Unauthorized Connection: Too many concurrent sessions', 429],
        ] as const) {
            const fake = await fakeAssemblyAi({ onOpen: (ws) => ws.close(1008, reason) });
            const { got, events } = heard();
            new AssemblyAiRecognition().listen(settings(fake.url), events);
            await waitFor('the failure', () => got.failures.length === 1);
            expect(got.failures).toEqual([{ text: '', status }]);
        }

        const fake = await fakeAssemblyAi();
        const { got, events } = heard();
        new AssemblyAiRecognition().listen(settings(fake.url), events);
        await waitFor('the socket', () => fake.seen.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 30));
        fake.send({ type: 'Error', error: 'Insufficient funds' });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 402 }]);
    });

    it('fails, with no status, when AssemblyAI drops the stream for another reason', async () => {
        const fake = await fakeAssemblyAi({ onOpen: (ws) => ws.close(3005, 'Session Cancelled: An error occurred') });
        const { got, events } = heard();
        new AssemblyAiRecognition().listen(settings(fake.url), events);
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '' }]);
    });

    it('reads only the reasons it knows as a status', () => {
        expect(assemblyAiStatus('Unauthorized Connection: API key is disabled')).toBe(401);
        expect(assemblyAiStatus('Unauthorized Connection: Missing Authorization header')).toBe(401);
        expect(assemblyAiStatus('Unauthorized Connection: Signature has expired')).toBeUndefined();
        expect(assemblyAiStatus('Error authenticating connection')).toBeUndefined();
    });
});

describe('the worker listens with AssemblyAI by name', () => {
    const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };

    it('has it registered as "assemblyai" unless a registry already brings one', () => {
        expect(new VoiceWorker(base).connectors.recognition(ASSEMBLYAI_ADAPTER)).toBeInstanceOf(AssemblyAiRecognition);
        const own = { listen: () => ({ push: () => undefined, finish: () => undefined, close: () => undefined }) };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerRecognition('assemblyai', own) }).connectors.recognition('assemblyai')).toBe(own);
    });
});
