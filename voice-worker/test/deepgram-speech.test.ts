// Speaking with Deepgram (#1879), against a stand-in Deepgram server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { DEEPGRAM_ADAPTER } from '../src/deepgram.ts';
import { DeepgramSpeech } from '../src/deepgramSpeech.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'dg-speak-key-555';

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

async function fakeDeepgram(reply: (res: http.ServerResponse) => void) {
    const seen: { method?: string; url?: string; authorization?: string; body?: unknown }[] = [];
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
            reply(res);
        });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const request = (base: string, settings: object = {}): SpeechRequest => ({
    text: 'Hello there',
    settings: { adapter: 'deepgram', model: 'aura-2', voiceId: 'aura-2-thalia-en', key: new Secret(KEY), endpoint: base, ...settings },
    signal: new AbortController().signal,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

const pcm = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer);

describe('speaking with Deepgram', () => {
    it('streams one request per reply with the key as a token, the voice as the model, and asks for raw 24 kHz PCM', async () => {
        const c = await fakeDeepgram((res) => res.end(pcm(1, 2, 3)));
        expect(await collect(new DeepgramSpeech().speak(request(c.base)))).toEqual([1, 2, 3]);
        const url = new URL(c.seen[0].url!, 'http://x');
        expect(c.seen[0]).toMatchObject({ method: 'POST', authorization: `Token ${KEY}`, body: { text: 'Hello there' } });
        expect(url.pathname).toBe('/v1/speak');
        expect(Object.fromEntries(url.searchParams)).toEqual({ model: 'aura-2-thalia-en', encoding: 'linear16', sample_rate: '24000', container: 'none' });
    });

    it('uses the model when no voice is set', async () => {
        const c = await fakeDeepgram((res) => res.end(pcm(1)));
        await collect(new DeepgramSpeech().speak(request(c.base, { voiceId: '' })));
        expect(new URL(c.seen[0].url!, 'http://x').searchParams.get('model')).toBe('aura-2');
    });

    it.each([400, 401, 402, 429])('fails with status %i when Deepgram refuses, and the key is in no failure', async (status) => {
        const c = await fakeDeepgram((res) => {
            res.statusCode = status;
            res.end('{"err_code":"no"}');
        });
        const error = await collect(new DeepgramSpeech().speak(request(c.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(status);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('is registered as "deepgram" for speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(DEEPGRAM_ADAPTER)).toBeInstanceOf(DeepgramSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('deepgram', own) }).connectors.speech('deepgram')).toBe(own);
    });
});
