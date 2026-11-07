// Inworld's realtime session (game #1910): OpenAI's Realtime events at Inworld, against a stand-in server on loopback: no key, no
// network, no spend. Only what differs from OpenAI is tested here; the rest is openai.test.ts.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { INWORLD_ADAPTER, INWORLD_TRANSCRIPTION_MODEL, InworldRecognition, InworldSpeech, inworldAddress } from '../src/inworld.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'aWQ6aW53b3JsZC1zZWNyZXQ=';

interface Realtime {
    url: string;
    seen: { url?: string; authorization?: string }[];
    received: Record<string, unknown>[];
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in Realtime server. `onEvent` answers each client event; `refuse` answers the upgrade with that status. */
async function realtime(options: { refuse?: number; onEvent?: (event: Record<string, unknown>, send: (m: object) => void, ws: WebSocket) => void }): Promise<Realtime> {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const state: Realtime = { url: '', seen: [], received: [] };
    server.on('upgrade', (req, socket, head) => {
        state.seen.push({ url: req.url, authorization: req.headers.authorization });
        if (options.refuse) {
            const body = JSON.stringify({ error: { code: 'invalid_api_key' } });
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.on('message', (data) => {
                const event = JSON.parse(data.toString()) as Record<string, unknown>;
                state.received.push(event);
                options.onEvent?.(event, (m) => ws.send(JSON.stringify(m)), ws);
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
    state.url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

const settings = (url: string) => ({ adapter: INWORLD_ADAPTER, model: 'inworld-tts-2', key: new Secret(KEY), endpoint: url, language: 'ar-KW' });

function speechRequest(url: string, extra: Partial<SpeechRequest> = {}): SpeechRequest {
    return {
        text: 'Welcome to the counter. What can I get you?',
        settings: { ...settings(url), voiceId: 'Olivia' },
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

const b64 = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer).toString('base64');

describe('the address', () => {
    it('is a fresh session of our own at Inworld, with the key as Basic, as it is, on wss for an https address', () => {
        const one = inworldAddress('inworld-tts-2', new Secret(KEY), 'https://api.inworld.ai/');
        const two = inworldAddress('inworld-tts-2', new Secret(KEY), 'https://api.inworld.ai/');
        expect(one.url).toMatch(/^wss:\/\/api\.inworld\.ai\/api\/v1\/realtime\/session\?key=[0-9a-f-]{36}&protocol=realtime$/);
        expect(one.url).not.toBe(two.url);
        expect(one.headers).toEqual({ authorization: `Basic ${KEY}` });
    });
});

describe('hearing', () => {
    it('listens with Inworld STT, never asks for an answer, and says the words written down', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.commit') {
                    send({ type: 'input_audio_buffer.committed', item_id: 'i1' });
                    send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'One coffee please' });
                }
            },
        });
        const { heard, events } = listener();
        const stream = new InworldRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['One coffee please']);
        expect(server.seen[0].url).toMatch(/^\/api\/v1\/realtime\/session\?key=[0-9a-f-]{36}&protocol=realtime$/);
        expect(server.seen[0].authorization).toBe(`Basic ${KEY}`);
        const setup = server.received[0] as { session: { audio: { input: { transcription: unknown; turn_detection: { create_response: boolean } } } } };
        expect(setup.session.audio.input.transcription).toEqual({ model: INWORLD_TRANSCRIPTION_MODEL, language: 'ar' });
        expect(setup.session.audio.input.turn_detection.create_response).toBe(false);
        expect(server.received.some((event) => event.type === 'response.create')).toBe(false);
    });

    it('fails with the status when the key is refused', async () => {
        const server = await realtime({ refuse: 401 });
        const { heard, events } = listener();
        const stream = new InworldRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed[0].status).toBe(401);
    });
});

describe('speaking', () => {
    /** A stand-in that takes the session's voice and model, then speaks given words. */
    const speaker = (answer: (send: (m: object) => void) => void) =>
        realtime({
            onEvent: (event, send) => {
                if (event.type === 'session.update') send({ type: 'session.updated', session: event.session });
                if (event.type === 'response.speak') answer(send);
            },
        });

    it('speaks the Mind’s words as they are, with the key’s TTS model and the picked voice, once the session took them', async () => {
        const server = await speaker((send) => {
            send({ type: 'response.speak.acknowledged', accepted: true, response_id: 'r1' });
            send({ type: 'response.output_audio.delta', delta: b64(1, 2) });
            send({ type: 'response.output_audio.delta', delta: b64(3) });
            send({ type: 'response.done', response: { status: 'completed' } });
        });
        expect(await collect(new InworldSpeech().speak(speechRequest(server.url)))).toEqual([1, 2, 3]);
        const [setup, speak] = server.received as [{ session: Record<string, unknown> & { audio: { output: unknown } } }, Record<string, unknown>];
        expect(setup.session.audio.output).toEqual({ format: { type: 'audio/pcm', rate: 24_000 }, voice: 'Olivia', model: 'inworld-tts-2' });
        // No LLM: nothing asks it to answer, and it is given no instructions to follow
        expect(setup.session.instructions).toBeUndefined();
        expect(speak).toEqual({ type: 'response.speak', text: 'Welcome to the counter. What can I get you?' });
        expect(server.received.some((event) => event.type === 'response.create' || event.type === 'conversation.item.create')).toBe(false);
        expect(server.seen[0].authorization).toBe(`Basic ${KEY}`);
    });

    it('waits for the session to take the voice before sending the words', async () => {
        const order: string[] = [];
        const server = await realtime({
            onEvent: (event, send) => {
                order.push(String(event.type));
                if (event.type === 'session.update') setTimeout(() => send({ type: 'session.updated' }), 50);
                if (event.type === 'response.speak') send({ type: 'response.done', response: { status: 'completed' } });
            },
        });
        await collect(new InworldSpeech().speak(speechRequest(server.url))).catch(() => undefined);
        expect(order).toEqual(['session.update', 'response.speak']);
    });

    it('fails when Inworld turns the words away or the reply fails', async () => {
        const refused = await speaker((send) => send({ type: 'response.speak.acknowledged', accepted: false, error: { code: 'invalid_value' } }));
        await expect(collect(new InworldSpeech().speak(speechRequest(refused.url)))).rejects.toBeInstanceOf(ProviderError);
        const failed = await speaker((send) => {
            send({ type: 'response.speak.acknowledged', accepted: true, response_id: 'r1' });
            send({ type: 'response.done', response: { status: 'failed' } });
        });
        await expect(collect(new InworldSpeech().speak(speechRequest(failed.url)))).rejects.toBeInstanceOf(ProviderError);
    });

    it('fails with 401 when the key is refused, and never says the key', async () => {
        const server = await realtime({ refuse: 401 });
        const failure = await collect(new InworldSpeech().speak(speechRequest(server.url))).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(401);
        expect(String((failure as Error).message)).not.toContain(KEY);
    });
});

describe('the worker', () => {
    it('has Inworld for hearing and speaking under one adapter', () => {
        const worker = new VoiceWorker({ connectors: new ConnectorRegistry() } as ConstructorParameters<typeof VoiceWorker>[0]);
        expect(worker.connectors.recognition('inworld')).toBeInstanceOf(InworldRecognition);
        expect(worker.connectors.speech('inworld')).toBeInstanceOf(InworldSpeech);
    });
});
