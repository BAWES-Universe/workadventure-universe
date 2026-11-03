// Speaking with Cartesia (#1748), against a stand-in Cartesia server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CARTESIA_ADAPTER, CartesiaSpeech, DEFAULT_CARTESIA_VERSION } from '../src/cartesia.ts';
import { optionsFromEnv } from '../src/config.ts';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'sk_car_test-key-789';

interface Seen {
    method?: string;
    url?: string;
    authorization?: string;
    version?: string | string[];
    body?: Record<string, unknown>;
}

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

/** A stand-in that answers each request with `reply`, after noting what it was asked. */
async function fakeCartesia(reply: (res: http.ServerResponse) => void): Promise<{ base: string; seen: Seen[] }> {
    const seen: Seen[] = [];
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({
                method: req.method,
                url: req.url,
                authorization: req.headers.authorization,
                version: req.headers['cartesia-version'],
                body: raw ? JSON.parse(raw) : undefined,
            });
            reply(res);
        });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function request(base: string, extra: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest {
    return {
        text: 'Hello there',
        settings: { adapter: 'cartesia', model: 'sonic-3', voiceId: 'voice-1', key: new Secret(KEY), endpoint: base, ...settings },
        signal: new AbortController().signal,
        ...extra,
    };
}

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

/** Little-endian s16 bytes of these samples. */
const pcm = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer);

describe('speaking with Cartesia', () => {
    it('streams one request per reply with the key as a bearer token, asking for raw 24 kHz s16 PCM with the chosen voice and model', async () => {
        const c = await fakeCartesia((res) => res.end(pcm(1, 2, 3)));
        const samples = await collect(new CartesiaSpeech().speak(request(c.base)));
        expect(samples).toEqual([1, 2, 3]);
        expect(c.seen).toHaveLength(1);
        expect(c.seen[0]).toMatchObject({ method: 'POST', url: '/tts/bytes', authorization: `Bearer ${KEY}`, version: DEFAULT_CARTESIA_VERSION });
        expect(c.seen[0].body).toEqual({
            model_id: 'sonic-3',
            transcript: 'Hello there',
            voice: { id: 'voice-1' },
            output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
        });
    });

    it('names the API version it is given', async () => {
        const c = await fakeCartesia((res) => res.end(pcm(1)));
        await collect(new CartesiaSpeech({ version: '2099-01-01' }).speak(request(`${c.base}/`)));
        expect(c.seen[0]).toMatchObject({ url: '/tts/bytes', version: '2099-01-01' });
    });

    it('puts a sample split across two pieces of the stream back together', async () => {
        const bytes = pcm(1000, -2000, 3000);
        const c = await fakeCartesia((res) => {
            res.write(bytes.subarray(0, 3));
            setTimeout(() => {
                res.write(bytes.subarray(3, 5));
                setTimeout(() => res.end(bytes.subarray(5)), 20);
            }, 20);
        });
        expect(await collect(new CartesiaSpeech().speak(request(c.base)))).toEqual([1000, -2000, 3000]);
    });

    it("sends the reply's language, or the profile's, as its base code", async () => {
        const c = await fakeCartesia((res) => res.end(pcm(1)));
        await collect(new CartesiaSpeech().speak(request(c.base, { lang: 'ar-KW' })));
        await collect(new CartesiaSpeech().speak(request(c.base, {}, { language: 'FR' })));
        await collect(new CartesiaSpeech().speak(request(c.base)));
        expect(c.seen.map((s) => s.body?.language)).toEqual(['ar', 'fr', undefined]);
    });

    it('holds the voice calm for restrained, lets Cartesia read the words otherwise, and sends nothing to models before Sonic 3', async () => {
        const c = await fakeCartesia((res) => res.end(pcm(1)));
        for (const expression of ['restrained', 'natural', 'expressive'] as const) {
            await collect(new CartesiaSpeech().speak(request(c.base, { expression })));
        }
        await collect(new CartesiaSpeech().speak(request(c.base, { expression: 'restrained' }, { model: 'sonic-3.6' })));
        await collect(new CartesiaSpeech().speak(request(c.base, { expression: 'restrained' }, { model: 'sonic-latest' })));
        await collect(new CartesiaSpeech().speak(request(c.base, { expression: 'restrained' }, { model: 'sonic-2' })));
        expect(c.seen.map((s) => s.body?.generation_config)).toEqual([
            { emotion: 'calm' },
            undefined,
            undefined,
            { emotion: 'calm' },
            { emotion: 'calm' },
            undefined,
        ]);
    });

    it.each([400, 401, 402, 429])('fails with status %i when Cartesia refuses, and the key is in no failure', async (status) => {
        const c = await fakeCartesia((res) => {
            res.statusCode = status;
            res.end(JSON.stringify({ error: 'no' }));
        });
        const error = await collect(new CartesiaSpeech().speak(request(c.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(status);
        expect(`${(error as Error).message} ${(error as Error).stack} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('fails without a status when Cartesia cannot be reached', async () => {
        const error = await collect(new CartesiaSpeech().speak(request('http://127.0.0.1:1'))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('fails without a status when the stream drops part-way, after the audio it gave', async () => {
        const c = await fakeCartesia((res) => {
            res.write(pcm(5, 6));
            setTimeout(() => res.socket?.destroy(), 20);
        });
        const got: number[] = [];
        const error = await (async () => {
            for await (const chunk of new CartesiaSpeech().speak(request(c.base))) got.push(...chunk);
        })().catch((e: unknown) => e);
        expect(got).toEqual([5, 6]);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
    });

    it('stops quietly when the reply is no longer wanted', async () => {
        const c = await fakeCartesia((res) => {
            res.write(pcm(7));
            // Never ends on its own
        });
        const abort = new AbortController();
        const got: number[] = [];
        for await (const chunk of new CartesiaSpeech().speak(request(c.base, { signal: abort.signal }))) {
            got.push(...chunk);
            abort.abort();
        }
        expect(got).toEqual([7]);
    });
});

describe('the worker speaks with Cartesia by name', () => {
    const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };

    it('has it registered as "cartesia" unless a registry already brings one', () => {
        expect(new VoiceWorker(base).connectors.speech(CARTESIA_ADAPTER)).toBeInstanceOf(CartesiaSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('cartesia', own) }).connectors.speech('cartesia')).toBe(own);
    });

    it('takes the API version from VOICE_CARTESIA_VERSION, with a pinned default', async () => {
        expect(optionsFromEnv({}).cartesiaVersion).toBe(DEFAULT_CARTESIA_VERSION);
        expect(optionsFromEnv({ VOICE_CARTESIA_VERSION: ' 2099-01-01 ' }).cartesiaVersion).toBe('2099-01-01');
        const c = await fakeCartesia((res) => res.end(pcm(1)));
        const worker = new VoiceWorker({ ...base, cartesiaVersion: '2099-02-02' });
        await collect(worker.connectors.speech('cartesia')!.speak(request(c.base)));
        expect(c.seen[0].version).toBe('2099-02-02');
    });
});
