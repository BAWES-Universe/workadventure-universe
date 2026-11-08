// Listening with Cartesia (#1878), against a stand-in Cartesia socket on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { CARTESIA_ADAPTER, CartesiaRecognition, DEFAULT_CARTESIA_VERSION } from '../src/cartesia.ts';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'sk_car_hear-key-321';

interface Fake {
    url: string;
    seen: { url?: string; key?: string | string[] }[];
    audioBytes: number;
    closed: boolean;
    send: (m: object) => void;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

async function fakeCartesia(options: { refuse?: number; onClose?: (send: (m: object) => void) => void } = {}): Promise<Fake> {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    let current: WebSocket | undefined;
    const fake: Fake = { url: '', seen: [], audioBytes: 0, closed: false, send: (m) => current?.send(JSON.stringify(m)) };
    server.on('upgrade', (req, socket, head) => {
        fake.seen.push({ url: req.url, key: req.headers['x-api-key'] });
        if (options.refuse) {
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    fake.audioBytes += (data as Buffer).length;
                    return;
                }
                if (data.toString() === 'close') {
                    fake.closed = true;
                    options.onClose?.(fake.send);
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
    const got = { partials: [] as string[], finals: [] as string[], failures: [] as { text: string; status?: number }[] };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        failed: (text, failure) => got.failures.push({ text, ...(failure?.status === undefined ? {} : { status: failure.status }) }),
    };
    return { got, events };
}

const settings = (endpoint: string, extra: object = {}) => ({ adapter: 'cartesia', model: 'ink-whisper', key: new Secret(KEY), endpoint, language: 'ar-KW', ...extra });

describe('listening with Cartesia', () => {
    it('opens one socket with the key in its header, the model, 16 kHz s16 audio, the pinned version and the base language', async () => {
        const fake = await fakeCartesia();
        const { events } = heard();
        const stream = new CartesiaRecognition().listen(settings(fake.url), events);
        stream.push(new Int16Array(160));
        await waitFor('the audio', () => fake.audioBytes === 320);
        const url = new URL(fake.seen[0].url!, 'ws://x');
        expect(url.pathname).toBe('/stt/websocket');
        expect(Object.fromEntries(url.searchParams)).toEqual({ model: 'ink-whisper', encoding: 'pcm_s16le', sample_rate: '16000', cartesia_version: DEFAULT_CARTESIA_VERSION, language: 'ar' });
        expect(fake.seen[0].key).toBe(KEY);
        stream.close();
    });

    it('sends no language to the newer Ink models, which detect it', async () => {
        const fake = await fakeCartesia();
        const stream = new CartesiaRecognition().listen(settings(fake.url, { model: 'ink-2' }), heard().events);
        await waitFor('the socket', () => fake.seen.length === 1);
        expect(new URL(fake.seen[0].url!, 'ws://x').searchParams.has('language')).toBe(false);
        stream.close();
    });

    it('keeps final pieces as they come, shows the latest other one, and ends with the last words after close', async () => {
        const fake = await fakeCartesia({
            onClose: (send) => {
                send({ type: 'transcript', text: ' habibi', is_final: true });
                send({ type: 'done' });
            },
        });
        const { got, events } = heard();
        const stream = new CartesiaRecognition().listen(settings(fake.url), events);
        await waitFor('the socket', () => fake.seen.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 30));
        fake.send({ type: 'transcript', text: 'Marh', is_final: false });
        fake.send({ type: 'transcript', text: 'Marhaba', is_final: true });
        await waitFor('the words', () => got.partials.length === 2);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(fake.closed).toBe(true);
        expect(got.partials).toEqual(['Marh', 'Marhaba', 'Marhaba habibi']);
        expect(got.finals).toEqual(['Marhaba habibi']);
        expect(got.failures).toEqual([]);
    });

    it('fails with the status Cartesia reports, or of a refused connection', async () => {
        const fake = await fakeCartesia();
        const reported = heard();
        new CartesiaRecognition().listen(settings(fake.url), reported.events);
        await waitFor('the socket', () => fake.seen.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 30));
        fake.send({ type: 'error', status_code: 402, title: 'Payment required', message: 'no credits' });
        await waitFor('the failure', () => reported.got.failures.length === 1);
        expect(reported.got.failures).toEqual([{ text: '', status: 402 }]);

        const refused = await fakeCartesia({ refuse: 401 });
        const turned = heard();
        new CartesiaRecognition().listen(settings(refused.url), turned.events);
        await waitFor('the failure', () => turned.got.failures.length === 1);
        expect(turned.got.failures).toEqual([{ text: '', status: 401 }]);
    });
});

describe('the worker listens with Cartesia by name', () => {
    const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };

    it('has it registered as "cartesia" unless a registry already brings one', () => {
        expect(new VoiceWorker(base).connectors.recognition(CARTESIA_ADAPTER)).toBeInstanceOf(CartesiaRecognition);
        const own = { listen: () => ({ push: () => undefined, finish: () => undefined, close: () => undefined }) };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerRecognition('cartesia', own) }).connectors.recognition('cartesia')).toBe(own);
    });
});
