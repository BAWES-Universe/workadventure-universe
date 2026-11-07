// Talking with Google's Gemini Live (game #1910), against a stand-in Live server on loopback: no key, no network, no spend.
// The model hears and speaks; the bot's own Mind writes every answer.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { LISTEN_ONLY, READ_ALOUD } from '../src/openai.ts';
import { GOOGLE_ADAPTER, GoogleRecognition, GoogleSpeech, liveAddress } from '../src/google.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'AIza-test-google-654';

interface Realtime {
    url: string;
    seen: { url?: string; authorization?: string; googKey?: string }[];
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
        state.seen.push({ url: req.url, authorization: req.headers.authorization, googKey: req.headers['x-goog-api-key'] as string | undefined });
        if (options.refuse) {
            const body = JSON.stringify({ error: { code: 'invalid_api_key' } });
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.on('message', (data) => {
                const event = JSON.parse(data.toString()) as Record<string, unknown>;
                state.received.push(event);
                options.onEvent?.(event, (m) => ws.send(Buffer.from(JSON.stringify(m)), { binary: true }), ws);
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

const settings = (url: string) => ({ adapter: GOOGLE_ADAPTER, model: 'gemini-3.8-live', key: new Secret(KEY), endpoint: url, language: 'ar-KW' });

function speechRequest(url: string, extra: Partial<SpeechRequest> = {}): SpeechRequest {
    return {
        text: 'Welcome to the counter. What can I get you?',
        settings: { ...settings(url), voiceId: 'Kore' },
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

const PATH = '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const turn = (extra: Record<string, unknown>) => ({ serverContent: extra });

describe('the address', () => {
    it('is the Live socket, with the key in the x-goog-api-key header and not in the address', () => {
        const address = liveAddress(new Secret(KEY), 'https://generativelanguage.googleapis.com/');
        expect(address.url).toBe(`wss://generativelanguage.googleapis.com${PATH}`);
        expect(address.url).not.toContain(KEY);
        expect(address.headers).toEqual({ 'x-goog-api-key': KEY });
    });
});

describe('hearing', () => {
    it('waits for the setup to be taken, marks the speech itself, and says the words written down', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.setup) setTimeout(() => send({ setupComplete: {} }), 20);
                const input = event.realtimeInput as Record<string, unknown> | undefined;
                if (input?.audio) send(turn({ inputTranscription: { text: 'One coffee' } }));
                if (input?.activityEnd) {
                    send(turn({ inputTranscription: { text: ' please' } }));
                    send(turn({ modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: b64(9) } }] } }));
                    send(turn({ turnComplete: true }));
                }
            },
        });
        const { heard, events } = listener();
        const stream = new GoogleRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320).fill(1000));
        await waitFor('the first words', () => heard.partials.includes('One coffee'));
        stream.finish();
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['One coffee please']);
        expect(server.seen[0]).toEqual({ url: PATH, authorization: undefined, googKey: KEY });
        // Setup first; nothing else until it was taken; then the start of speech, the audio, and its end
        const kinds = server.received.map((event) => (event.setup ? 'setup' : Object.keys(event.realtimeInput as object)[0]));
        expect(kinds).toEqual(['setup', 'activityStart', 'audio', 'activityEnd']);
        expect(server.received[0].setup).toEqual({
            model: 'models/gemini-3.8-live',
            generationConfig: { responseModalities: ['AUDIO'], maxOutputTokens: 1 },
            systemInstruction: { parts: [{ text: LISTEN_ONLY }] },
            inputAudioTranscription: {},
            realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        });
        const audio = (server.received[2].realtimeInput as { audio: { mimeType: string; data: string } }).audio;
        expect(audio.mimeType).toBe('audio/pcm;rate=16000');
        expect(Buffer.from(audio.data, 'base64').length).toBe(640);
    });

    it('fails when Google closes the socket (a key it refused)', async () => {
        const server = await realtime({ onEvent: (event, _send, ws) => event.setup && ws.close(1008, 'API key not valid') });
        const { heard, events } = listener();
        const stream = new GoogleRecognition().listen(settings(server.url), events);
        stream.push(new Int16Array(320));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(JSON.stringify(heard)).not.toContain(KEY);
    });
});

describe('speaking', () => {
    it('sends the words once the setup is taken, in the picked voice, and plays each piece of audio', async () => {
        const server = await realtime({
            onEvent: (event, send) => {
                if (event.setup) send({ setupComplete: {} });
                if ((event.realtimeInput as { text?: string } | undefined)?.text) {
                    send(turn({ modelTurn: { parts: [{ inlineData: { data: b64(1, 2) } }, { inlineData: { data: b64(3) } }] } }));
                    send(turn({ modelTurn: { parts: [{ inlineData: { data: b64(4, 5) } }] } }));
                    send(turn({ turnComplete: true }));
                }
            },
        });
        const request = speechRequest(server.url);
        expect(await collect(new GoogleSpeech().speak(request))).toEqual([1, 2, 3, 4, 5]);
        expect(server.received).toEqual([
            {
                setup: {
                    model: 'models/gemini-3.8-live',
                    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
                    systemInstruction: { parts: [{ text: `${READ_ALOUD} Read it in a calm, even voice.` }] },
                },
            },
            { realtimeInput: { text: request.text } },
        ]);
    });

    it('fails when Google reports an error', async () => {
        const server = await realtime({ onEvent: (event, send) => event.setup && send({ error: { code: 429, message: 'quota' } }) });
        await expect(collect(new GoogleSpeech().speak(speechRequest(server.url)))).rejects.toBeInstanceOf(ProviderError);
    });

    it('fails with 401 when the key is refused at the door, and never says the key', async () => {
        const server = await realtime({ refuse: 401 });
        const failure = await collect(new GoogleSpeech().speak(speechRequest(server.url))).catch((error: unknown) => error);
        expect((failure as ProviderError).status).toBe(401);
        expect(String((failure as Error).message)).not.toContain(KEY);
    });
});

describe('the worker', () => {
    it('has Google for hearing and speaking under one adapter', () => {
        const worker = new VoiceWorker({ connectors: new ConnectorRegistry() } as ConstructorParameters<typeof VoiceWorker>[0]);
        expect(worker.connectors.recognition('google')).toBeInstanceOf(GoogleRecognition);
        expect(worker.connectors.speech('google')).toBeInstanceOf(GoogleSpeech);
    });
});
