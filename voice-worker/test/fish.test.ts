// Speaking with Fish Audio (#1868), against a stand-in Fish server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FISH_ADAPTER, FishSpeech } from '../src/fish.ts';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'fish-test-key-456';

interface Seen {
    method?: string;
    url?: string;
    authorization?: string;
    model?: string | string[];
    contentType?: string;
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
async function fakeFish(reply: (res: http.ServerResponse) => void): Promise<{ base: string; seen: Seen[] }> {
    const seen: Seen[] = [];
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({
                method: req.method,
                url: req.url,
                authorization: req.headers.authorization,
                model: req.headers.model,
                contentType: req.headers['content-type'],
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
        settings: { adapter: 'fish', model: 's2.1-pro-free', voiceId: 'voice-1', key: new Secret(KEY), endpoint: base, ...settings },
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

/** The start of a WAV file: 44 bytes that are not audio. */
const wavHeader = () => {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.write('WAVE', 8);
    return header;
};

describe('speaking with Fish Audio', () => {
    it('streams one request per reply with the key as a bearer token, the model in its header, and asks for raw 24 kHz PCM with the chosen voice', async () => {
        const c = await fakeFish((res) => res.end(pcm(1, 2, 3)));
        const samples = await collect(new FishSpeech().speak(request(c.base)));
        expect(samples).toEqual([1, 2, 3]);
        expect(c.seen).toHaveLength(1);
        expect(c.seen[0]).toMatchObject({ method: 'POST', url: '/v1/tts', authorization: `Bearer ${KEY}`, model: 's2.1-pro-free', contentType: 'application/json' });
        expect(c.seen[0].body).toEqual({ text: 'Hello there', reference_id: 'voice-1', format: 'pcm', sample_rate: 24000, latency: 'balanced' });
    });

    it("names the profile's model, for the paid model too, and goes to the endpoint it is given", async () => {
        const c = await fakeFish((res) => res.end(pcm(1)));
        await collect(new FishSpeech().speak(request(`${c.base}/`, {}, { model: 's2.1-pro' })));
        expect(c.seen[0]).toMatchObject({ url: '/v1/tts', model: 's2.1-pro' });
    });

    it('puts a sample split across two pieces of the stream back together', async () => {
        const bytes = pcm(1000, -2000, 3000);
        const c = await fakeFish((res) => {
            res.write(bytes.subarray(0, 3));
            setTimeout(() => {
                res.write(bytes.subarray(3, 5));
                setTimeout(() => res.end(bytes.subarray(5)), 20);
            }, 20);
        });
        expect(await collect(new FishSpeech().speak(request(c.base)))).toEqual([1000, -2000, 3000]);
    });

    it('skips a WAV header at the start of the stream, even when it arrives in pieces, and plays what follows', async () => {
        const header = wavHeader();
        const whole = await fakeFish((res) => res.end(Buffer.concat([header, pcm(4, 5, 6)])));
        expect(await collect(new FishSpeech().speak(request(whole.base)))).toEqual([4, 5, 6]);
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        const split = await fakeFish((res) => {
            res.write(header.subarray(0, 2));
            setTimeout(() => {
                res.write(Buffer.concat([header.subarray(2, 40)]));
                setTimeout(() => res.end(Buffer.concat([header.subarray(40), pcm(7, 8)])), 20);
            }, 20);
        });
        expect(await collect(new FishSpeech().speak(request(split.base)))).toEqual([7, 8]);
    });

    it('plays a stream that starts with fewer than four bytes once the rest arrives', async () => {
        const bytes = pcm(9, 10);
        const c = await fakeFish((res) => {
            res.write(bytes.subarray(0, 2));
            setTimeout(() => res.end(bytes.subarray(2)), 20);
        });
        expect(await collect(new FishSpeech().speak(request(c.base)))).toEqual([9, 10]);
    });

    it("sends the reply's language, or the profile's, as its base code", async () => {
        const c = await fakeFish((res) => res.end(pcm(1)));
        await collect(new FishSpeech().speak(request(c.base, { lang: 'ar-KW' })));
        await collect(new FishSpeech().speak(request(c.base, {}, { language: 'FR' })));
        await collect(new FishSpeech().speak(request(c.base)));
        expect(c.seen.map((s) => s.body?.language)).toEqual(['ar', 'fr', undefined]);
    });

    it.each([401, 402, 429, 503])('fails with status %i when Fish refuses, and the key is in no failure', async (status) => {
        const c = await fakeFish((res) => {
            res.statusCode = status;
            res.end(JSON.stringify({ error: 'no' }));
        });
        const error = await collect(new FishSpeech().speak(request(c.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(status);
        expect(`${(error as Error).message} ${(error as Error).stack} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('fails without a status when Fish cannot be reached', async () => {
        const error = await collect(new FishSpeech().speak(request('http://127.0.0.1:1'))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('fails without a status when the stream drops part-way, after the audio it gave', async () => {
        const c = await fakeFish((res) => {
            res.write(pcm(5, 6));
            setTimeout(() => res.socket?.destroy(), 20);
        });
        const got: number[] = [];
        const error = await (async () => {
            for await (const chunk of new FishSpeech().speak(request(c.base))) got.push(...chunk);
        })().catch((e: unknown) => e);
        expect(got).toEqual([5, 6]);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
    });

    it('stops quietly when the reply is no longer wanted', async () => {
        const c = await fakeFish((res) => {
            res.write(pcm(7, 8));
            // Never ends on its own
        });
        const abort = new AbortController();
        const got: number[] = [];
        for await (const chunk of new FishSpeech().speak(request(c.base, { signal: abort.signal }))) {
            got.push(...chunk);
            abort.abort();
        }
        expect(got).toEqual([7, 8]);
    });
});

describe('the worker speaks with Fish Audio by name', () => {
    const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };

    it('has it registered as "fish" unless a registry already brings one', () => {
        expect(new VoiceWorker(base).connectors.speech(FISH_ADAPTER)).toBeInstanceOf(FishSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('fish', own) }).connectors.speech('fish')).toBe(own);
    });
});
