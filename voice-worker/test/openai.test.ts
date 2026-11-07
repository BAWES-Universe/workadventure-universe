// Talking with OpenAI's realtime models (game #1910), against a stand-in Realtime server on loopback: no key, no network, no
// spend. The model hears and speaks; the bot's own Mind writes every answer, so the model is never asked to answer.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { LISTEN_ONLY, OPENAI_ADAPTER, OPENAI_TRANSCRIPTION_MODEL, OpenAiRecognition, OpenAiSpeech, READ_ALOUD, realtimeAddress } from '../src/openai.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'sk-test-openai-456';

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

const settings = (url: string) => ({ adapter: OPENAI_ADAPTER, model: 'gpt-realtime-2.1', key: new Secret(KEY), endpoint: url, language: 'ar-KW' });

function speechRequest(url: string, extra: Partial<SpeechRequest> = {}): SpeechRequest {
    return {
        text: 'Welcome to the counter. What can I get you?',
        settings: { ...settings(url), voiceId: 'marin' },
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
    it('is the model’s Realtime socket with the key as a bearer, on wss for an https address', () => {
        const address = realtimeAddress('gpt-realtime-2.1', new Secret(KEY), 'https://api.openai.com/');
        expect(address.url).toBe('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1');
        expect(address.headers).toEqual({ authorization: `Bearer ${KEY}` });
    });
});

describe('hearing', () => {
    it('sets up a listen-only session, sends 24 kHz audio, and says the words the model wrote down', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.append') {
                    send({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'مرحبا ' });
                    send({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'كيف' });
                }
                if (event.type === 'input_audio_buffer.commit') {
                    send({ type: 'input_audio_buffer.committed', item_id: 'i1' });
                    send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'مرحبا كيف حالك' });
                }
            },
        });
        const { heard, events } = listener();
        const stream = new OpenAiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320).fill(1000));
        await waitFor('the first words', () => heard.partials.length >= 1);
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['مرحبا كيف حالك']);
        expect(heard.partials).toContain('مرحبا كيف');
        expect(server.seen[0]).toEqual({ url: '/v1/realtime?model=gpt-realtime-2.1', authorization: `Bearer ${KEY}` });
        const setup = server.received[0] as { type: string; session: Record<string, unknown> };
        expect(setup.type).toBe('session.update');
        expect(setup.session).toEqual({
            type: 'realtime',
            output_modalities: ['text'],
            instructions: LISTEN_ONLY,
            audio: {
                input: {
                    format: { type: 'audio/pcm', rate: 24000 },
                    transcription: { model: OPENAI_TRANSCRIPTION_MODEL, language: 'ar' },
                    turn_detection: { type: 'semantic_vad', create_response: false, interrupt_response: false },
                },
            },
        });
        // 20 ms at 16 kHz goes in as about 20 ms at 24 kHz (the resampler holds back a few samples for the next piece)
        const append = server.received.find((event) => event.type === 'input_audio_buffer.append') as { audio: string };
        const samples = Buffer.from(append.audio, 'base64').length / 2;
        expect(samples).toBeGreaterThan(440);
        expect(samples).toBeLessThanOrEqual(480);
        // Never asked to answer
        expect(server.received.some((event) => event.type === 'response.create')).toBe(false);
        stream.close();
    });

    it('passes on the model’s end of speech, and waits for every piece its turn detection committed', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.append') {
                    send({ type: 'input_audio_buffer.speech_started', item_id: 'i1' });
                    send({ type: 'input_audio_buffer.speech_stopped', item_id: 'i1' });
                    send({ type: 'input_audio_buffer.committed', item_id: 'i1' });
                }
                // The turn detection already committed the words: only the quiet after them is cleared
                if (event.type === 'input_audio_buffer.clear') {
                    send({ type: 'input_audio_buffer.cleared' });
                    setTimeout(() => send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'One coffee please' }), 30);
                }
            },
        });
        const { heard, events } = listener();
        const stream = new OpenAiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the end of speech', () => heard.endpoints === 1);
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['One coffee please']);
        expect(heard.failed).toEqual([]);
        // The quiet after the turn is never committed as a piece of its own
        expect(server.received.some((event) => event.type === 'input_audio_buffer.commit')).toBe(false);
    });

    it('finishes at once when the turn is written down before the quiet after it is cleared', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.append') {
                    send({ type: 'input_audio_buffer.speech_started', item_id: 'i1' });
                    send({ type: 'input_audio_buffer.speech_stopped', item_id: 'i1' });
                    send({ type: 'input_audio_buffer.committed', item_id: 'i1' });
                    send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'Hello there' });
                }
                if (event.type === 'input_audio_buffer.clear') send({ type: 'input_audio_buffer.cleared' });
            },
        });
        const { heard, events } = listener();
        const stream = new OpenAiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the words', () => heard.partials.includes('Hello there'));
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['Hello there']);
    });

    it('still commits when the person started again after the model’s turn ended', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.append' && !server.received.some((e) => e.type === 'input_audio_buffer.commit')) {
                    if (server.received.filter((e) => e.type === 'input_audio_buffer.append').length === 1) {
                        send({ type: 'input_audio_buffer.speech_started', item_id: 'i1' });
                        send({ type: 'input_audio_buffer.speech_stopped', item_id: 'i1' });
                        send({ type: 'input_audio_buffer.committed', item_id: 'i1' });
                        send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'One coffee' });
                        send({ type: 'input_audio_buffer.speech_started', item_id: 'i2' });
                    }
                }
                if (event.type === 'input_audio_buffer.commit') {
                    send({ type: 'input_audio_buffer.committed', item_id: 'i2', previous_item_id: 'i1' });
                    send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i2', transcript: 'and a tea' });
                }
            },
        });
        const { heard, events } = listener();
        const stream = new OpenAiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the first words', () => heard.partials.includes('One coffee'));
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['One coffee and a tea']);
        expect(server.received.some((event) => event.type === 'input_audio_buffer.clear')).toBe(false);
    });

    it('keeps a stretch’s pieces in the order they were committed, whatever order their words come in', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.append') {
                    send({ type: 'input_audio_buffer.committed', item_id: 'i1' });
                    send({ type: 'input_audio_buffer.committed', item_id: 'i2', previous_item_id: 'i1' });
                }
                if (event.type === 'input_audio_buffer.commit') {
                    send({ type: 'error', error: { type: 'invalid_request_error', code: 'input_audio_buffer_commit_empty' } });
                    // The second piece is written down first
                    send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i2', transcript: 'with oat milk' });
                    setTimeout(() => send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'One coffee' }), 30);
                }
            },
        });
        const { heard, events } = listener();
        const stream = new OpenAiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('both commits', () => server.received.length >= 2);
        await new Promise((resolve) => setTimeout(resolve, 30));
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['One coffee with oat milk']);
    });

    it('reports a refused key when a piece can’t be written down', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.append') {
                    send({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'i1', error: { type: 'invalid_request_error', code: 'invalid_api_key' } });
                }
            },
        });
        const { heard, events } = listener();
        const stream = new OpenAiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed[0].status).toBe(401);
    });

    it('fails with the status when the key is refused', async () => {
        const server = await realtime({ refuse: 401 });
        const { heard, events } = listener();
        const stream = new OpenAiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed[0].status).toBe(401);
        expect(JSON.stringify(heard)).not.toContain(KEY);
    });

    it('reports running out of credit as 402', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.append') send({ type: 'error', error: { type: 'insufficient_quota', code: 'insufficient_quota' } });
            },
        });
        const { heard, events } = listener();
        const stream = new OpenAiRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed[0].status).toBe(402);
    });
});

describe('speaking', () => {
    it('reads the Mind’s words aloud out of band, in the picked voice, and plays the audio as it comes', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type !== 'response.create') return;
                send({ type: 'response.output_audio.delta', delta: b64(1, 2, 3) });
                send({ type: 'response.output_audio.delta', delta: b64(4, 5) });
                send({ type: 'response.done', response: { status: 'completed' } });
            },
        });
        const request = speechRequest(server.url);
        expect(await collect(new OpenAiSpeech().speak(request))).toEqual([1, 2, 3, 4, 5]);
        const [setup, create] = server.received as [{ session: Record<string, unknown> }, { response: Record<string, unknown> }];
        expect(setup.session).toEqual({
            type: 'realtime',
            output_modalities: ['audio'],
            instructions: `${READ_ALOUD} Read it in a calm, even voice.`,
            audio: { input: { turn_detection: null }, output: { voice: 'marin', format: { type: 'audio/pcm', rate: 24000 } } },
        });
        // The words go in as the one message to read; nothing is kept in a conversation
        expect(create.response).toEqual({
            conversation: 'none',
            output_modalities: ['audio'],
            input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: request.text }] }],
        });
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
                for await (const chunk of new OpenAiSpeech().speak(speechRequest(server.url))) played.push(...chunk);
            })()
        ).rejects.toBeInstanceOf(ProviderError);
        expect(played).toEqual([7, 8]);
    });

    it('reports running out of credit when the response fails for that reason', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type !== 'response.create') return;
                send({ type: 'response.done', response: { status: 'failed', status_details: { type: 'failed', error: { type: 'insufficient_quota', code: 'insufficient_quota' } } } });
            },
        });
        const failure = await collect(new OpenAiSpeech().speak(speechRequest(server.url))).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(402);
    });

    it('fails with 401 when the key is refused, and never says the key', async () => {
        const server = await realtime({ refuse: 401 });
        const failure = await collect(new OpenAiSpeech().speak(speechRequest(server.url))).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(401);
        expect(String((failure as Error).message)).not.toContain(KEY);
    });
});

describe('the worker', () => {
    it('has OpenAI for hearing and speaking under one adapter', () => {
        const worker = new VoiceWorker({ connectors: new ConnectorRegistry() } as ConstructorParameters<typeof VoiceWorker>[0]);
        expect(worker.connectors.recognition('openai')).toBeInstanceOf(OpenAiRecognition);
        expect(worker.connectors.speech('openai')).toBeInstanceOf(OpenAiSpeech);
    });
});
