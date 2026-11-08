// Speaking with MiniMax (#1896), against a stand-in MiniMax server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { MINIMAX_ADAPTER, MiniMaxSpeech, minimaxLanguage } from '../src/minimax.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'minimax-key-896';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in MiniMax answering /v1/t2a_v2 with `answer`. */
async function fakeMiniMax(answer: (res: http.ServerResponse) => void) {
    const seen: { url?: string; auth?: string; body?: Record<string, unknown> }[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
            answer(res);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const hex = (...values: number[]) => Buffer.from(new Int16Array(values).buffer).toString('hex');
const ok = { status_code: 0, status_msg: 'success' };
const block = (data: object, base_resp: object = ok) => `data: ${JSON.stringify({ data, trace_id: 't-1', base_resp })}\n\n`;

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Bonjour.',
    settings: {
        adapter: 'minimax',
        model: 'speech-2.6-hd',
        voiceId: 'French_Male_Speech_New',
        key: new Secret(KEY),
        endpoint: base,
        language: 'fr-FR',
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

describe('speaking with MiniMax', () => {
    it('asks for streamed 24 kHz PCM with the key as a bearer, and plays each piece but not the whole reply again', async () => {
        const s = await fakeMiniMax((res) => {
            res.setHeader('content-type', 'text/event-stream');
            res.write(block({ audio: hex(1, 2), status: 1 }));
            res.write(block({ audio: hex(-3), status: 1 }));
            res.end(block({ audio: hex(1, 2, -3), status: 2 }));
        });
        expect(await collect(new MiniMaxSpeech().speak(speaking(s.base)))).toEqual([1, 2, -3]);
        expect(s.seen[0]).toEqual({
            url: '/v1/t2a_v2',
            auth: `Bearer ${KEY}`,
            body: {
                model: 'speech-2.6-hd',
                text: 'Bonjour.',
                stream: true,
                stream_options: { exclude_aggregated_audio: true },
                voice_setting: { voice_id: 'French_Male_Speech_New' },
                audio_setting: { format: 'pcm', sample_rate: 24000, channel: 1 },
                language_boost: 'French',
            },
        });
    });

    it("uses Pipecat's model and voice when the bot names none, and leaves a language MiniMax doesn't name to it", async () => {
        const s = await fakeMiniMax((res) => res.end(block({ audio: '', status: 2 })));
        await collect(new MiniMaxSpeech().speak(speaking(s.base, { lang: 'sw-KE' }, { model: '', voiceId: '' })));
        expect(s.seen[0].body).toMatchObject({ model: 'speech-2.8-turbo', voice_setting: { voice_id: 'Calm_Woman' } });
        expect(s.seen[0].body).not.toHaveProperty('language_boost');
        expect(minimaxLanguage('ar-KW')).toBe('Arabic');
        expect(minimaxLanguage('zh-HK')).toBe('Chinese,Yue');
        expect(minimaxLanguage('zh-CN')).toBe('Chinese');
        expect(minimaxLanguage(undefined)).toBeUndefined();
    });

    it('fails with the status MiniMax reports, whether it refuses at the door or inside a 200 answer, the key in no failure', async () => {
        const refused = await fakeMiniMax((res) => {
            res.statusCode = 401;
            res.end('{"base_resp":{"status_code":1004,"status_msg":"login fail"}}');
        });
        const first = await collect(new MiniMaxSpeech().speak(speaking(refused.base))).catch((e: unknown) => e);
        expect(first).toBeInstanceOf(ProviderError);
        expect((first as ProviderError).status).toBe(401);
        expect(`${(first as Error).message} ${JSON.stringify(first)}`).not.toContain(KEY);

        const wrongKey = await fakeMiniMax((res) => res.end('{"data":null,"base_resp":{"status_code":1004,"status_msg":"login fail"}}'));
        const second = await collect(new MiniMaxSpeech().speak(speaking(wrongKey.base))).catch((e: unknown) => e);
        expect(second).toBeInstanceOf(ProviderError);
        expect((second as ProviderError).status).toBe(401);

        const unknownKey = await fakeMiniMax((res) => res.end('{"data":null,"base_resp":{"status_code":2049,"status_msg":"invalid api key"}}'));
        const unknown = await collect(new MiniMaxSpeech().speak(speaking(unknownKey.base))).catch((e: unknown) => e);
        expect((unknown as ProviderError).status).toBe(401);

        const broke = await fakeMiniMax((res) =>
            res.end(block({ audio: hex(5), status: 1 }) + block({}, { status_code: 1008, status_msg: 'insufficient balance' })),
        );
        const third = await collect(new MiniMaxSpeech().speak(speaking(broke.base))).catch((e: unknown) => e);
        expect(third).toBeInstanceOf(ProviderError);
        expect((third as ProviderError).status).toBe(402);
    });

    it('is registered as "minimax" for speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(MINIMAX_ADAPTER)).toBeInstanceOf(MiniMaxSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('minimax', own) }).connectors.speech('minimax')).toBe(own);
    });
});
