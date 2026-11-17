// Talking with xAI's Grok Voice (game #1910), against a stand-in Realtime server on loopback: no key, no network, no spend.
// The model hears and speaks; the bot's own Mind writes every answer, so the model is never asked to answer.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { LISTEN_ONLY, READ_ALOUD } from '../src/openai.ts';
import { XAI_ADAPTER, XAI_TRANSCRIPTION_MODEL, XaiRecognition, XaiSpeech, xaiLanguageHint } from '../src/xai.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'xai-test-789';

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

const settings = (url: string) => ({ adapter: XAI_ADAPTER, model: 'grok-voice-latest', key: new Secret(KEY), endpoint: url, language: 'ar-KW' });

function speechRequest(url: string, extra: Partial<SpeechRequest> = {}): SpeechRequest {
    return {
        text: 'Welcome to the counter. What can I get you?',
        settings: { ...settings(url), voiceId: 'eve' },
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

describe('the language hint', () => {
    it('is the base language, with the region only for Spanish and Portuguese', () => {
        expect(xaiLanguageHint('ar-KW')).toBe('ar');
        expect(xaiLanguageHint('en')).toBe('en');
        expect(xaiLanguageHint('pt-BR')).toBe('pt-BR');
        expect(xaiLanguageHint('es_MX')).toBe('es-MX');
    });
});

describe('hearing', () => {
    it('sets up a session with no turn detection, sends 16 kHz audio as it is, and says the words written down', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.append') {
                    send({ type: 'conversation.item.input_audio_transcription.updated', item_id: 'i1', transcript: 'مرحبا' });
                    send({ type: 'conversation.item.input_audio_transcription.updated', item_id: 'i1', transcript: 'مرحبا كيف' });
                }
                if (event.type === 'input_audio_buffer.commit') {
                    send({ type: 'input_audio_buffer.committed', item_id: 'i1' });
                    send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'مرحبا كيف حالك' });
                }
            },
        });
        const { heard, events } = listener();
        const stream = new XaiRecognition().listen(settings(server.url), events);
        expect(stream.pauseMs).toBeUndefined();
        stream.push(new Int16Array(320).fill(1000));
        await waitFor('the words so far', () => heard.partials.includes('مرحبا كيف'));
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['مرحبا كيف حالك']);
        expect(server.seen[0]).toEqual({ url: '/v1/realtime?model=grok-voice-latest', authorization: `Bearer ${KEY}` });
        const setup = server.received[0] as { type: string; session: Record<string, unknown> };
        expect(setup.type).toBe('session.update');
        expect(setup.session).toEqual({
            instructions: LISTEN_ONLY,
            turn_detection: null,
            audio: {
                input: {
                    format: { type: 'audio/pcm', rate: 16000 },
                    transcription: { model: XAI_TRANSCRIPTION_MODEL, language_hint: 'ar' },
                },
            },
        });
        // 20 ms at 16 kHz goes in as it is
        const append = server.received.find((event) => event.type === 'input_audio_buffer.append') as { audio: string };
        expect(Buffer.from(append.audio, 'base64').length / 2).toBe(320);
        // Never asked to answer
        expect(server.received.some((event) => event.type === 'response.create')).toBe(false);
        stream.close();
    });

    it('ends with nothing heard when there was nothing to commit', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.commit') send({ type: 'error', error: { type: 'invalid_request_error', code: 'input_audio_buffer_commit_empty' } });
            },
        });
        const { heard, events } = listener();
        const stream = new XaiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        stream.finish();
        await waitFor('the end', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['']);
        expect(heard.failed).toEqual([]);
    });

    it('fails with the status when the key is refused, and never says the key', async () => {
        const server = await realtime({ refuse: 401 });
        const { heard, events } = listener();
        const stream = new XaiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed[0].status).toBe(401);
        expect(JSON.stringify(heard)).not.toContain(KEY);
    });
});

describe('speaking', () => {
    it('reads the Mind’s words as the one item of the socket, in the picked voice, and plays the audio as it comes', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type !== 'response.create') return;
                send({ type: 'response.output_audio.delta', delta: b64(1, 2, 3) });
                send({ type: 'response.output_audio.delta', delta: b64(4, 5) });
                send({ type: 'response.done', response: { status: 'completed' } });
            },
        });
        const request = speechRequest(server.url);
        expect(await collect(new XaiSpeech().speak(request))).toEqual([1, 2, 3, 4, 5]);
        expect(server.received.map((event) => event.type)).toEqual(['session.update', 'conversation.item.create', 'response.create']);
        const [setup, item] = server.received as [{ session: Record<string, unknown> }, { item: Record<string, unknown> }];
        expect(setup.session).toEqual({
            instructions: `${READ_ALOUD} Read it in a calm, even voice.`,
            voice: 'eve',
            reasoning: { effort: 'none' },
            turn_detection: null,
            audio: { output: { format: { type: 'audio/pcm', rate: 24000 } } },
        });
        expect(item.item).toEqual({ type: 'message', role: 'user', content: [{ type: 'input_text', text: request.text }] });
    });

    it('fails when the response fails, keeping what already played', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type !== 'response.create') return;
                send({ type: 'response.output_audio.delta', delta: b64(7, 8) });
                send({ type: 'response.done', response: { status: 'failed' } });
            },
        });
        const played: number[] = [];
        await expect(
            (async () => {
                for await (const chunk of new XaiSpeech().speak(speechRequest(server.url))) played.push(...chunk);
            })()
        ).rejects.toBeInstanceOf(ProviderError);
        expect(played).toEqual([7, 8]);
    });

    it('fails with 401 when the key is refused, and never says the key', async () => {
        const server = await realtime({ refuse: 401 });
        const failure = await collect(new XaiSpeech().speak(speechRequest(server.url))).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(401);
        expect(String((failure as Error).message)).not.toContain(KEY);
    });
});

describe('the worker', () => {
    it('has xAI for hearing and speaking under one adapter, a talking model going to the talking connectors', async () => {
        const worker = new VoiceWorker({ connectors: new ConnectorRegistry() } as ConstructorParameters<typeof VoiceWorker>[0]);
        // xAI's own transcription and text to speech share the name (src/xaiVoice.ts): a talking model still talks
        const recognizer = { push: () => undefined, finish: () => undefined, close: () => undefined };
        const listen = vi.spyOn(XaiRecognition.prototype, 'listen').mockReturnValue(recognizer as never);
        const events = { partial: () => undefined, final: () => undefined, failed: () => undefined };
        expect(worker.connectors.recognition('xai')!.listen({ adapter: 'xai', model: 'grok-voice-latest', key: new Secret('k'), endpoint: '' }, events)).toBe(recognizer);
        expect(listen).toHaveBeenCalledTimes(1);
        const speak = vi.spyOn(XaiSpeech.prototype, 'speak').mockImplementation(async function* () {
            yield new Int16Array([3]);
        });
        const said: number[] = [];
        for await (const piece of worker.connectors.speech('xai')!.speak({
            text: 'Hi',
            settings: { adapter: 'xai', model: 'grok-voice-latest', voiceId: 'ara', key: new Secret('k'), endpoint: '' },
            signal: new AbortController().signal,
        }))
            said.push(...piece);
        expect(said).toEqual([3]);
        expect(speak).toHaveBeenCalledTimes(1);
        vi.restoreAllMocks();
    });
});
