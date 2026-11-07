// Azure OpenAI's realtime models (game #1910): OpenAI's Realtime API on a person's own resource, against a stand-in server on
// loopback: no key, no network, no spend. Only what differs from OpenAI is tested here; the rest is openai.test.ts.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { AZURE_ADAPTER, AZURE_TRANSCRIPTION_MODEL, AzureRecognition, AzureSpeech, azureAddress } from '../src/azure.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'azure-test-key-321';

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

const settings = (url: string) => ({ adapter: AZURE_ADAPTER, model: 'realtime-prod', key: new Secret(KEY), endpoint: url, language: 'ar-KW' });

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
    it('is the deployment on the person’s own resource, with the key in the api-key header, on wss for an https address', () => {
        const address = azureAddress('realtime prod', new Secret(KEY), 'https://my-res.openai.azure.com/');
        expect(address.url).toBe('wss://my-res.openai.azure.com/openai/v1/realtime?model=realtime%20prod');
        expect(address.headers).toEqual({ 'api-key': KEY });
    });
});

describe('hearing', () => {
    it('listens on the deployment, with Azure’s own transcription model, and says the words written down', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type === 'input_audio_buffer.commit') {
                    send({ type: 'input_audio_buffer.committed', item_id: 'i1' });
                    send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'One coffee please' });
                }
            },
        });
        const { heard, events } = listener();
        const stream = new AzureRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['One coffee please']);
        expect(server.seen[0].url).toBe('/openai/v1/realtime?model=realtime-prod');
        expect(server.seen[0].authorization).toBeUndefined();
        const setup = server.received[0] as { session: { audio: { input: { transcription: unknown } } } };
        expect(setup.session.audio.input.transcription).toEqual({ model: AZURE_TRANSCRIPTION_MODEL, language: 'ar' });
        expect(server.received.some((event) => event.type === 'response.create')).toBe(false);
    });

    it('fails when the key has no address, without sending anything', async () => {
        const { heard, events } = listener();
        const stream = new AzureRecognition().listen({ ...settings(''), endpoint: undefined }, events);
        stream.push(new Int16Array(320));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(JSON.stringify(heard)).not.toContain(KEY);
    });

    it('fails with the status when the key is refused', async () => {
        const server = await realtime({ refuse: 401 });
        const { heard, events } = listener();
        const stream = new AzureRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed[0].status).toBe(401);
    });
});

describe('speaking', () => {
    it('reads the Mind’s words aloud on the deployment, in the picked voice', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.type !== 'response.create') return;
                send({ type: 'response.output_audio.delta', delta: b64(1, 2, 3) });
                send({ type: 'response.done', response: { status: 'completed' } });
            },
        });
        expect(await collect(new AzureSpeech().speak(speechRequest(server.url)))).toEqual([1, 2, 3]);
        expect(server.seen[0].url).toBe('/openai/v1/realtime?model=realtime-prod');
        const [setup] = server.received as [{ session: { audio: { output: { voice: string } } } }];
        expect(setup.session.audio.output.voice).toBe('marin');
    });

    it('fails with 401 when the key is refused, and never says the key', async () => {
        const server = await realtime({ refuse: 401 });
        const failure = await collect(new AzureSpeech().speak(speechRequest(server.url))).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(401);
        expect(String((failure as Error).message)).not.toContain(KEY);
    });
});

describe('the worker', () => {
    it('has Azure for hearing and speaking under one adapter', () => {
        const worker = new VoiceWorker({ connectors: new ConnectorRegistry() } as ConstructorParameters<typeof VoiceWorker>[0]);
        expect(worker.connectors.recognition('azure')).toBeInstanceOf(AzureRecognition);
        expect(worker.connectors.speech('azure')).toBeInstanceOf(AzureSpeech);
    });
});
