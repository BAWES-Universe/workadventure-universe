// Speaking with Resemble AI (#1901), against a stand-in Resemble server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { RESEMBLE_ADAPTER, RESEMBLE_MAX_TEXT, ResembleSpeech } from '../src/resemble.ts';
import { VoiceWorker } from '../src/server.ts';
import { wavFile } from '../src/kit/pcm.ts';

const KEY = 'resemble-key-552';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

async function fakeResemble(answer: (res: http.ServerResponse) => void) {
    const seen: {
        url?: string;
        auth?: string;
        body?: Record<string, unknown>;
    }[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({
                url: req.url,
                auth: req.headers.authorization,
                body: raw ? JSON.parse(raw) : undefined,
            });
            answer(res);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))));
    return {
        base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        seen,
    };
}

/** Resemble's WAV: a cue chunk of timestamps between the format and the samples. */
function resembleWav(samples: Int16Array): Buffer {
    const plain = Buffer.from(wavFile(samples, 48_000));
    const cue = Buffer.alloc(8 + 28);
    cue.write('cue ', 0, 'ascii');
    cue.writeUInt32LE(28, 4);
    return Buffer.concat([plain.subarray(0, 36), cue, plain.subarray(36)]);
}

const speaking = (base: string, changes: Partial<SpeechRequest> = {}): SpeechRequest => ({
    text: 'Hello there.',
    settings: {
        adapter: 'resemble',
        model: 'resemble',
        voiceId: 'voice-uuid-1',
        key: new Secret(KEY),
        endpoint: base,
    },
    signal: new AbortController().signal,
    ...changes,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

describe('speaking with Resemble AI', () => {
    it('streams the text with the voice and the key as a bearer, and plays the samples after the whole header', async () => {
        // Steady 48 kHz samples come out as steady 24 kHz ones; the timestamps chunk is never played
        const r = await fakeResemble((res) => {
            const wav = resembleWav(new Int16Array(480).fill(1000));
            res.write(wav.subarray(0, 50));
            res.end(wav.subarray(50));
        });
        const samples = await collect(new ResembleSpeech().speak(speaking(r.base)));
        expect(samples.length).toBeGreaterThan(200);
        expect(samples.slice(20, -20).every((value) => Math.abs(value - 1000) <= 2)).toBe(true);
        expect(r.seen[0]).toEqual({
            url: '/stream',
            auth: `Bearer ${KEY}`,
            body: {
                voice_uuid: 'voice-uuid-1',
                data: 'Hello there.',
                precision: 'PCM_16',
                sample_rate: 48000,
            },
        });
    });

    it('sends no more than Resemble takes, and fails with its status, the key in no failure', async () => {
        const long = await fakeResemble((res) => res.end(resembleWav(new Int16Array(2))));
        await collect(new ResembleSpeech().speak(speaking(long.base, { text: 'a'.repeat(RESEMBLE_MAX_TEXT + 50) })));
        expect((long.seen[0].body?.data as string).length).toBe(RESEMBLE_MAX_TEXT);

        const refused = await fakeResemble((res) => {
            res.statusCode = 401;
            res.end('{"success":false,"message":"Unauthorized"}');
        });
        const error = await collect(new ResembleSpeech().speak(speaking(refused.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(401);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('is registered as "resemble" for speaking unless a registry already brings one', () => {
        const base = {
            port: 0,
            host: '127.0.0.1',
            maxLanes: 1,
            maxSessionsPerConnection: 1,
            ice: { iceServers: [] },
        };
        expect(new VoiceWorker(base).connectors.speech(RESEMBLE_ADAPTER)).toBeInstanceOf(ResembleSpeech);
        const own = { speak: async function* () {} };
        expect(
            new VoiceWorker({
                ...base,
                connectors: new ConnectorRegistry().registerSpeech('resemble', own),
            }).connectors.speech('resemble'),
        ).toBe(own);
    });
});
