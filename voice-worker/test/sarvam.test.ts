// Hearing and speaking with Sarvam AI (#1903), against a stand-in Sarvam server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { SARVAM_ADAPTER, SarvamRecognition, SarvamSpeech, sarvamLanguage } from '../src/sarvam.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'sarvam-key-713';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in Sarvam: both sockets, answered by `onMessage`. */
async function fakeSarvam(onMessage: (ws: WebSocket, message: Record<string, unknown>) => void = () => undefined) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = {
        sockets: [] as { url: string; key?: string }[],
        messages: [] as Record<string, unknown>[],
    };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        seen.sockets.push({
            url: req.url ?? '',
            key: req.headers['api-subscription-key'] as string | undefined,
        });
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data) => {
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                seen.messages.push(message);
                onMessage(ws, message);
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
            }),
    );
    return {
        base: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
        seen,
        send: (m: object) => current?.send(JSON.stringify(m)),
    };
}

function heard() {
    const got = {
        partials: [] as string[],
        finals: [] as string[],
        failures: [] as { text: string; status?: number }[],
    };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        endpoint: () => undefined,
        failed: (text, failure) =>
            got.failures.push({
                text,
                ...(failure?.status === undefined ? {} : { status: failure.status }),
            }),
    };
    return { got, events };
}

const hearing = (endpoint: string, changes: object = {}) => ({
    adapter: 'sarvam',
    model: 'saaras:v4',
    key: new Secret(KEY),
    endpoint,
    language: 'hi-IN',
    ...changes,
});
const data = (transcript: string) => ({
    type: 'data',
    data: { request_id: 'r', transcript, language_code: 'hi-IN' },
});

describe('hearing with Sarvam AI', () => {
    it('opens the socket with the key in its header, sends base64 audio, and ends with the words Sarvam sends for the flush', async () => {
        const s = await fakeSarvam((ws, message) => {
            if (message.type === 'flush') ws.send(JSON.stringify(data('aap kaise hain?')));
        });
        const { got, events } = heard();
        const stream = new SarvamRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array([1, 2]));
        await waitFor('the audio', () => s.seen.messages.length === 1);
        s.send(data('Namaste,'));
        await waitFor('the first words', () => got.partials.length === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Namaste,', 'Namaste, aap kaise hain?']);
        expect(got.finals).toEqual(['Namaste, aap kaise hain?']);
        expect(s.seen.sockets).toEqual([
            {
                url: '/speech-to-text/ws?model=saaras%3Av4&language-code=hi-IN&sample_rate=16000&input_audio_codec=pcm_s16le&flush_signal=true&vad_signals=true',
                key: KEY,
            },
        ]);
        expect(s.seen.messages).toEqual([
            {
                audio: {
                    data: Buffer.from(new Int16Array([1, 2]).buffer).toString('base64'),
                    sample_rate: 16000,
                    encoding: 'audio/wav',
                },
            },
            { type: 'flush' },
        ]);
    });

    it("keeps the flush's words when an earlier segment's words arrive after the flush was sent", async () => {
        const s = await fakeSarvam((ws, message) => {
            if (message.type !== 'flush') return;
            ws.send(JSON.stringify(data('aap kaise')));
            setTimeout(() => ws.send(JSON.stringify(data('hain?'))), 100);
        });
        const { got, events } = heard();
        const stream = new SarvamRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array([1, 2]));
        await waitFor('the audio', () => s.seen.messages.length === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['aap kaise hain?']);
    });

    it('ends with what was heard when Sarvam sends nothing for the flush, and lets it work out a language it has no code for', async () => {
        const s = await fakeSarvam();
        const { got, events } = heard();
        const stream = new SarvamRecognition({ lastWordsMs: 300 }).listen(hearing(s.base, { language: 'ar-KW' }), events);
        stream.push(new Int16Array([3]));
        await waitFor('the audio', () => s.seen.messages.length === 1);
        expect(s.seen.sockets[0].url).toContain('language-code=unknown');
        s.send(data('Shukriya.'));
        await waitFor('the words', () => got.partials.length === 1);
        const started = Date.now();
        stream.finish();
        await waitFor('the end', () => got.finals.length === 1);
        expect(Date.now() - started).toBeGreaterThanOrEqual(250);
        expect(got.finals).toEqual(['Shukriya.']);
        expect(got.failures).toEqual([]);
    });

    it("ends soon after the flush when Sarvam's VAD says all the speech it heard is answered", async () => {
        const s = await fakeSarvam();
        const { got, events } = heard();
        const stream = new SarvamRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array([3]));
        await waitFor('the audio', () => s.seen.messages.length === 1);
        s.send({ type: 'events', data: { signal_type: 'START_SPEECH', occured_at: 1 } });
        s.send({ type: 'events', data: { signal_type: 'END_SPEECH', occured_at: 2 } });
        s.send(data('Dhanyavaad.'));
        await waitFor('the words', () => got.partials.length === 1);
        const started = Date.now();
        stream.finish();
        await waitFor('the end', () => got.finals.length === 1);
        // Not the 5 s Sarvam's last words may take when it may still hold some
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(got.finals).toEqual(['Dhanyavaad.']);
        expect(s.seen.messages.at(-1)).toEqual({ type: 'flush' });
    });

    it('still waits for the flush answer while speech Sarvam heard has no words yet', async () => {
        const s = await fakeSarvam((ws, message) => {
            if (message.type === 'flush') setTimeout(() => ws.send(JSON.stringify(data('phir milenge.'))), 600);
        });
        const { got, events } = heard();
        const stream = new SarvamRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array([3]));
        await waitFor('the audio', () => s.seen.messages.length === 1);
        s.send({ type: 'events', data: { signal_type: 'START_SPEECH', occured_at: 1 } });
        s.send(data('Achha,'));
        s.send({ type: 'events', data: { signal_type: 'START_SPEECH', occured_at: 3 } });
        await waitFor('the words', () => got.partials.length === 1);
        stream.finish();
        await waitFor('the end', () => got.finals.length === 1);
        expect(got.finals).toEqual(['Achha, phir milenge.']);
    });

    it('fails with the status of an error Sarvam sends', async () => {
        const s = await fakeSarvam();
        const { got, events } = heard();
        new SarvamRecognition().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.sockets.length === 1);
        s.send({
            type: 'error',
            data: { error: 'Invalid API subscription key', code: 'unauthorized' },
        });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });

    it("names a language by Sarvam's code", () => {
        expect(sarvamLanguage('hi')).toBe('hi-IN');
        expect(sarvamLanguage('en-US')).toBe('en-IN');
        expect(sarvamLanguage('or-IN')).toBe('od-IN');
        expect(sarvamLanguage('ar')).toBeUndefined();
    });
});

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Namaste.',
    settings: {
        adapter: 'sarvam',
        model: 'bulbul:v3',
        voiceId: 'priya',
        key: new Secret(KEY),
        endpoint: base,
        language: 'hi-IN',
        ...settings,
    },
    signal: new AbortController().signal,
    ...changes,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

const s16 = (...values: number[]) => Buffer.from(new Int16Array(values).buffer).toString('base64');

describe('speaking with Sarvam AI', () => {
    it('sends the setup, the text and a flush with the key in its header, and plays the audio until the final event', async () => {
        const s = await fakeSarvam((ws, message) => {
            if (message.type !== 'flush') return;
            ws.send(
                JSON.stringify({
                    type: 'audio',
                    data: { audio: s16(1, 2), content_type: 'audio/wav' },
                }),
            );
            ws.send(JSON.stringify({ type: 'audio', data: { audio: s16(3) } }));
            ws.send(JSON.stringify({ type: 'event', data: { event_type: 'final' } }));
        });
        expect(await collect(new SarvamSpeech().speak(speaking(s.base)))).toEqual([1, 2, 3]);
        expect(s.seen.sockets).toEqual([
            {
                url: '/text-to-speech/ws?model=bulbul%3Av3&send_completion_event=true',
                key: KEY,
            },
        ]);
        expect(s.seen.messages).toEqual([
            {
                type: 'config',
                data: {
                    target_language_code: 'hi-IN',
                    speaker: 'priya',
                    speech_sample_rate: 24000,
                    enable_preprocessing: true,
                    output_audio_codec: 'linear16',
                    model: 'bulbul:v3',
                },
            },
            { type: 'text', data: { text: 'Namaste.' } },
            { type: 'flush' },
        ]);
    });

    it('speaks a language Sarvam lacks in Indian English, leaves the voice to Sarvam when none is picked, and fails with its error', async () => {
        const s = await fakeSarvam((ws, message) => {
            if (message.type === 'flush')
                ws.send(
                    JSON.stringify({
                        type: 'error',
                        data: { message: 'Rate limit exceeded', code: 429 },
                    }),
                );
        });
        const error = await collect(new SarvamSpeech().speak(speaking(s.base, { lang: 'ar' }, { voiceId: '' }))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(429);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
        const config = s.seen.messages[0].data as Record<string, unknown>;
        expect(config.target_language_code).toBe('en-IN');
        expect(config).not.toHaveProperty('speaker');
    });
});

describe('Sarvam AI in the worker', () => {
    it('is registered as "sarvam" for hearing and speaking unless a registry already brings one', () => {
        const base = {
            port: 0,
            host: '127.0.0.1',
            maxLanes: 1,
            maxSessionsPerConnection: 1,
            ice: { iceServers: [] },
        };
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(SARVAM_ADAPTER)).toBeInstanceOf(SarvamRecognition);
        expect(worker.connectors.speech(SARVAM_ADAPTER)).toBeInstanceOf(SarvamSpeech);
        const own = { speak: async function* () {} };
        expect(
            new VoiceWorker({
                ...base,
                connectors: new ConnectorRegistry().registerSpeech('sarvam', own),
            }).connectors.speech('sarvam'),
        ).toBe(own);
    });
});
