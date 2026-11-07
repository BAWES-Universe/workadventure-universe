// A person's own speech server (#1874), against a stand-in fetch: no server, no network, no spend. What the connector sends is what
// the stand-in sees; the address guard has its own tests (publicFetch.test.ts), and here only the default is shown to be the guard.
import { describe, expect, it } from 'vitest';
import { ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { OPENAI_COMPATIBLE_ADAPTER, OpenAiCompatibleRecognition, OpenAiCompatibleSpeech } from '../src/openaiCompatible.ts';
import type { FetchLike } from '../src/kit/httpSpeech.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { wavFile } from '../src/kit/pcm.ts';
import { waitFor } from './harness.ts';

const ADDRESS = 'https://speech.example.com/v1';
const KEY = 'own-key-123';

interface Call {
    url: string;
    method?: string;
    headers: Record<string, string>;
    body?: RequestInit['body'];
}

/** A fetch that notes what it was asked and answers with `reply`. */
function standIn(reply: () => Response): { fetch: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    return {
        calls,
        fetch: async (input, init = {}) => {
            const headers: Record<string, string> = {};
            new Headers(init.headers).forEach((value, key) => (headers[key] = value));
            calls.push({ url: String(input), method: init.method, headers, body: init.body });
            return reply();
        },
    };
}

const pcm = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer);
const request = (settings: object = {}, extra: Partial<SpeechRequest> = {}): SpeechRequest => ({
    text: 'Hello there',
    settings: { adapter: OPENAI_COMPATIBLE_ADAPTER, model: 'kokoro', voiceId: 'af_heart', key: new Secret(KEY), endpoint: ADDRESS, ...settings },
    signal: new AbortController().signal,
    ...extra,
});
async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

describe('speaking on your own server', () => {
    it('asks {address}/audio/speech for raw pcm with the model, the words and the voice, and the key as a bearer token', async () => {
        const server = standIn(() => new Response(pcm(1, 2, 3)));
        const samples = await collect(new OpenAiCompatibleSpeech({ fetch: server.fetch }).speak(request()));
        expect(samples).toEqual([1, 2, 3]);
        expect(server.calls).toHaveLength(1);
        expect(server.calls[0]).toMatchObject({ url: `${ADDRESS}/audio/speech`, method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' } });
        expect(JSON.parse(server.calls[0].body as string)).toEqual({ model: 'kokoro', input: 'Hello there', voice: 'af_heart', response_format: 'pcm' });
    });

    it('sends no Authorization header when the server has no key', async () => {
        const server = standIn(() => new Response(pcm(1)));
        await collect(new OpenAiCompatibleSpeech({ fetch: server.fetch }).speak(request({ key: new Secret('') })));
        expect(server.calls[0].headers.authorization).toBeUndefined();
    });

    it('skips a WAV header in front of the audio', async () => {
        const server = standIn(() => new Response(Buffer.concat([Buffer.from(wavFile(new Int16Array(0), 24000)), pcm(4, 5, 6)])));
        expect(await collect(new OpenAiCompatibleSpeech({ fetch: server.fetch }).speak(request()))).toEqual([4, 5, 6]);
    });

    it('brings a server that speaks at another rate to 24 kHz, as its setting says', async () => {
        const second = new Int16Array(22_050).map((_, i) => Math.round(Math.sin((i / 22_050) * 2 * Math.PI * 440) * 8000));
        const server = standIn(() => new Response(Buffer.from(second.buffer)));
        const samples = await collect(new OpenAiCompatibleSpeech({ fetch: server.fetch, sampleRate: 22_050 }).speak(request()));
        // One second in, about one second out at 24 kHz (the filter holds back a few samples at the end)
        expect(samples.length).toBeGreaterThan(23_000);
        expect(samples.length).toBeLessThanOrEqual(24_000);
    });

    it('fails with the server’s status, and without one when it can’t be reached', async () => {
        const refused = standIn(() => new Response('no', { status: 401 }));
        await expect(collect(new OpenAiCompatibleSpeech({ fetch: refused.fetch }).speak(request()))).rejects.toMatchObject({ name: 'ProviderError', status: 401 });
        const gone: FetchLike = async () => {
            throw new Error('connect ECONNREFUSED');
        };
        const error = await collect(new OpenAiCompatibleSpeech({ fetch: gone }).speak(request())).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
        // The failure never carries the key
        expect(String((error as Error).message)).not.toContain(KEY);
    });

    it('goes through the address guard unless a stand-in is given: a loopback or private address is never called', async () => {
        for (const endpoint of ['http://127.0.0.1:8000/v1', 'https://localhost/v1', 'https://192.168.1.20/v1', 'https://169.254.169.254/v1', 'http://speech.example.com/v1']) {
            const error = await collect(new OpenAiCompatibleSpeech().speak(request({ endpoint }))).catch((reason: unknown) => reason);
            expect(error).toBeInstanceOf(ProviderError);
            expect((error as ProviderError).status).toBeUndefined();
        }
    });
});

function heard() {
    const got = { partials: [] as string[], finals: [] as string[], failures: [] as { text: string; status?: number }[] };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        failed: (text, failure) => got.failures.push({ text, ...(failure?.status === undefined ? {} : { status: failure.status }) }),
    };
    return { got, events };
}
const hearingSettings = (extra: object = {}) => ({ adapter: OPENAI_COMPATIBLE_ADAPTER, model: 'Systran/faster-whisper-small', key: new Secret(KEY), endpoint: ADDRESS, language: 'ar-KW', ...extra });

describe('hearing on your own server', () => {
    it('sends the stretch once, at the pause, to {address}/audio/transcriptions as a WAV with the model and the language, and gives back the words', async () => {
        const server = standIn(() => Response.json({ text: '  ahlan   wa sahlan ' }));
        const { got, events } = heard();
        const stream = new OpenAiCompatibleRecognition({ fetch: server.fetch }).listen(hearingSettings(), events);
        stream.push(new Int16Array([1, 2]));
        stream.push(new Int16Array([3]));
        // Nothing shows while the person talks
        expect(got.partials).toEqual([]);
        expect(server.calls).toHaveLength(0);
        stream.finish();
        await waitFor('the words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['ahlan wa sahlan']);
        expect(got.partials).toEqual([]);
        expect(server.calls).toHaveLength(1);
        expect(server.calls[0]).toMatchObject({ url: `${ADDRESS}/audio/transcriptions`, method: 'POST' });
        expect(server.calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
        const form = server.calls[0].body as FormData;
        expect(form.get('model')).toBe('Systran/faster-whisper-small');
        expect(form.get('response_format')).toBe('json');
        expect(form.get('language')).toBe('ar');
        const file = form.get('file') as File;
        expect(file.type).toBe('audio/wav');
        const bytes = Buffer.from(await file.arrayBuffer());
        expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
        expect(bytes.readUInt32LE(24)).toBe(16_000);
        expect([...new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length))]).toEqual([1, 2, 3]);
    });

    it('sends no language when the bot has none, and no Authorization header when the server has no key', async () => {
        const server = standIn(() => Response.json({ text: 'hello' }));
        const { got, events } = heard();
        const stream = new OpenAiCompatibleRecognition({ fetch: server.fetch }).listen(hearingSettings({ key: new Secret(''), language: undefined }), events);
        stream.push(new Int16Array(10));
        stream.finish();
        await waitFor('the words', () => got.finals.length === 1);
        expect((server.calls[0].body as FormData).has('language')).toBe(false);
        expect(server.calls[0].headers.authorization).toBeUndefined();
    });

    it('says nothing was heard, without a call, when there was no audio', async () => {
        const server = standIn(() => Response.json({ text: 'x' }));
        const { got, events } = heard();
        new OpenAiCompatibleRecognition({ fetch: server.fetch }).listen(hearingSettings(), events).finish();
        await waitFor('the words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['']);
        expect(server.calls).toHaveLength(0);
    });

    it('fails with the server’s status when it refuses, and says nothing for an answer that has no text', async () => {
        const refused = standIn(() => new Response('no', { status: 401 }));
        const first = heard();
        const one = new OpenAiCompatibleRecognition({ fetch: refused.fetch }).listen(hearingSettings(), first.events);
        one.push(new Int16Array(10));
        one.finish();
        await waitFor('the failure', () => first.got.failures.length === 1);
        expect(first.got.failures).toEqual([{ text: '', status: 401 }]);

        const odd = standIn(() => Response.json({ nothing: true }));
        const second = heard();
        const two = new OpenAiCompatibleRecognition({ fetch: odd.fetch }).listen(hearingSettings(), second.events);
        two.push(new Int16Array(10));
        two.finish();
        await waitFor('the words', () => second.got.finals.length === 1);
        expect(second.got.finals).toEqual(['']);
    });

    it('goes through the address guard unless a stand-in is given', async () => {
        for (const endpoint of ['http://127.0.0.1:8000/v1', 'https://10.0.0.5/v1', 'https://localhost/v1']) {
            const { got, events } = heard();
            const stream = new OpenAiCompatibleRecognition().listen(hearingSettings({ endpoint }), events);
            stream.push(new Int16Array(10));
            stream.finish();
            await waitFor('the failure', () => got.failures.length === 1);
            expect(got.failures).toEqual([{ text: '' }]);
        }
    });
});
