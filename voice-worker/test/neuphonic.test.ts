// Speaking with Neuphonic (#1898), against a stand-in Neuphonic server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { NEUPHONIC_ADAPTER, NeuphonicSpeech, neuphonicLanguage } from '../src/neuphonic.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'neuphonic-key-318';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in Neuphonic answering /sse/speak/{language} with `answer`. */
async function fakeNeuphonic(answer: (res: http.ServerResponse) => void) {
    const seen: { url?: string; key?: string; body?: Record<string, unknown> }[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({
                url: req.url,
                key: req.headers['x-api-key'] as string | undefined,
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

const s16 = (...values: number[]) => Buffer.from(new Int16Array(values).buffer).toString('base64');
const event = (data: object) => `event: message\ndata: ${JSON.stringify(data)}\n\n`;

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Marhaba.',
    settings: {
        adapter: 'neuphonic',
        model: 'neuphonic',
        voiceId: 'voice-1',
        key: new Secret(KEY),
        endpoint: base,
        language: 'ar-KW',
        ...settings,
    },
    signal: new AbortController().signal,
    ...changes,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

describe('speaking with Neuphonic', () => {
    it("asks in the reply's language with the voice and the key in its header, and plays the audio of every event", async () => {
        const n = await fakeNeuphonic((res) => {
            res.setHeader('content-type', 'text/event-stream');
            res.write(
                event({
                    status_code: 200,
                    data: { audio: s16(1, 2, 3), text: 'Mar', sampling_rate: 24000 },
                }),
            );
            res.end(
                event({
                    status_code: 200,
                    data: {
                        audio: s16(-4),
                        text: 'haba.',
                        sampling_rate: 24000,
                        stop: true,
                    },
                }),
            );
        });
        expect(await collect(new NeuphonicSpeech().speak(speaking(n.base)))).toEqual([1, 2, 3, -4]);
        expect(n.seen[0]).toEqual({
            url: '/sse/speak/ar',
            key: KEY,
            body: {
                text: 'Marhaba.',
                lang_code: 'ar',
                encoding: 'pcm_linear',
                sampling_rate: 24000,
                voice_id: 'voice-1',
            },
        });

        await collect(new NeuphonicSpeech().speak(speaking(n.base, { lang: 'fr-FR' }, { voiceId: '' })));
        expect(n.seen[1].url).toBe('/sse/speak/fr');
        expect(n.seen[1].body).not.toHaveProperty('voice_id');
    });

    it('speaks a language it does not list as English', () => {
        expect(neuphonicLanguage('ar-KW')).toBe('ar');
        expect(neuphonicLanguage('zh-CN')).toBe('zh');
        expect(neuphonicLanguage('sw')).toBe('en');
        expect(neuphonicLanguage(undefined)).toBe('en');
    });

    it("fails with Neuphonic's status, whether it refuses the call or reports an error in the stream, the key in no failure", async () => {
        const refused = await fakeNeuphonic((res) => {
            res.statusCode = 403;
            res.end('{"detail":"Invalid API key"}');
        });
        const first = await collect(new NeuphonicSpeech().speak(speaking(refused.base))).catch((e: unknown) => e);
        expect(first).toBeInstanceOf(ProviderError);
        expect((first as ProviderError).status).toBe(403);
        expect(`${(first as Error).message} ${JSON.stringify(first)}`).not.toContain(KEY);

        const broken = await fakeNeuphonic((res) => res.end(event({ status_code: 402, errors: ['Out of credits'] })));
        const second = await collect(new NeuphonicSpeech().speak(speaking(broken.base))).catch((e: unknown) => e);
        expect(second).toBeInstanceOf(ProviderError);
        expect((second as ProviderError).status).toBe(402);
    });

    it('is registered as "neuphonic" for speaking unless a registry already brings one', () => {
        const base = {
            port: 0,
            host: '127.0.0.1',
            maxLanes: 1,
            maxSessionsPerConnection: 1,
            ice: { iceServers: [] },
        };
        expect(new VoiceWorker(base).connectors.speech(NEUPHONIC_ADAPTER)).toBeInstanceOf(NeuphonicSpeech);
        const own = { speak: async function* () {} };
        expect(
            new VoiceWorker({
                ...base,
                connectors: new ConnectorRegistry().registerSpeech('neuphonic', own),
            }).connectors.speech('neuphonic'),
        ).toBe(own);
    });
});
