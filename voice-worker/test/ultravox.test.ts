// Talking with Ultravox (game #1910), against a stand-in Ultravox on loopback: no key, no network, no spend. The model hears and
// speaks; the bot's own Mind writes every answer. Each stretch and each reply is its own call: made over https, joined over a socket.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { LISTEN_ONLY, READ_ALOUD } from '../src/openai.ts';
import { ULTRAVOX_ADAPTER, UltravoxRecognition, UltravoxSpeech, makeCall } from '../src/ultravox.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'uvx-test-key-321';

interface Ultravox {
    url: string;
    calls: { url?: string; key?: string; body: Record<string, unknown> }[];
    /** What each joined call was sent: JSON messages, and the bytes of audio. */
    received: Record<string, unknown>[];
    audioBytes: number;
    joins: string[];
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/**
 * A stand-in Ultravox. POST /api/calls answers with a join address on the same server (or `refuse` with that status, or `joinUrl`
 * as given). `onMessage` answers each data message on the joined call; `onJoin` runs when a call is joined.
 */
async function ultravox(options: {
    refuse?: number;
    joinUrl?: string;
    onJoin?: (send: (m: object) => void, ws: WebSocket) => void;
    onMessage?: (message: Record<string, unknown>, send: (m: object) => void, ws: WebSocket) => void;
}): Promise<Ultravox> {
    const state: Ultravox = { url: '', calls: [], received: [], audioBytes: 0, joins: [] };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (d: Buffer) => (body += d.toString('utf8')));
        req.on('end', () => {
            state.calls.push({ url: req.url, key: req.headers['x-api-key'] as string | undefined, body: JSON.parse(body || '{}') as Record<string, unknown> });
            if (options.refuse) {
                res.writeHead(options.refuse, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: 'Refused' }));
                return;
            }
            const joinUrl = options.joinUrl ?? `${state.url.replace('http', 'ws')}/join/${state.calls.length}`;
            res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ callId: `call-${state.calls.length}`, joinUrl }));
        });
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        state.joins.push(`${req.url ?? ''}|${(req.headers['x-api-key'] as string | undefined) ?? ''}`);
        wss.handleUpgrade(req, socket, head, (ws) => {
            const send = (m: object) => ws.send(JSON.stringify(m));
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    state.audioBytes += (data as Buffer).length;
                    return;
                }
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                state.received.push(message);
                options.onMessage?.(message, send, ws);
            });
            options.onJoin?.(send, ws);
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
    state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return state;
}

function listener() {
    const heard = { partials: [] as string[], finals: [] as string[], failed: [] as { text: string; status?: number }[], endpoints: 0 };
    const events: RecognizerEvents = {
        partial: (text) => heard.partials.push(text),
        final: (text) => heard.finals.push(text),
        failed: (text, failure) => heard.failed.push({ text, status: failure?.status }),
        endpoint: () => heard.endpoints++,
    };
    return { heard, events };
}

const settings = (url: string) => ({ adapter: ULTRAVOX_ADAPTER, model: 'ultravox-v0.7', key: new Secret(KEY), endpoint: url, language: 'ar-KW' });

function speechRequest(url: string, extra: Partial<SpeechRequest> = {}): SpeechRequest {
    return {
        text: 'Welcome to the counter. What can I get you?',
        settings: { ...settings(url), voiceId: 'Mark' },
        expression: 'restrained',
        signal: new AbortController().signal,
        ...extra,
    };
}

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

const pcm = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer);
const said = (ordinal: number, extra: Record<string, unknown>) => ({ type: 'transcript', role: 'user', medium: 'voice', ordinal, final: false, ...extra });

describe('making a call', () => {
    it('makes it with the key in X-API-Key and joins at the address given back, which carries no key', async () => {
        const server = await ultravox({});
        const address = await makeCall(new Secret(KEY), `${server.url}/`, { model: 'ultravox-v0.7' });
        expect(server.calls).toEqual([{ url: '/api/calls?enableGreetingPrompt=false', key: KEY, body: { model: 'ultravox-v0.7' } }]);
        expect(address.url).toBe(`${server.url.replace('http', 'ws')}/join/1`);
        expect(address.url).not.toContain(KEY);
        expect(address).not.toHaveProperty('headers');
    });

    it('reads a refusal with its status (401 a wrong key, 402 no credit left), and never says the key', async () => {
        for (const status of [401, 402]) {
            const server = await ultravox({ refuse: status });
            const failure = await makeCall(new Secret(KEY), server.url, {}).catch((error: unknown) => error);
            expect(failure).toBeInstanceOf(ProviderError);
            expect((failure as ProviderError).status).toBe(status);
            expect(String((failure as Error).message)).not.toContain(KEY);
        }
    });

    it('follows no call address that is not a socket', async () => {
        const server = await ultravox({ joinUrl: 'https://elsewhere.example.com/join' });
        await expect(makeCall(new Secret(KEY), server.url, {})).rejects.toThrow('gave no address');
    });
});

describe('hearing', () => {
    it('makes a listen-only call that answers in text, sends the audio, and keeps the words Ultravox wrote down', async () => {
        const server = await ultravox({
            onMessage: (message, send) => {
                if (message.type === 'ping') send({ type: 'pong', timestamp: message.timestamp });
            },
            onJoin: (send) => {
                send({ type: 'state', state: 'listening' });
                send(said(1, { delta: 'One' }));
                send(said(1, { delta: ' coffee' }));
                send(said(1, { text: 'One coffee please', final: true }));
                // Its own answer, in text: never heard
                send({ type: 'transcript', role: 'agent', medium: 'text', ordinal: 2, text: 'Sure!', final: true });
            },
        });
        const { heard, events } = listener();
        const stream = new UltravoxRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320).fill(1000));
        await waitFor('the end of the turn', () => heard.endpoints === 1);
        expect(heard.partials).toContain('One coffee');
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['One coffee please']);
        expect(server.calls[0].key).toBe(KEY);
        expect(server.calls[0].body).toEqual({
            systemPrompt: LISTEN_ONLY,
            model: 'ultravox-v0.7',
            languageHint: 'ar',
            initialOutputMedium: 'MESSAGE_MEDIUM_TEXT',
            firstSpeakerSettings: { user: {} },
            recordingEnabled: false,
            maxDuration: '120s',
            medium: { serverWebSocket: { inputSampleRate: 16000, outputSampleRate: 24000 } },
        });
        // The call's socket carries no key; the audio goes as it is, 16 kHz s16le
        expect(server.joins).toEqual(['/join/1|']);
        await waitFor('the audio', () => server.audioBytes === 640);
        // Hung up when let go
        await waitFor('the hang up', () => server.received.some((message) => message.type === 'hang_up'));
        expect(server.received.map((message) => message.type)).toEqual(['ping', 'hang_up']);
    });

    it('waits for words still being written down when the stretch ends', async () => {
        const server = await ultravox({
            onMessage: (message, send) => {
                if (message.type !== 'ping') return;
                send({ type: 'pong', timestamp: message.timestamp });
                setTimeout(() => send(said(1, { text: 'Two teas', final: true })), 50);
            },
            onJoin: (send) => send(said(1, { text: 'Two' })),
        });
        const { heard, events } = listener();
        const stream = new UltravoxRecognition().listen(settings(server.url), events);
        await waitFor('the first words', () => heard.partials.includes('Two'));
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['Two teas']);
        expect(heard.endpoints).toBe(0);
    });

    it('ends with nothing heard when Ultravox wrote nothing down', async () => {
        const server = await ultravox({ onMessage: (message, send) => message.type === 'ping' && send({ type: 'pong', timestamp: message.timestamp }) });
        const { heard, events } = listener();
        const stream = new UltravoxRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        stream.finish();
        await waitFor('the end', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['']);
    });

    it('fails with 401 when the key is refused, and never says the key', async () => {
        const server = await ultravox({ refuse: 401 });
        const { heard, events } = listener();
        new UltravoxRecognition().listen(settings(server.url), events);
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed).toEqual([{ text: '', status: 401 }]);
        expect(JSON.stringify(heard)).not.toContain(KEY);
    });
});

describe('speaking', () => {
    it('says the Mind’s words as they are, in the picked voice, plays the audio, and ends once it is back to listening', async () => {
        const server = await ultravox({
            onMessage: (message, send, ws) => {
                if (message.type !== 'forced_agent_message') return;
                send({ type: 'state', state: 'speaking' });
                ws.send(pcm(1, 2), { binary: true });
                ws.send(pcm(3), { binary: true });
                send({ type: 'transcript', role: 'agent', medium: 'voice', ordinal: 1, text: message.content, final: true });
                send({ type: 'state', state: 'listening' });
            },
            // Listening before it speaks is not the end
            onJoin: (send) => send({ type: 'state', state: 'listening' }),
        });
        const request = speechRequest(server.url);
        expect(await collect(new UltravoxSpeech().speak(request))).toEqual([1, 2, 3]);
        expect(server.calls[0].body).toEqual({
            systemPrompt: `${READ_ALOUD} Read it in a calm, even voice.`,
            model: 'ultravox-v0.7',
            voice: 'Mark',
            firstSpeakerSettings: { user: {} },
            recordingEnabled: false,
            maxDuration: '300s',
            medium: { serverWebSocket: { inputSampleRate: 16000, outputSampleRate: 24000 } },
        });
        await waitFor('the hang up', () => server.received.some((message) => message.type === 'hang_up'));
        expect(server.received).toEqual([
            { type: 'forced_agent_message', content: request.text, uninterruptible: true, urgency: 'immediate' },
            { type: 'hang_up' },
        ]);
    });

    it('keeps each reply apart when two run at once', async () => {
        const server = await ultravox({
            onMessage: (message, send, ws) => {
                if (message.type !== 'forced_agent_message') return;
                const first = message.content === 'first';
                send({ type: 'state', state: 'speaking' });
                ws.send(pcm(first ? 1 : 2), { binary: true });
                setTimeout(() => send({ type: 'state', state: 'listening' }), first ? 80 : 10);
            },
        });
        const speech = new UltravoxSpeech();
        const [first, second] = await Promise.all([
            collect(speech.speak(speechRequest(server.url, { text: 'first' }))),
            collect(speech.speak(speechRequest(server.url, { text: 'second' }))),
        ]);
        expect(first).toEqual([1]);
        expect(second).toEqual([2]);
    });

    it('makes no call once the reply is no longer wanted', async () => {
        const server = await ultravox({});
        const controller = new AbortController();
        controller.abort();
        expect(await collect(new UltravoxSpeech().speak(speechRequest(server.url, { signal: controller.signal })))).toEqual([]);
        expect(server.joins).toEqual([]);
    });

    it('fails with 402 when the account has no credit left, and never says the key', async () => {
        const server = await ultravox({ refuse: 402 });
        const failure = await collect(new UltravoxSpeech().speak(speechRequest(server.url))).catch((error: unknown) => error);
        expect((failure as ProviderError).status).toBe(402);
        expect(String((failure as Error).message)).not.toContain(KEY);
    });
});

describe('the worker', () => {
    it('has Ultravox for hearing and speaking under one adapter', () => {
        const worker = new VoiceWorker({ connectors: new ConnectorRegistry() } as ConstructorParameters<typeof VoiceWorker>[0]);
        expect(worker.connectors.recognition('ultravox')).toBeInstanceOf(UltravoxRecognition);
        expect(worker.connectors.speech('ultravox')).toBeInstanceOf(UltravoxSpeech);
    });
});
