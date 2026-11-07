// Speaking with Gemini text to speech on the Gemini API (#1891), against a stand-in Google server on loopback: no key, no
// network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { GEMINI_SPEECH_ADAPTER, GeminiSpeech, geminiLanguage } from '../src/geminiSpeech.ts';
import { VoiceWorker } from '../src/server.ts';

const KEY = 'gemini-key-891';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in for the Gemini API, answering with `answer`. */
async function fakeGemini(answer: (res: http.ServerResponse) => void) {
    const seen: { url?: string; key?: string; body?: Record<string, unknown> }[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ url: req.url, key: req.headers['x-goog-api-key'] as string | undefined, body: raw ? JSON.parse(raw) : undefined });
            answer(res);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const b64 = (...values: number[]) => Buffer.from(new Int16Array(values).buffer).toString('base64');
const event = (...datas: string[]) =>
    `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: datas.map((data) => ({ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data } })) } }] })}\r\n\r\n`;

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Bonjour.',
    settings: { adapter: 'google', model: 'gemini-3.8-flash-lite-tts', voiceId: 'Puck', key: new Secret(KEY), endpoint: base, language: 'fr-FR', ...settings },
    signal: new AbortController().signal,
    ...changes,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

describe('speaking with Gemini text to speech', () => {
    it('asks for audio only with the key in its header, and plays every part of every event', async () => {
        const s = await fakeGemini((res) => {
            res.setHeader('content-type', 'text/event-stream');
            res.write(event(b64(1, 2)));
            res.write(event(b64(-3), b64(4)));
            res.end(`data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }] })}\r\n\r\n`);
        });
        expect(await collect(new GeminiSpeech().speak(speaking(s.base)))).toEqual([1, 2, -3, 4]);
        expect(s.seen[0]).toEqual({
            url: '/v1beta/models/gemini-3.8-flash-lite-tts:streamGenerateContent?alt=sse',
            key: KEY,
            body: {
                contents: [{ role: 'user', parts: [{ text: 'Bonjour.' }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { languageCode: 'fr-FR', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
                },
            },
        });
    });

    it("uses Pipecat's model and voice when the bot names none, and skips a WAV header", async () => {
        const wav = Buffer.alloc(44);
        wav.write('RIFF', 0);
        wav.write('WAVE', 8);
        wav.write('fmt ', 12);
        wav.writeUInt32LE(16, 16);
        wav.write('data', 36);
        const s = await fakeGemini((res) => res.end(event(Buffer.concat([wav, Buffer.from(new Int16Array([5, 6]).buffer)]).toString('base64'))));
        expect(await collect(new GeminiSpeech().speak(speaking(s.base, { lang: undefined }, { model: '', voiceId: '', language: undefined })))).toEqual([5, 6]);
        expect(s.seen[0].url).toBe('/v1beta/models/gemini-3.8-flash-tts:streamGenerateContent?alt=sse');
        expect(s.seen[0].body).toMatchObject({ generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } } });
        expect(JSON.stringify(s.seen[0].body)).not.toContain('languageCode');
        expect(geminiLanguage('ar_kw')).toBe('ar-KW');
        expect(geminiLanguage('ja')).toBe('ja');
    });

    it("fails with Google's status, whether it refuses the call or reports an error in the stream, a wrong key as refused, the key in no failure", async () => {
        const refused = await fakeGemini((res) => {
            res.statusCode = 400;
            res.end('{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}');
        });
        const first = await collect(new GeminiSpeech().speak(speaking(refused.base))).catch((e: unknown) => e);
        expect(first).toBeInstanceOf(ProviderError);
        // Google's 400 for a wrong key is a refused key, so the bot shows it and Orbit is asked for the key again
        expect((first as ProviderError).status).toBe(401);
        expect(`${(first as Error).message} ${JSON.stringify(first)}`).not.toContain(KEY);

        const badSetting = await fakeGemini((res) => {
            res.statusCode = 400;
            res.end('{"error":{"code":400,"message":"Voice not found.","status":"INVALID_ARGUMENT"}}');
        });
        const other = await collect(new GeminiSpeech().speak(speaking(badSetting.base))).catch((e: unknown) => e);
        expect((other as ProviderError).status).toBe(400);

        const broken = await fakeGemini((res) => res.end(`${event(b64(1))}data: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}\r\n\r\n`));
        const second = await collect(new GeminiSpeech().speak(speaking(broken.base))).catch((e: unknown) => e);
        expect(second).toBeInstanceOf(ProviderError);
        expect((second as ProviderError).status).toBe(429);
    });

    it('is registered as "google" for speaking, leaving every other Google model (talking live) to the one already there', async () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(GEMINI_SPEECH_ADAPTER)).toBeInstanceOf(GeminiSpeech);
        const said: string[] = [];
        const talking = {
            speak: async function* (request: SpeechRequest) {
                said.push(request.settings.model);
                yield new Int16Array([7]);
            },
        };
        const speech = new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('google', talking) }).connectors.speech('google')!;
        expect(await collect(speech.speak(speaking('http://127.0.0.1:9', {}, { model: 'gemini-3.8-live' })))).toEqual([7]);
        expect(said).toEqual(['gemini-3.8-live']);
    });
});
