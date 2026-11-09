// Hearing and speaking with Speechmatics (#1876), against stand-in Speechmatics servers on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { SPEECHMATICS_ADAPTER, SpeechmaticsRecognition, SpeechmaticsSpeech, speechmaticsLanguage } from '../src/speechmatics.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'speechmatics-key-876';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in for Speechmatics' agent socket, answered by `onMessage`. It accepts the setup unless told not to. */
async function fakeSpeechmatics(onMessage: (ws: WebSocket, message: Record<string, unknown>) => void = () => undefined, accept = true) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { sockets: [] as { url: string; auth?: string }[], messages: [] as Record<string, unknown>[], audio: 0, bytesBeforeStart: 0 };
    let current: WebSocket | undefined;
    let started = false;
    server.on('upgrade', (req, socket, head) => {
        seen.sockets.push({ url: req.url ?? '', auth: req.headers.authorization });
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    if (!started) seen.bytesBeforeStart += (data as Buffer).length;
                    seen.audio++;
                    return;
                }
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                seen.messages.push(message);
                if (message.message === 'StartRecognition' && accept) {
                    started = true;
                    ws.send(JSON.stringify({ message: 'RecognitionStarted', id: 'session-1' }));
                }
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
    return { base: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, send: (m: object) => current?.send(JSON.stringify(m)) };
}

function heard() {
    const got = { partials: [] as string[], finals: [] as string[], failures: [] as { text: string; status?: number }[] };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        endpoint: () => undefined,
        failed: (text, failure) => got.failures.push({ text, ...(failure?.status === undefined ? {} : { status: failure.status }) }),
    };
    return { got, events };
}

const hearing = (endpoint: string, changes: object = {}) => ({
    adapter: 'speechmatics',
    model: 'linden-1',
    key: new Secret(KEY),
    endpoint,
    language: 'ar-KW',
    ...changes,
});

describe('hearing with Speechmatics', () => {
    it('sets up the session, holds audio until Speechmatics starts, and ends with the last segment after EndOfStream', async () => {
        const s = await fakeSpeechmatics((ws, message) => {
            if (message.message === 'EndOfStream') {
                ws.send(JSON.stringify({ message: 'AddSegment', segment: { transcript: 'kaif halak?' } }));
                ws.send(JSON.stringify({ message: 'EndOfTranscript' }));
            }
        });
        const { got, events } = heard();
        const stream = new SpeechmaticsRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array(160));
        stream.push(new Int16Array(160));
        await waitFor('the audio', () => s.seen.audio === 2);
        expect(s.seen.bytesBeforeStart).toBe(0);
        s.send({ message: 'AddPartialSegment', segment: { transcript: 'Marha' } });
        s.send({ message: 'AddSegment', segment: { transcript: 'Marhaba,' } });
        await waitFor('the words so far', () => got.partials.length === 2);
        stream.push(new Int16Array(160));
        await waitFor('more audio', () => s.seen.audio === 3);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Marha', 'Marhaba,', 'Marhaba, kaif halak?']);
        expect(got.finals).toEqual(['Marhaba, kaif halak?']);
        expect(s.seen.sockets).toEqual([{ url: '/v2/agent?sm-app=universe', auth: `Bearer ${KEY}` }]);
        expect(s.seen.messages).toEqual([
            {
                message: 'StartRecognition',
                audio_format: { type: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 },
                transcription_config: { language: 'ar', model: 'linden-1', enable_partials: true },
                turn_config: { turn_detection_mode: 'external' },
            },
            { message: 'ForceEndOfUtterance' },
            { message: 'EndOfStream', last_seq_no: 3 },
        ]);
    });

    it('counts audio for each stretch on its own', async () => {
        const s = await fakeSpeechmatics((ws, message) => {
            if (message.message === 'EndOfStream') ws.send(JSON.stringify({ message: 'EndOfTranscript' }));
        });
        const connector = new SpeechmaticsRecognition();
        for (const pieces of [2, 1]) {
            const { got, events } = heard();
            const stream = connector.listen(hearing(s.base), events);
            for (let i = 0; i < pieces; i++) stream.push(new Int16Array(160));
            stream.finish();
            await waitFor('the end', () => got.finals.length + got.failures.length === 1);
        }
        expect(s.seen.messages.filter((m) => m.message === 'EndOfStream')).toEqual([
            { message: 'EndOfStream', last_seq_no: 2 },
            { message: 'EndOfStream', last_seq_no: 1 },
        ]);
    });

    it('reads its language codes, and English for a language it does not hear', () => {
        expect(speechmaticsLanguage('zh-CN')).toBe('cmn');
        expect(speechmaticsLanguage('fil')).toBe('tl');
        expect(speechmaticsLanguage('fr-FR')).toBe('fr');
        expect(speechmaticsLanguage('xx')).toBe('en');
        expect(speechmaticsLanguage(undefined)).toBe('en');
    });

    it('fails with the status of the error Speechmatics sends', async () => {
        const s = await fakeSpeechmatics((ws, message) => {
            if (message.message === 'StartRecognition') ws.send(JSON.stringify({ message: 'Error', type: 'not_authorised', reason: 'Bad key' }));
        }, false);
        const { got, events } = heard();
        new SpeechmaticsRecognition().listen(hearing(s.base), events);
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });
});

/** A stand-in for Speechmatics' speaking address, answering with `answer`. */
async function fakeSpeaking(answer: (res: http.ServerResponse) => void) {
    const seen: { url?: string; auth?: string; body?: Record<string, unknown> }[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
            answer(res);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const speaking = (base: string, settings: object = {}): SpeechRequest => ({
    text: 'Hello there.',
    settings: { adapter: 'speechmatics', model: 'speechmatics', voiceId: 'theo', key: new Secret(KEY), endpoint: base, language: 'en-GB', ...settings },
    signal: new AbortController().signal,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

describe('speaking with Speechmatics', () => {
    it('asks for the voice with the key as a bearer and plays the 16 kHz audio at the worker rate', async () => {
        const s = await fakeSpeaking((res) => {
            res.setHeader('content-type', 'audio/pcm');
            res.end(Buffer.from(new Int16Array(160).fill(100).buffer));
        });
        const audio = await collect(new SpeechmaticsSpeech().speak(speaking(s.base)));
        // 10 ms of 16 kHz audio (160 samples), played at the worker's 24 kHz: about 240 samples
        expect(audio.length).toBeGreaterThan(200);
        expect(audio.length).toBeLessThanOrEqual(250);
        expect(s.seen[0]).toEqual({ url: '/generate/theo?output_format=pcm_16000&sm-app=universe', auth: `Bearer ${KEY}`, body: { text: 'Hello there.' } });

        await collect(new SpeechmaticsSpeech().speak(speaking(s.base, { voiceId: '' })));
        expect(s.seen[1].url).toBe('/generate/sarah?output_format=pcm_16000&sm-app=universe');
    });

    it("fails with Speechmatics' status, the key in no failure", async () => {
        const s = await fakeSpeaking((res) => {
            res.statusCode = 401;
            res.end('{"detail":"Unauthorized"}');
        });
        const failure = await collect(new SpeechmaticsSpeech().speak(speaking(s.base))).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(401);
        expect(`${(failure as Error).message} ${JSON.stringify(failure)}`).not.toContain(KEY);
    });

    it('is registered as "speechmatics" for hearing and speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(SPEECHMATICS_ADAPTER)).toBeInstanceOf(SpeechmaticsRecognition);
        expect(worker.connectors.speech(SPEECHMATICS_ADAPTER)).toBeInstanceOf(SpeechmaticsSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('speechmatics', own) }).connectors.speech('speechmatics')).toBe(
            own,
        );
    });
});
