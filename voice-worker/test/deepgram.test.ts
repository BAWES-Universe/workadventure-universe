// Hearing with Deepgram (#1748), against a stand-in Deepgram server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import { optionsFromEnv } from '../src/config.ts';
import { DEEPGRAM_ADAPTER, DeepgramRecognition, followLanguage } from '../src/deepgram.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'dg-test-key-123';

interface FakeDeepgram {
    url: string;
    auth: (string | undefined)[];
    requests: URL[];
    audioBytes: number;
    controls: Record<string, unknown>[];
    socket: () => WebSocket | undefined;
    send: (message: object) => void;
}

const servers: { close: () => Promise<void> }[] = [];
afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
});

type Reply = (send: (m: object) => void, ws: WebSocket) => void;

async function fakeDeepgram(options: { refuse?: number; onCloseStream?: Reply } = {}): Promise<FakeDeepgram> {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    let current: WebSocket | undefined;
    const state: FakeDeepgram = {
        url: '',
        auth: [],
        requests: [],
        audioBytes: 0,
        controls: [],
        socket: () => current,
        send: (m) => current?.send(JSON.stringify(m)),
    };
    server.on('upgrade', (req, socket, head) => {
        state.auth.push(req.headers.authorization);
        state.requests.push(new URL(req.url ?? '/', 'http://localhost'));
        if (options.refuse) {
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    state.audioBytes += (data as Buffer).length;
                    return;
                }
                const control = JSON.parse(data.toString()) as Record<string, unknown>;
                state.controls.push(control);
                if (control.type === 'CloseStream') options.onCloseStream?.((m) => ws.send(JSON.stringify(m)), ws);
            });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    state.url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/listen`;
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

const results = (transcript: string, isFinal: boolean) => ({ type: 'Results', is_final: isFinal, speech_final: false, channel: { alternatives: [{ transcript, confidence: 0.9 }] } });
/** What Deepgram does once the audio has ended: the last words, then Metadata, then a normal close. */
const endWith = (...segments: string[]): Reply => (send, ws) => {
    for (const segment of segments) send(results(segment, true));
    send({ type: 'Metadata', request_id: 'r1' });
    ws.close(1000);
};

function heard() {
    const got = { partials: [] as string[], finals: [] as string[], failures: [] as { text: string; status?: number }[] };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        failed: (text, failure) => got.failures.push({ text, ...(failure?.status === undefined ? {} : { status: failure.status }) }),
    };
    return { got, events };
}

const settings = (url: string, extra: object = {}) => ({ adapter: 'deepgram', model: 'nova-3', key: new Secret(KEY), endpoint: url, ...extra });
const audio = (ms: number) => new Int16Array(16 * ms).fill(100);

describe('hearing with Deepgram', () => {
    it('opens one stream with the key in the Authorization header only, asking for 16 kHz mono linear16 with the chosen model and language', async () => {
        const deepgram = await fakeDeepgram();
        const { events } = heard();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url, { language: 'ar' }), events);
        // Audio before the stream is open is held, then sent in order
        stream.push(audio(100));
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        stream.push(audio(100));
        await waitFor('the audio to arrive', () => deepgram.audioBytes === 2 * 16 * 200);
        expect(deepgram.auth).toEqual([`Token ${KEY}`]);
        const query = Object.fromEntries(deepgram.requests[0].searchParams);
        expect(query).toMatchObject({ model: 'nova-3', encoding: 'linear16', sample_rate: '16000', channels: '1', interim_results: 'true', endpointing: 'false', language: 'ar' });
        // The key is only in the header, never in the address
        expect(deepgram.requests[0].toString()).not.toContain(KEY);
        stream.close();
    });

    it('listens in every language when the profile follows the person, and uses a default model when none is named', async () => {
        const deepgram = await fakeDeepgram();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url, { model: '' }), heard().events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        // Left out, Deepgram would hear English only
        expect(deepgram.requests[0].searchParams.get('language')).toBe('multi');
        expect(deepgram.requests[0].searchParams.get('model')).toBe('nova-3');
        stream.close();
    });

    it('keeps a fixed regional language as the profile has it', async () => {
        const deepgram = await fakeDeepgram();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url, { language: 'ar-KW' }), heard().events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        expect(deepgram.requests[0].searchParams.get('language')).toBe('ar-KW');
        stream.close();
    });

    it('asks Deepgram not to train on what people say', async () => {
        const deepgram = await fakeDeepgram();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url), heard().events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        expect(deepgram.requests[0].searchParams.get('mip_opt_out')).toBe('true');
        stream.close();
    });

    it('follows the person with "multi" only on the models that hear several languages at once', () => {
        expect(followLanguage('nova-3')).toBe('multi');
        expect(followLanguage('nova-3-general')).toBe('multi');
        expect(followLanguage('nova-2')).toBe('multi');
        expect(followLanguage('nova-30')).toBeUndefined();
        expect(followLanguage('enhanced')).toBeUndefined();
        expect(followLanguage('whisper-large')).toBeUndefined();
    });

    it('shows the final segments so far followed by the latest guess, and says every word once the person paused', async () => {
        const deepgram = await fakeDeepgram({ onCloseStream: endWith('are you?') });
        const { got, events } = heard();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        await waitFor('the socket', () => deepgram.socket() !== undefined);
        deepgram.send(results('How', false));
        deepgram.send(results('How are', false));
        deepgram.send(results('How are', true));
        // A final that repeats the guess changes no words, so nothing new is shown
        deepgram.send(results('you', false));
        await waitFor('the guesses', () => got.partials.length === 3);
        expect(got.partials).toEqual(['How', 'How are', 'How are you']);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(deepgram.controls).toEqual([{ type: 'CloseStream' }]);
        expect(got.finals).toEqual(['How are are you?']);
        expect(got.failures).toEqual([]);
    });

    it('takes back words Deepgram revises to nothing, so a silent end does not say them', async () => {
        const deepgram = await fakeDeepgram({ onCloseStream: endWith('') });
        const { got, events } = heard();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        await waitFor('the socket', () => deepgram.socket() !== undefined);
        deepgram.send(results('uh', false));
        deepgram.send(results('', false));
        await waitFor('the guess and its removal', () => got.partials.length === 2);
        expect(got.partials).toEqual(['uh', '']);
        stream.finish();
        await waitFor('the end', () => got.finals.length === 1);
        expect(got.finals).toEqual(['']);
    });

    it('says the words when Deepgram has sent its last answer, without waiting for the stream to close', async () => {
        const deepgram = await fakeDeepgram({
            onCloseStream: (send) => {
                send(results('hello there', true));
                send({ type: 'Metadata' });
            },
        });
        const { got, events } = heard();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['hello there']);
        expect(got.failures).toEqual([]);
    });

    it('ends the audio as soon as the stream opens when the person already paused', async () => {
        const deepgram = await fakeDeepgram({ onCloseStream: endWith('hi') });
        const { got, events } = heard();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url), events);
        stream.push(audio(60));
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(deepgram.audioBytes).toBe(2 * 16 * 60);
        expect(got.finals).toEqual(['hi']);
    });

    it('says nothing for a silent stretch', async () => {
        const deepgram = await fakeDeepgram({ onCloseStream: endWith('') });
        const { got, events } = heard();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        stream.finish();
        await waitFor('the end', () => got.finals.length === 1);
        expect(got.finals).toEqual(['']);
        expect(got.partials).toEqual([]);
    });

    it('fails with the status when Deepgram refuses the key, and the key is in no failure', async () => {
        const deepgram = await fakeDeepgram({ refuse: 401 });
        const { got, events } = heard();
        new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the refusal', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
        expect(JSON.stringify(got)).not.toContain(KEY);
    });

    it('fails without a status on an error answer, keeping the words it had', async () => {
        const deepgram = await fakeDeepgram();
        const { got, events } = heard();
        new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        await waitFor('the socket', () => deepgram.socket() !== undefined);
        deepgram.send(results('hello', true));
        deepgram.send({ type: 'Error', variant: 'SchemaError', description: 'bad', message: 'bad' });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: 'hello' }]);
    });

    it('skips answers that are not shaped like one, and keeps listening', async () => {
        const deepgram = await fakeDeepgram({ onCloseStream: endWith('there') });
        const { got, events } = heard();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        await waitFor('the socket', () => deepgram.socket() !== undefined);
        const odd = [
            'null', '5', '"text"', '[1,2]', 'not json', '{}', '{"type":"Results"}', '{"type":"Results","channel":5}', '{"type":"Results","channel":{"alternatives":5}}',
            '{"type":"Results","channel":{"alternatives":[]}}', '{"type":"Results","channel":{"alternatives":[null]}}', '{"type":"Results","channel":{"alternatives":[{"transcript":3}]}}',
            '{"type":"SpeechStarted"}', '{"type":"UtteranceEnd"}',
        ];
        for (const raw of odd) deepgram.socket()!.send(raw);
        deepgram.send(results('hello', true));
        await waitFor('the words after them', () => got.partials.length === 1);
        expect(got.partials).toEqual(['hello']);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['hello there']);
        expect(got.failures).toEqual([]);
    });

    it('fails without a status when the stream drops before the last words', async () => {
        const deepgram = await fakeDeepgram();
        const { got, events } = heard();
        new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        await waitFor('the socket', () => deepgram.socket() !== undefined);
        deepgram.send(results('so', false));
        await waitFor('the guess', () => got.partials.length === 1);
        deepgram.socket()!.terminate();
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: 'so' }]);
    });

    it('fails when Deepgram closes the stream with an error code instead of the last words', async () => {
        const deepgram = await fakeDeepgram({ onCloseStream: (_send, ws) => ws.close(1011, 'NET-0001') });
        const { got, events } = heard();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        stream.finish();
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.finals).toEqual([]);
        expect(got.failures).toEqual([{ text: '' }]);
    });

    it('fails when the last words take too long', async () => {
        const deepgram = await fakeDeepgram({ onCloseStream: () => undefined });
        const { got, events } = heard();
        const stream = new DeepgramRecognition({ finalTimeoutMs: 100 }).listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        stream.finish();
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.finals).toEqual([]);
        expect(got.failures).toEqual([{ text: '' }]);
    });

    it('says nothing after it is closed, and closes the stream', async () => {
        const deepgram = await fakeDeepgram();
        const { got, events } = heard();
        const stream = new DeepgramRecognition().listen(settings(deepgram.url), events);
        await waitFor('the stream to open', () => deepgram.requests.length === 1);
        await waitFor('the socket', () => deepgram.socket() !== undefined);
        const socket = deepgram.socket()!;
        stream.close();
        await waitFor('the stream to close', () => socket.readyState === socket.CLOSED);
        stream.push(audio(20));
        stream.finish();
        expect(got).toEqual({ partials: [], finals: [], failures: [] });
    });

    it('fails without a status when nothing answers', async () => {
        const { got, events } = heard();
        new DeepgramRecognition().listen(settings('ws://127.0.0.1:1/v1/listen'), events);
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '' }]);
    });
});

describe('the worker hears with Deepgram by name', () => {
    it('has it registered as "deepgram" unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.recognition(DEEPGRAM_ADAPTER)).toBeInstanceOf(DeepgramRecognition);
        const own = { listen: () => ({ push: () => undefined, finish: () => undefined, close: () => undefined }) };
        const registry = new ConnectorRegistry().registerRecognition('deepgram', own);
        expect(new VoiceWorker({ ...base, connectors: registry }).connectors.recognition('deepgram')).toBe(own);
    });

    it('waits 10 seconds for the last words unless set otherwise', () => {
        expect(optionsFromEnv({}).recognitionFinalTimeoutSeconds).toBe(10);
        expect(optionsFromEnv({ VOICE_RECOGNITION_FINAL_TIMEOUT_SECONDS: '4' }).recognitionFinalTimeoutSeconds).toBe(4);
    });
});
