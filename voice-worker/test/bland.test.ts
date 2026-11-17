// Speaking with Bland (#1885), against a stand-in Bland server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BLAND_ADAPTER, BLAND_DEFAULT_VOICE, BlandSpeech } from '../src/bland.ts';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'bland-speak-key-909';

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

async function fakeBland(reply: (res: http.ServerResponse) => void) {
    const seen: { method?: string; url?: string; authorization?: string; body?: Record<string, unknown> }[] = [];
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
    text: 'Ahlan, kaif halak?',
    settings: { adapter: 'bland', model: 'btts-3', voiceId: 'voice-uuid-1', key: new Secret(KEY), endpoint: base, ...settings },
    signal: new AbortController().signal,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

const pcm = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer);

describe('speaking with Bland', () => {
    it('streams one request per reply with the key as a bearer, the voice, and asks for raw 24 kHz PCM', async () => {
        const c = await fakeBland((res) => res.end(pcm(1, 2, 3)));
        expect(await collect(new BlandSpeech().speak(request(c.base)))).toEqual([1, 2, 3]);
        expect(c.seen[0]).toEqual({
            method: 'POST',
            url: '/v2/tts',
            authorization: `Bearer ${KEY}`,
            body: { text: 'Ahlan, kaif halak?', voice: 'voice-uuid-1', audio: { encoding: 'pcm_s16le', sample_rate: 24000, container: 'raw' } },
        });
    });

    it("uses Bland's own Karen when no voice is picked", async () => {
        const c = await fakeBland((res) => res.end(pcm(1)));
        await collect(new BlandSpeech().speak(request(c.base, { voiceId: '' })));
        expect(c.seen[0].body?.voice).toBe(BLAND_DEFAULT_VOICE);
    });

    it.each([401, 402, 404, 429])('fails with status %i when Bland refuses, and the key is in no failure', async (status) => {
        const c = await fakeBland((res) => {
            res.statusCode = status;
            res.end('{"error":{"code":"no","message":"no"}}');
        });
        const error = await collect(new BlandSpeech().speak(request(c.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(status);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('is registered as "bland" for speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(BLAND_ADAPTER)).toBeInstanceOf(BlandSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('bland', own) }).connectors.speech('bland')).toBe(own);
    });
});
