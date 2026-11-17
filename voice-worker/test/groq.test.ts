// Hearing and speaking with Groq (#1885), against a stand-in Groq server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { GROQ_ADAPTER, GroqRecognition, GroqSpeech, groqPieces, groqVoice, readWav } from '../src/groq.ts';
import { wavFile } from '../src/kit/pcm.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'gsk-groq-key-975';

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

async function fakeGroq(reply: (res: http.ServerResponse, body: Buffer) => void) {
    const seen: { url?: string; authorization?: string; type?: string; body: Buffer }[] = [];
    server = http.createServer((req, res) => {
        const parts: Buffer[] = [];
        req.on('data', (d: Buffer) => parts.push(d));
        req.on('end', () => {
            const body = Buffer.concat(parts);
            seen.push({ url: req.url, authorization: req.headers.authorization, type: req.headers['content-type'], body });
            reply(res, body);
        });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/openai/v1`, seen };
}

const wav = (rate: number, ...samples: number[]) => Buffer.from(wavFile(new Int16Array(samples), rate));

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

const speaking = (base: string, settings: object = {}, text = 'Ahlan wa sahlan.'): SpeechRequest => ({
    text,
    settings: { adapter: 'groq', model: 'canopylabs/orpheus-v1-english', voiceId: 'noura', key: new Secret(KEY), endpoint: base, ...settings },
    signal: new AbortController().signal,
});

describe('hearing with Groq', () => {
    it("sends the stretch as one WAV file with the model and the profile's language, the key as a bearer, and gives back the words", async () => {
        const g = await fakeGroq((res) => {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ text: ' Marhaba habibi ' }));
        });
        const got = { finals: [] as string[], failures: [] as unknown[] };
        const events: RecognizerEvents = { partial: () => undefined, final: (text) => got.finals.push(text), endpoint: () => undefined, failed: (text, f) => got.failures.push({ text, f }) };
        const stream = new GroqRecognition().listen({ adapter: 'groq', model: 'whisper-large-v3-turbo', key: new Secret(KEY), endpoint: g.base, language: 'ar-KW' }, events);
        stream.push(new Int16Array([1, 2, 3]));
        stream.finish();
        await waitFor('the words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['Marhaba habibi']);
        expect(g.seen[0]).toMatchObject({ url: '/openai/v1/audio/transcriptions', authorization: `Bearer ${KEY}` });
        expect(g.seen[0].type).toMatch(/^multipart\/form-data/);
        const form = g.seen[0].body.toString('latin1');
        expect(form).toContain('name="model"\r\n\r\nwhisper-large-v3-turbo');
        expect(form).toContain('name="language"\r\n\r\nar');
        expect(form).toContain('filename="audio.wav"');
        expect(form).toContain('RIFF');
    });
});

describe('speaking with Groq', () => {
    it("speaks a voice with its own model, the key as a bearer, and plays the WAV's audio at 24 kHz", async () => {
        const g = await fakeGroq((res) => res.end(wav(24000, 1, 2, 3)));
        expect(await collect(new GroqSpeech().speak(speaking(g.base)))).toEqual([1, 2, 3]);
        expect(g.seen[0]).toMatchObject({ url: '/openai/v1/audio/speech', authorization: `Bearer ${KEY}` });
        expect(JSON.parse(g.seen[0].body.toString())).toEqual({ model: 'canopylabs/orpheus-arabic-saudi', voice: 'noura', input: 'Ahlan wa sahlan.', response_format: 'wav' });
    });

    it('resamples audio Groq sends at another rate', async () => {
        const g = await fakeGroq((res) => res.end(wav(48000, ...new Array(4800).fill(500))));
        const samples = await collect(new GroqSpeech().speak(speaking(g.base)));
        expect(samples.length).toBeGreaterThan(2300);
        expect(samples.length).toBeLessThanOrEqual(2400);
    });

    it('speaks a long reply in pieces of at most 200 characters, in order', async () => {
        let n = 0;
        const g = await fakeGroq((res) => res.end(wav(24000, ++n)));
        const text = `${'This is a sentence that goes on. '.repeat(10)}End.`;
        expect(await collect(new GroqSpeech().speak(speaking(g.base, {}, text)))).toEqual(Array.from({ length: g.seen.length }, (_, i) => i + 1));
        const inputs = g.seen.map((seen) => JSON.parse(seen.body.toString()).input as string);
        expect(inputs.length).toBeGreaterThan(1);
        expect(inputs.every((input) => input.length <= 200)).toBe(true);
        expect(inputs.join(' ')).toBe(text.replace(/\s+/g, ' ').trim());
    });

    it.each([400, 401, 429])('fails with status %i when Groq refuses, and the key is in no failure', async (status) => {
        const g = await fakeGroq((res) => {
            res.statusCode = status;
            res.end('{"error":{"message":"no"}}');
        });
        const error = await collect(new GroqSpeech().speak(speaking(g.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(status);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('fails when the answer is not 16-bit mono WAV', async () => {
        const g = await fakeGroq((res) => res.end('not audio'));
        expect(await collect(new GroqSpeech().speak(speaking(g.base))).catch((e: unknown) => e)).toBeInstanceOf(ProviderError);
    });
});

describe('Groq pieces, voices and WAV files', () => {
    it('keeps sentences whole where they fit, then words, then cuts', () => {
        expect(groqPieces('One. Two!  Three?', 10)).toEqual(['One. Two!', 'Three?']);
        expect(groqPieces('alpha beta gamma delta', 11)).toEqual(['alpha beta', 'gamma delta']);
        expect(groqPieces('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
        expect(groqPieces('   ')).toEqual([]);
    });

    it("uses a named voice's own model, and the model's first voice when none is picked", () => {
        expect(groqVoice('canopylabs/orpheus-v1-english', 'Noura')).toEqual({ model: 'canopylabs/orpheus-arabic-saudi', voice: 'noura' });
        expect(groqVoice('canopylabs/orpheus-arabic-saudi', 'troy')).toEqual({ model: 'canopylabs/orpheus-v1-english', voice: 'troy' });
        expect(groqVoice('canopylabs/orpheus-arabic-saudi', '')).toEqual({ model: 'canopylabs/orpheus-arabic-saudi', voice: 'abdullah' });
        expect(groqVoice('canopylabs/orpheus-v1-english', '')).toEqual({ model: 'canopylabs/orpheus-v1-english', voice: 'autumn' });
        expect(groqVoice('some-new-model', 'NewVoice')).toEqual({ model: 'some-new-model', voice: 'NewVoice' });
    });

    it('reads a WAV with extra chunks, and one whose data has no length', () => {
        const plain = wav(22050, 7, 8);
        expect(readWav(plain)).toEqual({ samples: new Int16Array([7, 8]), sampleRate: 22050 });
        const open = Buffer.from(plain);
        open.writeUInt32LE(0xffffffff, 40);
        expect(readWav(open).samples).toEqual(new Int16Array([7, 8]));
        const list = Buffer.concat([plain.subarray(0, 36), Buffer.from('LIST'), Buffer.from([2, 0, 0, 0, 0, 0]), plain.subarray(36)]);
        expect(readWav(list).samples).toEqual(new Int16Array([7, 8]));
    });
});

describe('the worker has Groq by name', () => {
    it('is registered as "groq" for hearing and speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(GROQ_ADAPTER)).toBeInstanceOf(GroqRecognition);
        expect(worker.connectors.speech(GROQ_ADAPTER)).toBeInstanceOf(GroqSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('groq', own) }).connectors.speech('groq')).toBe(own);
    });
});
