// Listening with ElevenLabs (#1873), against a stand-in Scribe socket on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import { ELEVENLABS_ADAPTER } from '../src/elevenlabs.ts';
import { ElevenLabsRecognition } from '../src/elevenlabsHearing.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'xi-hear-key-654';

interface Chunk {
    message_type: string;
    audio_base_64: string;
    commit: boolean;
    sample_rate: number;
}

interface Fake {
    url: string;
    seen: { url?: string; key?: string | string[] }[];
    chunks: Chunk[];
    send: (m: object) => void;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

async function fakeScribe(options: { refuse?: number; onCommit?: (send: (m: object) => void) => void } = {}): Promise<Fake> {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    let current: WebSocket | undefined;
    const fake: Fake = { url: '', seen: [], chunks: [], send: (m) => current?.send(JSON.stringify(m)) };
    server.on('upgrade', (req, socket, head) => {
        fake.seen.push({ url: req.url, key: req.headers['xi-api-key'] });
        if (options.refuse) {
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data) => {
                const chunk = JSON.parse(data.toString()) as Chunk;
                fake.chunks.push(chunk);
                if (chunk.commit) options.onCommit?.(fake.send);
            });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    fake.url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closers.push(
        () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                server.closeAllConnections();
                server.close(() => resolve());
            })
    );
    return fake;
}

function heard() {
    const got = { partials: [] as string[], finals: [] as string[], failures: [] as { text: string; status?: number }[] };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        failed: (text, failure) => got.failures.push({ text, ...(failure?.status === undefined ? {} : { status: failure.status }) }),
    };
    return { got, events };
}

const settings = (endpoint: string, extra: object = {}) => ({ adapter: 'elevenlabs', model: 'scribe_v2_realtime', key: new Secret(KEY), endpoint, language: 'ar-KW', ...extra });

describe('listening with ElevenLabs', () => {
    it('opens one socket with the key in its header, the model, 16 kHz audio, manual commits and the base language', async () => {
        const fake = await fakeScribe();
        const stream = new ElevenLabsRecognition().listen(settings(fake.url), heard().events);
        stream.push(new Int16Array([1, -1]));
        await waitFor('the audio', () => fake.chunks.length === 1);
        const url = new URL(fake.seen[0].url!, 'ws://x');
        expect(url.pathname).toBe('/v1/speech-to-text/realtime');
        expect(Object.fromEntries(url.searchParams)).toEqual({ model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', commit_strategy: 'manual', language_code: 'ar' });
        expect(fake.seen[0].key).toBe(KEY);
        expect(fake.chunks[0]).toEqual({ message_type: 'input_audio_chunk', audio_base_64: Buffer.from(new Int16Array([1, -1]).buffer).toString('base64'), commit: false, sample_rate: 16000 });
        stream.close();
    });

    it('leaves the language to ElevenLabs when the bot names none', async () => {
        const fake = await fakeScribe();
        const stream = new ElevenLabsRecognition().listen(settings(fake.url, { language: undefined }), heard().events);
        await waitFor('the socket', () => fake.seen.length === 1);
        expect(new URL(fake.seen[0].url!, 'ws://x').searchParams.has('language_code')).toBe(false);
        stream.close();
    });

    it('shows partial words, commits at the pause, and ends with the committed words', async () => {
        const fake = await fakeScribe({ onCommit: (send) => send({ message_type: 'committed_transcript', text: 'Marhaba, kaif halak?' }) });
        const { got, events } = heard();
        const stream = new ElevenLabsRecognition().listen(settings(fake.url), events);
        stream.push(new Int16Array(160));
        await waitFor('the audio', () => fake.chunks.length === 1);
        fake.send({ message_type: 'session_started' });
        fake.send({ message_type: 'partial_transcript', text: 'Marhaba' });
        fake.send({ message_type: 'partial_transcript', text: 'Marhaba, kaif' });
        await waitFor('the words', () => got.partials.length === 2);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(fake.chunks.at(-1)).toEqual({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16000 });
        expect(got.partials).toEqual(['Marhaba', 'Marhaba, kaif']);
        expect(got.finals).toEqual(['Marhaba, kaif halak?']);
        expect(got.failures).toEqual([]);
    });

    it.each([
        ['auth_error', 401],
        ['quota_exceeded', 402],
        ['rate_limited', 429],
        ['input_error', 400],
        ['transcriber_error', undefined],
    ])('fails on %s with status %s, with the words so far', async (type, status) => {
        const fake = await fakeScribe();
        const { got, events } = heard();
        new ElevenLabsRecognition().listen(settings(fake.url), events).push(new Int16Array(10));
        await waitFor('the audio', () => fake.chunks.length === 1);
        fake.send({ message_type: 'partial_transcript', text: 'half' });
        await waitFor('the words', () => got.partials.length === 1);
        fake.send({ message_type: type, error: 'no' });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: 'half', ...(status === undefined ? {} : { status }) }]);
    });

    it('fails with the status of a refused connection', async () => {
        const fake = await fakeScribe({ refuse: 401 });
        const { got, events } = heard();
        new ElevenLabsRecognition().listen(settings(fake.url), events);
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });

    it('is registered as "elevenlabs" for listening unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.recognition(ELEVENLABS_ADAPTER)).toBeInstanceOf(ElevenLabsRecognition);
        const own = { listen: () => ({ push: () => undefined, finish: () => undefined, close: () => undefined }) };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerRecognition('elevenlabs', own) }).connectors.recognition('elevenlabs')).toBe(own);
    });
});
