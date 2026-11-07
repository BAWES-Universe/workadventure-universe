// Hearing with fal (#1885), against a stand-in fal server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import { FAL_ADAPTER, FalRecognition } from '../src/fal.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'fal-hear-key-246';

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

async function fakeFal(reply: (res: http.ServerResponse) => void) {
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

const settings = (endpoint: string, changes: object = {}) => ({ adapter: 'fal', model: 'fal-ai/wizper', key: new Secret(KEY), endpoint, language: 'ar-KW', ...changes });
const json = (body: unknown) => (res: http.ServerResponse) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
};

async function hear(endpoint: string, changes: object = {}) {
    const { got, events } = heard();
    const stream = new FalRecognition().listen(settings(endpoint, changes), events);
    stream.push(new Int16Array([1, 2, 3]));
    stream.finish();
    await waitFor('the answer', () => got.finals.length + got.failures.length === 1);
    return got;
}

describe('hearing with fal', () => {
    it("sends the stretch as a WAV data address to the model's app, with the key as `Key`, and gives back the words", async () => {
        const c = await fakeFal(json({ text: ' Marhaba  habibi ', chunks: [] }));
        const got = await hear(c.base);
        expect(got.finals).toEqual(['Marhaba habibi']);
        expect(c.seen[0]).toMatchObject({ method: 'POST', url: '/fal-ai/wizper', authorization: `Key ${KEY}` });
        const body = c.seen[0].body!;
        expect(body).toMatchObject({ task: 'transcribe', language: 'ar', chunk_level: 'segment' });
        const wav = Buffer.from((body.audio_url as string).replace(/^data:audio\/wav;base64,/, ''), 'base64');
        expect(wav.subarray(0, 4).toString()).toBe('RIFF');
        expect(wav.readUInt32LE(24)).toBe(16000);
    });

    it('lets fal work out the language when none is set', async () => {
        const c = await fakeFal(json({ text: 'hi' }));
        await hear(c.base, { language: undefined });
        expect(c.seen[0].body?.language).toBeNull();
    });

    it('fails with the status fal refuses with, or when the answer has no words', async () => {
        const refused = await fakeFal((res) => {
            res.statusCode = 401;
            res.end('{"detail":"no"}');
        });
        expect((await hear(refused.base)).failures).toEqual([{ text: '', status: 401 }]);
        await new Promise<void>((resolve) => {
            server!.closeAllConnections();
            server!.close(() => resolve());
        });
        const odd = await fakeFal(json({ detail: 'nothing' }));
        expect((await hear(odd.base)).failures).toEqual([{ text: '' }]);
    });

    it('never sends a model that is not a fal app', async () => {
        const c = await fakeFal(json({ text: 'x' }));
        for (const model of ['wizper', 'fal-ai/../admin', 'https://evil.example/x', 'fal-ai/wizper?x=1']) {
            expect((await hear(c.base, { model })).failures).toEqual([{ text: '' }]);
        }
        expect(c.seen).toEqual([]);
    });

    it('is registered as "fal" for hearing unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.recognition(FAL_ADAPTER)).toBeInstanceOf(FalRecognition);
        const own = { listen: () => ({ push: () => undefined, finish: () => undefined, close: () => undefined }) };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerRecognition('fal', own) }).connectors.recognition('fal')).toBe(own);
    });
});
