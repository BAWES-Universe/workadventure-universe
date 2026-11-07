// Speaking with Hume (#1885), against a stand-in Hume server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { HUME_ADAPTER, HumeSpeech, octaveVersion } from '../src/hume.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'hume-key-531';

let server: http.Server | undefined;
afterEach(
    () =>
        new Promise<void>((resolve) => {
            if (!server) return resolve();
            server.closeAllConnections();
            server.close(() => resolve());
            server = undefined;
        })
);

async function fakeHume(reply: (res: http.ServerResponse) => void) {
    const seen: { url?: string; key?: string | string[]; body?: Record<string, unknown> }[] = [];
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ url: req.url, key: req.headers['x-hume-api-key'], body: raw ? JSON.parse(raw) : undefined });
            reply(res);
        });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const request = (base: string, settings: object = {}): SpeechRequest => ({
    text: 'Hello there.',
    settings: { adapter: 'hume', model: 'octave-2', voiceId: 'voice-uuid', key: new Secret(KEY), endpoint: base, ...settings },
    signal: new AbortController().signal,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

const chunk = (count: number, last: boolean) => `${JSON.stringify({ type: 'audio', audio: Buffer.from(new Int16Array(count).fill(800).buffer).toString('base64'), chunk_index: 0, is_last_chunk: last, generation_id: 'g', request_id: 'r', snippet_id: 's', text: 'Hello there.', audio_format: 'pcm' })}\n`;

describe('speaking with Hume', () => {
    it("sends the text with the voice in instant mode and Octave's version, the key in X-Hume-Api-Key, and plays 48 kHz PCM at 24 kHz", async () => {
        const h = await fakeHume((res) => {
            res.write(chunk(480, false));
            res.write(`${JSON.stringify({ type: 'timestamp', timestamp: {} })}\n`);
            res.end(chunk(480, true));
        });
        const samples = await collect(new HumeSpeech().speak(request(h.base)));
        expect(samples.length).toBeGreaterThan(440);
        expect(samples.length).toBeLessThanOrEqual(480);
        expect(h.seen[0]).toEqual({
            url: '/v0/tts/stream/json',
            key: KEY,
            body: { utterances: [{ text: 'Hello there.', voice: { id: 'voice-uuid' } }], format: { type: 'pcm' }, instant_mode: true, strip_headers: true, version: '2' },
        });
    });

    it('lets Hume choose a voice when none is picked, with instant mode off', async () => {
        const h = await fakeHume((res) => res.end(chunk(10, true)));
        await collect(new HumeSpeech().speak(request(h.base, { voiceId: '' })));
        expect(h.seen[0].body).toMatchObject({ utterances: [{ text: 'Hello there.' }], instant_mode: false });
    });

    it("reads Octave's version from the model", () => {
        expect(octaveVersion('octave-2')).toBe('2');
        expect(octaveVersion('Octave-1')).toBe('1');
        expect(octaveVersion('2')).toBe('2');
        expect(octaveVersion('something-else')).toBeUndefined();
    });

    it.each([401, 402, 422, 429])('fails with status %i when Hume refuses, and the key is in no failure', async (status) => {
        const h = await fakeHume((res) => {
            res.statusCode = status;
            res.end('{"message":"no"}');
        });
        const error = await collect(new HumeSpeech().speak(request(h.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(status);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('is registered as "hume" for speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(HUME_ADAPTER)).toBeInstanceOf(HumeSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('hume', own) }).connectors.speech('hume')).toBe(own);
    });
});
