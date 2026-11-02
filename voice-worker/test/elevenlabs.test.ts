// Speaking with ElevenLabs (#1748), against a stand-in ElevenLabs server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { ELEVENLABS_ADAPTER, ElevenLabsSpeech } from '../src/elevenlabs.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'sk-eleven-test-key-456';

interface Seen {
    method?: string;
    url?: string;
    key?: string | string[];
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
async function fakeElevenLabs(reply: (res: http.ServerResponse) => void): Promise<{ base: string; seen: Seen[] }> {
    const seen: Seen[] = [];
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ method: req.method, url: req.url, key: req.headers['xi-api-key'], body: raw ? JSON.parse(raw) : undefined });
            reply(res);
        });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function request(base: string, extra: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest {
    return {
        text: 'Hello there',
        settings: { adapter: 'elevenlabs', model: 'eleven_flash_v2_5', voiceId: 'voice/1', key: new Secret(KEY), endpoint: base, ...settings },
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

describe('speaking with ElevenLabs', () => {
    it('streams one request per reply with the key in xi-api-key, asking for 24 kHz PCM with the chosen voice and model', async () => {
        const el = await fakeElevenLabs((res) => res.end(pcm(1, 2, 3)));
        const samples = await collect(new ElevenLabsSpeech().speak(request(el.base)));
        expect(samples).toEqual([1, 2, 3]);
        expect(el.seen).toHaveLength(1);
        expect(el.seen[0]).toMatchObject({ method: 'POST', url: '/v1/text-to-speech/voice%2F1/stream?output_format=pcm_24000', key: KEY });
        expect(el.seen[0].body).toEqual({ text: 'Hello there', model_id: 'eleven_flash_v2_5' });
    });

    it('puts a sample split across two pieces of the stream back together', async () => {
        const bytes = pcm(1000, -2000, 3000);
        const el = await fakeElevenLabs((res) => {
            res.write(bytes.subarray(0, 3));
            setTimeout(() => {
                res.write(bytes.subarray(3, 5));
                setTimeout(() => res.end(bytes.subarray(5)), 20);
            }, 20);
        });
        expect(await collect(new ElevenLabsSpeech().speak(request(el.base)))).toEqual([1000, -2000, 3000]);
    });

    it("sends the reply's language as language_code, but not to a model that refuses one", async () => {
        const el = await fakeElevenLabs((res) => res.end(pcm(1)));
        await collect(new ElevenLabsSpeech().speak(request(el.base, { lang: 'ar-KW' })));
        await collect(new ElevenLabsSpeech().speak(request(el.base, {}, { language: 'fr' })));
        await collect(new ElevenLabsSpeech().speak(request(el.base, { lang: 'ar' }, { model: 'eleven_multilingual_v2' })));
        expect(el.seen.map((s) => s.body?.language_code)).toEqual(['ar', 'fr', undefined]);
    });

    it('makes the voice steadier or livelier for the chosen expression, and leaves the saved settings for natural', async () => {
        const el = await fakeElevenLabs((res) => res.end(pcm(1)));
        for (const expression of ['restrained', 'natural', 'expressive'] as const) {
            await collect(new ElevenLabsSpeech().speak(request(el.base, { expression })));
        }
        expect(el.seen.map((s) => s.body?.voice_settings)).toEqual([{ stability: 0.75 }, undefined, { stability: 0.3 }]);
    });

    it.each([401, 422, 429])('fails with status %i when ElevenLabs refuses, and the key is in no failure', async (status) => {
        const el = await fakeElevenLabs((res) => {
            res.statusCode = status;
            res.end(JSON.stringify({ detail: { message: 'no' } }));
        });
        const error = await collect(new ElevenLabsSpeech().speak(request(el.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(status);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('fails without a status when ElevenLabs cannot be reached', async () => {
        const error = await collect(new ElevenLabsSpeech().speak(request('http://127.0.0.1:1'))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
    });

    it('fails without a status when the stream drops part-way, after the audio it gave', async () => {
        const el = await fakeElevenLabs((res) => {
            res.write(pcm(5, 6));
            setTimeout(() => res.socket?.destroy(), 20);
        });
        const got: number[] = [];
        const error = await (async () => {
            for await (const chunk of new ElevenLabsSpeech().speak(request(el.base))) got.push(...chunk);
        })().catch((e: unknown) => e);
        expect(got).toEqual([5, 6]);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
    });

    it('stops quietly when the reply is no longer wanted', async () => {
        const el = await fakeElevenLabs((res) => {
            res.write(pcm(7));
            // Never ends on its own
        });
        const abort = new AbortController();
        const got: number[] = [];
        for await (const chunk of new ElevenLabsSpeech().speak(request(el.base, { signal: abort.signal }))) {
            got.push(...chunk);
            abort.abort();
        }
        expect(got).toEqual([7]);
    });
});

describe('the worker speaks with ElevenLabs by name', () => {
    it('has it registered as "elevenlabs" unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(ELEVENLABS_ADAPTER)).toBeInstanceOf(ElevenLabsSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('elevenlabs', own) }).connectors.speech('elevenlabs')).toBe(own);
    });
});
