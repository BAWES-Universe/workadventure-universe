// Hearing with Soniox (#1748), against a stand-in Soniox server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import { optionsFromEnv } from '../src/config.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { SONIOX_ADAPTER, SonioxRecognition } from '../src/soniox.ts';
import { waitFor } from './harness.ts';

const KEY = 'sk-soniox-test-key-123';

interface FakeSoniox {
    url: string;
    auth: (string | undefined)[];
    configs: Record<string, unknown>[];
    audioBytes: number;
    ended: boolean;
    socket: () => WebSocket | undefined;
    send: (message: object) => void;
}

const servers: { close: () => Promise<void> }[] = [];
afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
});

async function fakeSoniox(options: { refuse?: number; onEnd?: (send: (m: object) => void, ws: WebSocket) => void } = {}): Promise<FakeSoniox> {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const state: FakeSoniox = {
        url: '',
        auth: [],
        configs: [],
        audioBytes: 0,
        ended: false,
        socket: () => current,
        send: (m) => current?.send(JSON.stringify(m)),
    };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        state.auth.push(req.headers.authorization);
        if (options.refuse) {
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            let configured = false;
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    state.audioBytes += (data as Buffer).length;
                    return;
                }
                const text = data.toString();
                if (!configured) {
                    configured = true;
                    state.configs.push(JSON.parse(text));
                    return;
                }
                if (text === '') {
                    state.ended = true;
                    options.onEnd?.((m) => ws.send(JSON.stringify(m)), ws);
                }
            });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    state.url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/transcribe-websocket`;
    servers.push({
        close: () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    });
    return state;
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

const settings = (url: string, extra: object = {}) => ({ adapter: 'soniox', model: 'stt-rt-v6', key: new Secret(KEY), endpoint: url, ...extra });
const audio = (ms: number) => new Int16Array(16 * ms).fill(100);

describe('hearing with Soniox', () => {
    it('opens one stream with the key in the Authorization header, and asks for 16 kHz mono s16le with the chosen model and language', async () => {
        const soniox = await fakeSoniox();
        const { events } = heard();
        const stream = new SonioxRecognition().listen(settings(soniox.url, { language: 'ar' }), events);
        // Audio before the stream is open is held, then sent in order
        stream.push(audio(100));
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        stream.push(audio(100));
        await waitFor('the audio to arrive', () => soniox.audioBytes === 2 * 16 * 200);
        expect(soniox.auth).toEqual([`Bearer ${KEY}`]);
        expect(soniox.configs[0]).toEqual({
            model: 'stt-rt-v6',
            audio_format: 's16le',
            sample_rate: 16000,
            num_channels: 1,
            // Soniox's own end-of-speech detection, with its recommended starting point for voice AI
            enable_endpoint_detection: true,
            max_endpoint_delay_ms: 1500,
            endpoint_latency_adjustment_level: 2,
            endpoint_sensitivity: 0.3,
            language_hints: ['ar'],
        });
        // The key is only in the header, never in the start message
        expect(JSON.stringify(soniox.configs[0])).not.toContain(KEY);
        stream.close();
    });

    it('hints the plain language when the profile names a regional one', async () => {
        const soniox = await fakeSoniox();
        const stream = new SonioxRecognition().listen(settings(soniox.url, { language: 'ar-KW' }), heard().events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        expect(soniox.configs[0].language_hints).toEqual(['ar']);
        stream.close();
    });

    it.each(['stt-rt-v5', 'stt-rt-v4', 'stt-rt-v3', 'stt-rt-preview-v2'])('listens with the current model when the profile names %s, which Soniox retired', async (model) => {
        const soniox = await fakeSoniox();
        const stream = new SonioxRecognition().listen(settings(soniox.url, { model }), heard().events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        expect(soniox.configs[0].model).toBe('stt-rt-v6');
        stream.close();
    });

    it('keeps a model it does not know, and only sends the endpoint tuning to models from v5 on', async () => {
        const soniox = await fakeSoniox();
        const custom = new SonioxRecognition().listen(settings(soniox.url, { model: 'my-custom-model' }), heard().events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        expect(soniox.configs[0]).toMatchObject({ model: 'my-custom-model', enable_endpoint_detection: true, max_endpoint_delay_ms: 1500 });
        expect(soniox.configs[0]).not.toHaveProperty('endpoint_sensitivity');
        custom.close();
        const newer = new SonioxRecognition().listen(settings(soniox.url, { model: 'stt-rt-v7' }), heard().events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 2);
        expect(soniox.configs[1]).toMatchObject({ model: 'stt-rt-v7', endpoint_sensitivity: 0.3, endpoint_latency_adjustment_level: 2 });
        newer.close();
    });

    it('says once when Soniox hears the person finish, and waits longer than the worker for quiet alone', async () => {
        const soniox = await fakeSoniox();
        let endpoints = 0;
        const { events } = heard();
        const stream = new SonioxRecognition().listen(settings(soniox.url), { ...events, endpoint: () => endpoints++ });
        expect(stream.pauseMs).toBe(1800);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        soniox.send({ tokens: [{ text: 'Hi', is_final: false }] });
        soniox.send({ tokens: [{ text: 'Hi', is_final: true }, { text: ' there', is_final: true }, { text: '<end>', is_final: true }] });
        soniox.send({ tokens: [{ text: '<end>', is_final: true }] });
        await waitFor('the endpoint', () => endpoints === 1);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(endpoints).toBe(1);
        stream.close();
    });

    it('leaves the language to Soniox when the profile follows the person', async () => {
        const soniox = await fakeSoniox();
        const stream = new SonioxRecognition().listen(settings(soniox.url), heard().events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        expect(soniox.configs[0]).not.toHaveProperty('language_hints');
        stream.close();
    });

    it('shows the final words so far followed by the latest guess, and says every word once the person paused', async () => {
        const soniox = await fakeSoniox({
            onEnd: (send) => {
                send({ tokens: [{ text: ' you', is_final: true }, { text: '?', is_final: true }, { text: '<fin>', is_final: true }] });
                send({ tokens: [], finished: true });
            },
        });
        const { got, events } = heard();
        const stream = new SonioxRecognition().listen(settings(soniox.url), events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        soniox.send({ tokens: [{ text: 'How', is_final: true }, { text: ' r', is_final: false }] });
        soniox.send({ tokens: [{ text: ' are', is_final: false }] });
        soniox.send({ tokens: [{ text: ' are', is_final: true }] });
        await waitFor('the guesses', () => got.partials.length === 2);
        // The guess " are" becoming final changes no words, so nothing new is shown
        expect(got.partials).toEqual(['How r', 'How are']);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(soniox.ended).toBe(true);
        expect(got.finals).toEqual(['How are you?']);
        expect(got.failures).toEqual([]);
    });

    it('ends the audio as soon as the stream opens when the person already paused', async () => {
        const soniox = await fakeSoniox({ onEnd: (send) => send({ tokens: [{ text: 'hi', is_final: true }], finished: true }) });
        const { got, events } = heard();
        const stream = new SonioxRecognition().listen(settings(soniox.url), events);
        stream.push(audio(60));
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(soniox.audioBytes).toBe(2 * 16 * 60);
        expect(got.finals).toEqual(['hi']);
    });

    it('fails with the status when Soniox refuses the key, and the key is in no failure', async () => {
        const soniox = await fakeSoniox({ refuse: 401 });
        const { got, events } = heard();
        new SonioxRecognition().listen(settings(soniox.url), events);
        await waitFor('the refusal', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
        expect(JSON.stringify(got)).not.toContain(KEY);
    });

    it('fails with the status Soniox gives in an error answer, keeping the words it had', async () => {
        const soniox = await fakeSoniox();
        const { got, events } = heard();
        new SonioxRecognition().listen(settings(soniox.url), events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        soniox.send({ tokens: [{ text: 'hello', is_final: true }] });
        soniox.send({ error_code: 402, error_type: 'payment_required', error_message: 'balance' });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: 'hello', status: 402 }]);
    });

    it('skips answers that are not shaped like one, and keeps listening', async () => {
        const soniox = await fakeSoniox({ onEnd: (send) => send({ tokens: [{ text: ' there', is_final: true }], finished: true }) });
        const { got, events } = heard();
        const stream = new SonioxRecognition().listen(settings(soniox.url), events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        for (const raw of ['null', '5', '"text"', '[1,2]', 'not json', '{"tokens":5}', '{"tokens":"hi"}', '{"tokens":[null,7,"x",{"text":3}]}']) {
            soniox.socket()!.send(raw);
        }
        soniox.send({ tokens: [null, { text: 'hello', is_final: true }] });
        await waitFor('the words after them', () => got.partials.length === 1);
        expect(got.partials).toEqual(['hello']);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['hello there']);
        expect(got.failures).toEqual([]);
    });

    it('fails without a status when the stream drops before the last words', async () => {
        const soniox = await fakeSoniox();
        const { got, events } = heard();
        new SonioxRecognition().listen(settings(soniox.url), events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        soniox.send({ tokens: [{ text: 'so', is_final: false }] });
        await waitFor('the guess', () => got.partials.length === 1);
        soniox.socket()!.terminate();
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: 'so' }]);
    });

    it('fails when the last words take too long', async () => {
        const soniox = await fakeSoniox({ onEnd: () => undefined });
        const { got, events } = heard();
        const stream = new SonioxRecognition({ finalTimeoutMs: 100 }).listen(settings(soniox.url), events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        stream.finish();
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.finals).toEqual([]);
        expect(got.failures).toEqual([{ text: '' }]);
    });

    it('says nothing after it is closed, and closes the stream', async () => {
        const soniox = await fakeSoniox();
        const { got, events } = heard();
        const stream = new SonioxRecognition().listen(settings(soniox.url), events);
        await waitFor('the stream to be configured', () => soniox.configs.length === 1);
        const socket = soniox.socket()!;
        stream.close();
        await waitFor('the stream to close', () => socket.readyState === socket.CLOSED);
        stream.push(audio(20));
        stream.finish();
        expect(got).toEqual({ partials: [], finals: [], failures: [] });
    });

    it('fails without a status when nothing answers', async () => {
        const { got, events } = heard();
        new SonioxRecognition().listen(settings('ws://127.0.0.1:1/transcribe-websocket'), events);
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '' }]);
    });
});

describe('the worker hears with Soniox by name', () => {
    it('has it registered as "soniox" unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.recognition(SONIOX_ADAPTER)).toBeInstanceOf(SonioxRecognition);
        const own = { listen: () => ({ push: () => undefined, finish: () => undefined, close: () => undefined }) };
        const registry = new ConnectorRegistry().registerRecognition('soniox', own);
        expect(new VoiceWorker({ ...base, connectors: registry }).connectors.recognition('soniox')).toBe(own);
    });

    it('waits 10 seconds for the last words unless set otherwise', () => {
        expect(optionsFromEnv({}).recognitionFinalTimeoutSeconds).toBe(10);
        expect(optionsFromEnv({ VOICE_RECOGNITION_FINAL_TIMEOUT_SECONDS: '4' }).recognitionFinalTimeoutSeconds).toBe(4);
    });
});
