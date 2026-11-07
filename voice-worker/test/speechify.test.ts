// Speaking with Speechify (#1905), against a stand-in Speechify server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { SPEECHIFY_ADAPTER, SPEECHIFY_API_VERSION, SpeechifySpeech, speechifyLanguage } from '../src/speechify.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'speechify-key-905';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in Speechify answering /v1/audio/stream/with-timestamps with `answer`. */
async function fakeSpeechify(answer: (res: http.ServerResponse) => void) {
    const seen: { url?: string; method?: string; auth?: string; version?: string; body?: Record<string, unknown> }[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({
                url: req.url,
                method: req.method,
                auth: req.headers.authorization,
                version: req.headers['speechify-version'] as string | undefined,
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
// As Speechify sends them: the name only on the `event:` line, never inside the data
const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Bonjour.',
    settings: {
        adapter: 'speechify',
        model: 'simba-3.5',
        voiceId: 'george',
        key: new Secret(KEY),
        endpoint: base,
        language: 'fr-CA',
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

describe('speaking with Speechify', () => {
    it('asks with the key as a bearer and the pinned version, and plays every chunk until done', async () => {
        const s = await fakeSpeechify((res) => {
            res.setHeader('content-type', 'text/event-stream');
            res.write(event('speech.chunk', { audio: s16(1, 2, 3) }));
            res.write(event('speech.chunk', { audio: s16(-4), speech_marks: [{ type: 'word', value: 'Bonjour.', start: 0, end: 8 }] }));
            res.write(event('speech.chunk', { speech_marks: [] }));
            res.write(event('speech.done', { audio_duration_ms: 400, billable_characters_count: 8 }));
            // Nothing after done is played
            res.end(event('speech.chunk', { audio: s16(9) }));
        });
        expect(await collect(new SpeechifySpeech().speak(speaking(s.base)))).toEqual([1, 2, 3, -4]);
        expect(s.seen[0]).toEqual({
            url: '/v1/audio/stream/with-timestamps',
            method: 'POST',
            auth: `Bearer ${KEY}`,
            version: SPEECHIFY_API_VERSION,
            body: { input: 'Bonjour.', voice_id: 'george', model: 'simba-3.5', output_format: 'pcm_24000', language: 'fr-FR' },
        });
    });

    it("uses Pipecat's model and voice when the bot names none, and sends no language Speechify can't be told", async () => {
        const s = await fakeSpeechify((res) => res.end(event('speech.done', { audio_duration_ms: 0 })));
        await collect(new SpeechifySpeech().speak(speaking(s.base, { lang: 'ar-KW' }, { model: '', voiceId: '' })));
        expect(s.seen[0].body).toEqual({ input: 'Bonjour.', voice_id: 'geffen_32', model: 'simba-3.5', output_format: 'pcm_24000' });

        expect(speechifyLanguage('pt', 'simba-3.0')).toBe('pt-BR');
        expect(speechifyLanguage('en-GB', 'simba-3.5')).toBe('en-US');
        expect(speechifyLanguage('de', 'simba-3.2')).toBeUndefined();
        expect(speechifyLanguage(undefined, 'simba-3.5')).toBeUndefined();
    });

    it("fails with Speechify's status when it refuses the call, and on an error in the stream, the key in no failure", async () => {
        const refused = await fakeSpeechify((res) => {
            res.statusCode = 401;
            res.end('{"error":{"code":"unauthorized","message":"Invalid API key"}}');
        });
        const first = await collect(new SpeechifySpeech().speak(speaking(refused.base))).catch((e: unknown) => e);
        expect(first).toBeInstanceOf(ProviderError);
        expect((first as ProviderError).status).toBe(401);
        expect(`${(first as Error).message} ${JSON.stringify(first)}`).not.toContain(KEY);

        const broken = await fakeSpeechify((res) => {
            res.write(event('speech.chunk', { audio: s16(5) }));
            res.end(event('speech.error', { error: { code: 'upstream_failure', message: 'Try again' } }));
        });
        const second = await collect(new SpeechifySpeech().speak(speaking(broken.base))).catch((e: unknown) => e);
        expect(second).toBeInstanceOf(ProviderError);
    });

    it('is registered as "speechify" for speaking unless a registry already brings one', () => {
        const base = {
            port: 0,
            host: '127.0.0.1',
            maxLanes: 1,
            maxSessionsPerConnection: 1,
            ice: { iceServers: [] },
        };
        expect(new VoiceWorker(base).connectors.speech(SPEECHIFY_ADAPTER)).toBeInstanceOf(SpeechifySpeech);
        const own = { speak: async function* () {} };
        expect(
            new VoiceWorker({
                ...base,
                connectors: new ConnectorRegistry().registerSpeech('speechify', own),
            }).connectors.speech('speechify'),
        ).toBe(own);
    });
});
