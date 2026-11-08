// Speaking with CAMB.AI (#1885), against a stand-in CAMB.AI server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CAMB_ADAPTER, CAMB_DEFAULT_VOICE, CambSpeech, cambLocale } from '../src/camb.ts';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'camb-speak-key-321';

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

async function fakeCamb(reply: (res: http.ServerResponse) => void) {
    const seen: { method?: string; url?: string; key?: string | string[]; body?: Record<string, unknown> }[] = [];
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body: raw ? JSON.parse(raw) : undefined });
            reply(res);
        });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/apis`, seen };
}

const request = (base: string, settings: object = {}, extra: Partial<SpeechRequest> = {}): SpeechRequest => ({
    text: 'Ahlan, kaif halak?',
    settings: { adapter: 'camb', model: 'mars-pro', voiceId: '12345', key: new Secret(KEY), endpoint: base, language: 'ar-KW', ...settings },
    signal: new AbortController().signal,
    ...extra,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

const pcm = (count: number) => Buffer.from(new Int16Array(count).fill(1000).buffer);

describe('speaking with CAMB.AI', () => {
    it('streams one request per reply with the key in x-api-key, the voice as a number, the locale and the model', async () => {
        const c = await fakeCamb((res) => res.end(pcm(480)));
        const samples = await collect(new CambSpeech().speak(request(c.base)));
        expect(c.seen[0]).toEqual({
            method: 'POST',
            url: '/apis/tts-stream',
            key: KEY,
            body: { text: 'Ahlan, kaif halak?', voice_id: 12345, language: 'ar-kw', speech_model: 'mars-pro', output_configuration: { format: 'pcm_s16le' } },
        });
        // MARS Pro speaks at 48 kHz: 10 ms of it is about 240 samples at the worker's 24 kHz
        expect(samples.length).toBeGreaterThan(200);
        expect(samples.length).toBeLessThanOrEqual(240);
    });

    it('reads Flash at 22.05 kHz, so its audio grows a little at 24 kHz', async () => {
        const c = await fakeCamb((res) => res.end(pcm(2205)));
        const samples = await collect(new CambSpeech().speak(request(c.base, { model: 'mars-flash' })));
        expect(samples.length).toBeGreaterThan(2205);
        expect(samples.length).toBeLessThanOrEqual(2400);
    });

    it("uses CAMB.AI's default voice when none is picked, or the one picked isn't a number, and keeps the text to CAMB.AI's limit", async () => {
        const c = await fakeCamb((res) => res.end(pcm(10)));
        await collect(new CambSpeech().speak(request(c.base, { voiceId: '' })));
        await collect(new CambSpeech().speak(request(c.base, { voiceId: 'nora' }, { text: 'a'.repeat(5000) })));
        expect(c.seen.map((seen) => seen.body?.voice_id)).toEqual([CAMB_DEFAULT_VOICE, CAMB_DEFAULT_VOICE]);
        expect((c.seen[1].body?.text as string).length).toBe(3000);
    });

    it('ends a reply shorter than CAMB.AI takes with dots, and leaves a longer one as it is', async () => {
        const c = await fakeCamb((res) => res.end(pcm(10)));
        await collect(new CambSpeech().speak(request(c.base, {}, { text: 'Ok' })));
        await collect(new CambSpeech().speak(request(c.base, {}, { text: 'Hello' })));
        expect(c.seen.map((seen) => seen.body?.text)).toEqual(['Ok.', 'Hello']);
    });

    it('turns a language into a locale CAMB.AI takes', () => {
        expect(cambLocale('ar-KW')).toBe('ar-kw');
        expect(cambLocale('ar')).toBe('ar-sa');
        expect(cambLocale('en-GB')).toBe('en-uk');
        expect(cambLocale('en')).toBe('en-us');
        expect(cambLocale('ja')).toBe('ja-jp');
        expect(cambLocale('xx-YY')).toBe('en-us');
        expect(cambLocale(undefined)).toBe('en-us');
    });

    it.each([401, 402, 422, 429])('fails with status %i when CAMB.AI refuses, and the key is in no failure', async (status) => {
        const c = await fakeCamb((res) => {
            res.statusCode = status;
            res.end('{"detail":"no"}');
        });
        const error = await collect(new CambSpeech().speak(request(c.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(status);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('is registered as "camb" for speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(CAMB_ADAPTER)).toBeInstanceOf(CambSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('camb', own) }).connectors.speech('camb')).toBe(own);
    });
});
