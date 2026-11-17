// Talking with Zoom's Voice Agent in live mode (game #1910), against a stand-in Zoom on loopback: no key, no network, no spend.
// The model hears and speaks; the bot's own Mind writes every answer.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { LISTEN_ONLY } from '../src/openai.ts';
import { SAY_ONLY, ZOOM_ADAPTER, ZoomRecognition, ZoomSpeech, readZoom, zoomAddress } from '../src/zoom.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'zoom-ai-test-key-987';
const PATH = '/v2/ws/aiservices/voice-agent/live';

interface Zoom {
    url: string;
    seen: { url?: string; authorization?: string; protocol?: string }[];
    received: Record<string, unknown>[];
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in Zoom. Its events come in Zoom's envelope. `onEvent` answers each client event; `refuse` answers the upgrade. */
async function zoom(options: { refuse?: number; onEvent?: (event: Record<string, unknown>, send: (m: Record<string, unknown>) => void, ws: WebSocket) => void }): Promise<Zoom> {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has('voice-agent.zoom.v2') ? 'voice-agent.zoom.v2' : false) });
    const state: Zoom = { url: '', seen: [], received: [] };
    server.on('upgrade', (req, socket, head) => {
        state.seen.push({ url: req.url, authorization: req.headers.authorization, protocol: req.headers['sec-websocket-protocol'] as string | undefined });
        if (options.refuse) {
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            const send = (m: Record<string, unknown>) => ws.send(JSON.stringify({ type: m.type, payload: m }));
            ws.on('message', (data) => {
                const event = JSON.parse(data.toString()) as Record<string, unknown>;
                state.received.push(event);
                options.onEvent?.(event, send, ws);
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

const settings = (url: string) => ({ adapter: ZOOM_ADAPTER, model: 'gemma-4', key: new Secret(KEY), endpoint: url, language: 'en-US' });

function speechRequest(url: string, extra: Partial<SpeechRequest> = {}): SpeechRequest {
    return {
        text: 'Welcome to the counter. What can I get you?',
        settings: { ...settings(url), voiceId: 'jenna' },
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
const audioOf = (event: Record<string, unknown>) => Buffer.from(event.audio as string, 'base64');

describe('the address', () => {
    it('is the live socket with Zoom’s subprotocol, the key in the Authorization header and not in the address', () => {
        const address = zoomAddress(new Secret(KEY), 'https://api.zoom.us/');
        expect(address.url).toBe(`wss://api.zoom.us${PATH}`);
        expect(address.url).not.toContain(KEY);
        expect(address.protocols).toEqual(['voice-agent.zoom.v2']);
        expect(address.headers).toEqual({ authorization: `Bearer ${KEY}` });
    });

    it('reads an event in Zoom’s envelope or on its own', () => {
        expect(readZoom(Buffer.from(JSON.stringify({ type: 'x', payload: { type: 'session.updated' } })), false)).toEqual({ type: 'session.updated' });
        expect(readZoom(Buffer.from(JSON.stringify({ type: 'session.updated' })), false)).toEqual({ type: 'session.updated' });
    });
});

describe('hearing', () => {
    it('waits for the session, sends the audio, and keeps the words Zoom wrote down, never what it answers', async () => {
        let updates = 0;
        const server = await zoom({
            onEvent: (event, send) => {
                if (event.type === 'session.update') {
                    updates++;
                    setTimeout(() => send({ type: 'session.updated', session: {} }), 10);
                }
                if (event.type === 'input_audio_buffer.append' && audioOf(event).some((byte) => byte !== 0) && updates === 1) {
                    send({ type: 'input_audio_buffer.speech_started' });
                    send({ type: 'input_audio_buffer.speech_stopped' });
                    send({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'One coffee please' });
                    // Its own answer, cut short: never heard
                    send({ type: 'response.output_audio_transcript.delta', delta: 'S' });
                }
            },
        });
        const { heard, events } = listener();
        const stream = new ZoomRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320).fill(1000));
        await waitFor('the end of the turn', () => heard.endpoints === 1);
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['One coffee please']);
        expect(server.seen[0]).toEqual({ url: PATH, authorization: `Bearer ${KEY}`, protocol: 'voice-agent.zoom.v2' });
        expect(server.received[0]).toEqual({
            type: 'session.update',
            session: {
                listen: { format: { type: 'pcm16', rate: 16000 }, transcription: { language: 'en' } },
                think: { provider: { type: 'zoom', model: 'gemma-4' }, instructions: LISTEN_ONLY, response_token_limit: 1 },
                speak: {},
            },
        });
        // The audio waited for the session, went as it is (16 kHz), then quiet and the session asked again
        expect(server.received.map((event) => event.type)).toEqual(['session.update', 'input_audio_buffer.append', 'input_audio_buffer.append', 'session.update']);
        expect(audioOf(server.received[1]).length).toBe(640);
        expect(audioOf(server.received[2]).every((byte) => byte === 0)).toBe(true);
    });

    it('waits for words still being written down when the stretch ends', async () => {
        const server = await zoom({
            onEvent: (event, send) => {
                if (event.type !== 'session.update') return;
                send({ type: 'session.updated' });
                if (server.received.filter((e) => e.type === 'session.update').length === 1) send({ type: 'input_audio_buffer.speech_started' });
                else setTimeout(() => send({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Two teas' }), 50);
            },
        });
        const { heard, events } = listener();
        const stream = new ZoomRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320).fill(1000));
        await waitFor('the session', () => server.received.length >= 2);
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['Two teas']);
    });

    it('finishes at once when a piece can’t be written down, keeping the words written down before it', async () => {
        const server = await zoom({
            onEvent: (event, send) => {
                if (event.type !== 'session.update') return;
                send({ type: 'session.updated' });
                if (server.received.filter((e) => e.type === 'session.update').length > 1) return;
                send({ type: 'input_audio_buffer.speech_started' });
                send({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'One coffee' });
                send({ type: 'input_audio_buffer.speech_started' });
                send({ type: 'conversation.item.input_audio_transcription.failed', error: { code: 'audio_unintelligible' } });
            },
        });
        const { heard, events } = listener();
        const stream = new ZoomRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320).fill(1000));
        await waitFor('both pieces', () => server.received.length >= 2);
        const started = Date.now();
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['One coffee']);
        expect(heard.failed).toEqual([]);
        // Not the wait for words that never come
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('fails with 401 when a piece can’t be written down because the key is refused', async () => {
        const server = await zoom({
            onEvent: (event, send) => {
                if (event.type !== 'session.update') return;
                send({ type: 'session.updated' });
                send({ type: 'input_audio_buffer.speech_started' });
                send({ type: 'conversation.item.input_audio_transcription.failed', error: { code: 'invalid_api_key' } });
            },
        });
        const { heard, events } = listener();
        const stream = new ZoomRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320).fill(1000));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed[0].status).toBe(401);
        expect(JSON.stringify(heard)).not.toContain(KEY);
    });

    it('ends with nothing heard when Zoom heard no speech', async () => {
        const server = await zoom({ onEvent: (event, send) => event.type === 'session.update' && send({ type: 'session.updated' }) });
        const { heard, events } = listener();
        const stream = new ZoomRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        stream.finish();
        await waitFor('the end', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['']);
    });

    it('fails with 401 when the key is refused at the door, and never says the key', async () => {
        const server = await zoom({ refuse: 401 });
        const { heard, events } = listener();
        new ZoomRecognition().listen(settings(server.url), events).push(new Int16Array(320));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed).toEqual([{ text: '', status: 401 }]);
        expect(JSON.stringify(heard)).not.toContain(KEY);
    });
});

describe('speaking', () => {
    it('gives the Mind’s words as the only thing to say, in the picked voice, once the session took them, and plays the audio', async () => {
        const server = await zoom({
            onEvent: (event, send) => {
                if (event.type === 'session.update') send({ type: 'session.updated' });
                if (event.type === 'response.create') {
                    send({ type: 'response.created', response: { id: 'r1' } });
                    send({ type: 'response.output_audio.delta', delta: b64(...new Array(160).fill(500)) });
                    send({ type: 'response.output_audio.delta', delta: b64(...new Array(160).fill(500)) });
                    send({ type: 'response.done', response: { status: 'completed' } });
                }
            },
        });
        const request = speechRequest(server.url);
        // 20 ms at 16 kHz from Zoom, played at the worker's 24 kHz
        const played = await collect(new ZoomSpeech().speak(request));
        expect(played.length).toBeGreaterThan(400);
        expect(played.length).toBeLessThanOrEqual(480);
        expect(server.received).toEqual([
            {
                type: 'session.update',
                session: {
                    listen: { format: { type: 'pcm16', rate: 16000 } },
                    think: {
                        provider: { type: 'zoom', model: 'gemma-4' },
                        instructions: `${SAY_ONLY} Read it in a calm, even voice.\n<<<\n${request.text}\n>>>`,
                    },
                    speak: { format: { type: 'pcm16', rate: 16000 }, voice: 'jenna' },
                },
            },
            { type: 'response.create' },
        ]);
    });

    it('fails when the response fails or Zoom reports an error', async () => {
        const failed = await zoom({
            onEvent: (event, send) => {
                if (event.type === 'session.update') send({ type: 'session.updated' });
                if (event.type === 'response.create') send({ type: 'response.done', response: { status: 'failed' } });
            },
        });
        await expect(collect(new ZoomSpeech().speak(speechRequest(failed.url)))).rejects.toBeInstanceOf(ProviderError);
        const error = await zoom({ onEvent: (event, send) => event.type === 'session.update' && send({ type: 'error', error: { type: 'server_error', message: 'busy' } }) });
        await expect(collect(new ZoomSpeech().speak(speechRequest(error.url)))).rejects.toBeInstanceOf(ProviderError);
    });

    it('fails with 401 when the key is refused at the door, and never says the key', async () => {
        const server = await zoom({ refuse: 401 });
        const failure = await collect(new ZoomSpeech().speak(speechRequest(server.url))).catch((error: unknown) => error);
        expect((failure as ProviderError).status).toBe(401);
        expect(String((failure as Error).message)).not.toContain(KEY);
    });
});

describe('the worker', () => {
    it('has Zoom for hearing and speaking under one adapter, a talking model going to the talking connector', () => {
        const worker = new VoiceWorker({ connectors: new ConnectorRegistry() } as ConstructorParameters<typeof VoiceWorker>[0]);
        // Zoom's Scribe shares the name for hearing (src/zoomScribe.ts): a talking model still talks
        const recognizer = { push: () => undefined, finish: () => undefined, close: () => undefined };
        const listen = vi.spyOn(ZoomRecognition.prototype, 'listen').mockReturnValue(recognizer as never);
        const events = { partial: () => undefined, final: () => undefined, failed: () => undefined };
        expect(worker.connectors.recognition('zoom')!.listen({ adapter: 'zoom', model: 'gemma-4', key: new Secret('k'), endpoint: '' }, events)).toBe(recognizer);
        expect(listen).toHaveBeenCalledTimes(1);
        vi.restoreAllMocks();
        expect(worker.connectors.speech('zoom')).toBeInstanceOf(ZoomSpeech);
    });
});
