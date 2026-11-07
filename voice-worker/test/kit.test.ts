// The shared provider kit (#1883): the pieces every voice company's connector is made of, checked against stand-in
// servers on loopback. No key, no network, no spend. A company built on the kit only adds its own spec.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { answerStatus } from '../src/kit/errors.ts';
import { httpSpeech } from '../src/kit/httpSpeech.ts';
import { decodeAudioText, PcmReader, Resampler, wavDataStart, wavFile } from '../src/kit/pcm.ts';
import { baseLanguage, signInFields } from '../src/kit/signIn.ts';
import { socketHearing, type HearingMessage } from '../src/kit/socketHearing.ts';
import { socketSpeech } from '../src/kit/socketSpeech.ts';
import { uploadHearing } from '../src/kit/uploadHearing.ts';
import { sleep, waitFor } from './harness.ts';

const KEY = 'kit-test-key-789';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

const pcm = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer);

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

function speechRequest(base: string, extra: Partial<SpeechRequest> = {}): SpeechRequest {
    return {
        text: 'Hello there',
        settings: { adapter: 'test', model: 'm1', voiceId: 'v1', key: new Secret(KEY), endpoint: base },
        signal: new AbortController().signal,
        ...extra,
    };
}

async function httpServer(handler: http.RequestListener): Promise<{ base: string; server: http.Server }> {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(
        () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            })
    );
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

/** A WebSocket stand-in. `refuse` answers the upgrade with that status and `body`; otherwise `onSocket` drives it. */
async function socketServer(options: { refuse?: number; body?: string; onSocket?: (ws: WebSocket, url: string, headers: http.IncomingHttpHeaders) => void }) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen: { url?: string; authorization?: string }[] = [];
    server.on('upgrade', (req, socket, head) => {
        seen.push({ url: req.url, authorization: req.headers.authorization });
        if (options.refuse) {
            const body = options.body ?? '';
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => options.onSocket?.(ws, req.url ?? '', req.headers));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(
        () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                server.closeAllConnections();
                server.close(() => resolve());
            })
    );
    return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function heard() {
    const got = { partials: [] as string[], finals: [] as string[], failures: [] as { text: string; status?: number }[], endpoints: 0 };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        failed: (text, failure) => got.failures.push({ text, ...(failure?.status === undefined ? {} : { status: failure.status }) }),
        endpoint: () => got.endpoints++,
    };
    return { got, events };
}

const hearingSettings = (endpoint: string) => ({ adapter: 'test', model: 'm1', key: new Secret(KEY), endpoint, language: 'ar-KW' });

describe('the kit audio pieces', () => {
    it('keeps a sample split across pieces, and skips a WAV header only when asked', () => {
        const reader = new PcmReader();
        const bytes = new Uint8Array(pcm(1000, -2000));
        expect(reader.take(bytes.subarray(0, 3))).toEqual(new Int16Array([1000]));
        expect(reader.take(bytes.subarray(3))).toEqual(new Int16Array([-2000]));
        const wav = wavFile(new Int16Array([4, 5]), 16000);
        expect(new PcmReader({ skipWavHeader: true }).take(wav)).toEqual(new Int16Array([4, 5]));
        expect(new PcmReader().take(wav)?.length).toBe(24);
    });

    it('skips a WAV header with extra chunks before the samples (Resemble), even when it comes in pieces', () => {
        const wav = withChunksBeforeData(wavFile(new Int16Array([7, -8, 9]), 48000), [['cue ', 28], ['LIST', 41]]);
        const reader = new PcmReader({ skipWavHeader: true });
        const got: number[] = [];
        for (let at = 0; at < wav.length; at += 10) got.push(...(reader.take(wav.subarray(at, at + 10)) ?? []));
        expect(got).toEqual([7, -8, 9]);
        expect(wavDataStart(wav)).toBe(wav.length - 6);
        expect(wavDataStart(wav.subarray(0, 60))).toBeUndefined();
    });

    it('reads audio sent as base64 or hex', () => {
        expect(decodeAudioText(pcm(7).toString('base64'), 'base64')).toEqual(new Uint8Array(pcm(7)));
        expect(decodeAudioText(pcm(7).toString('hex'), 'hex')).toEqual(new Uint8Array(pcm(7)));
    });

    it.each([
        [16000, 24000],
        [22050, 24000],
        [44100, 24000],
        [24000, 16000],
        [48000, 16000],
    ])('resamples %i Hz to %i Hz keeping the length and the tone', (from, to) => {
        const resampler = new Resampler(from, to);
        const seconds = 0.5;
        const tone = (rate: number, n: number) => Int16Array.from({ length: n }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)));
        const input = tone(from, from * seconds);
        // Fed in uneven pieces, as a stream arrives
        const out: number[] = [];
        for (let at = 0; at < input.length; at += 777) out.push(...resampler.process(input.subarray(at, at + 777)));
        expect(Math.abs(out.length - to * seconds)).toBeLessThan(40);
        const expected = tone(to, out.length);
        // Away from the start, where the filter is still filling, the tone matches closely
        let error = 0;
        let power = 0;
        for (let i = 200; i < out.length - 50; i++) {
            error += (out[i] - expected[i]) ** 2;
            power += expected[i] ** 2;
        }
        expect(error / power).toBeLessThan(0.02);
    });

    it('passes audio through untouched when the rates match', () => {
        const samples = new Int16Array([1, 2, 3]);
        expect(new Resampler(24000, 24000).process(samples)).toBe(samples);
    });

    it('makes a WAV file a company can read', () => {
        const wav = Buffer.from(wavFile(new Int16Array([1, -1]), 16000));
        expect(wav.subarray(0, 4).toString()).toBe('RIFF');
        expect(wav.readUInt32LE(24)).toBe(16000);
        expect(wav.readUInt32LE(40)).toBe(4);
        expect(wav.length).toBe(48);
    });
});

describe('the kit sign-in fields', () => {
    it('reads a plain key as the one field `key`, and named fields from a JSON key', () => {
        expect(signInFields('test', new Secret(` ${KEY} `), ['key']).key.reveal()).toBe(KEY);
        const aws = signInFields('aws', new Secret(JSON.stringify({ accessKeyId: 'AK', secretAccessKey: 'SK', region: 'eu-west-1' })), ['accessKeyId', 'secretAccessKey', 'region']);
        expect([aws.accessKeyId.reveal(), aws.secretAccessKey.reveal(), aws.region.reveal()]).toEqual(['AK', 'SK', 'eu-west-1']);
        const google = signInFields('google', new Secret(JSON.stringify({ serviceAccount: { client_email: 'a@b' } })), ['serviceAccount']);
        expect(JSON.parse(google.serviceAccount.reveal())).toEqual({ client_email: 'a@b' });
    });

    it('fails as a refused key, without the key, when a field is missing or the JSON is broken', () => {
        for (const raw of [JSON.stringify({ accessKeyId: 'AK-secret' }), '{"accessKeyId": "AK-secret"']) {
            let error: unknown;
            try {
                signInFields('aws', new Secret(raw), ['accessKeyId', 'secretAccessKey']);
            } catch (e) {
                error = e;
            }
            expect(error).toBeInstanceOf(ProviderError);
            expect((error as ProviderError).status).toBe(401);
            expect((error as Error).message).not.toContain('AK-secret');
        }
    });

    it('gives the base language', () => {
        expect(baseLanguage('ar-KW')).toBe('ar');
        expect(baseLanguage('EN_us')).toBe('en');
    });

    it('turns an "out of credit" answer into 402 only when the company says so', () => {
        const check = (status: number, body: string) => status === 400 && body.includes('quota');
        expect(answerStatus(400, '{"error":"quota exceeded"}', check)).toBe(402);
        expect(answerStatus(400, '{"error":"bad text"}', check)).toBe(400);
        expect(answerStatus(429, 'quota', undefined)).toBe(429);
        expect(answerStatus(400, 'quota', () => { throw new Error('no'); })).toBe(400);
    });
});

describe('speaking over HTTP with the kit', () => {
    it('reads newline-delimited JSON with base64 audio, and stops at the done line', async () => {
        const c = await httpServer((_req, res) => {
            res.write(`${JSON.stringify({ audio: pcm(1, 2).toString('base64') })}\n${JSON.stringify({ audio: pcm(3).toString('base64') })}`);
            setTimeout(() => res.end(`\n${JSON.stringify({ done: true })}\n${JSON.stringify({ audio: pcm(99).toString('base64') })}\n`), 20);
        });
        const speech = httpSpeech({
            adapter: 'test',
            endpoint: 'http://unused',
            call: () => ({ url: '/speak', headers: {} }),
            audio: { kind: 'lines', sampleRate: 24000, encoding: 'base64', read: (m) => m as { audio?: string; done?: boolean } },
        });
        expect(await collect(speech.speak(speechRequest(c.base)))).toEqual([1, 2, 3]);
    });

    it('reads server-sent events with hex audio, skipping comments and other fields', async () => {
        const c = await httpServer((_req, res) => {
            res.setHeader('content-type', 'text/event-stream');
            res.end(`: hello\nevent: audio\ndata: ${JSON.stringify({ data: { audio: pcm(5, 6).toString('hex') } })}\n\ndata: [DONE]\n\n`);
        });
        const speech = httpSpeech({
            adapter: 'test',
            endpoint: 'http://unused',
            call: () => ({ url: '/speak', headers: {} }),
            audio: { kind: 'lines', sampleRate: 24000, encoding: 'hex', read: (m) => ({ audio: (m as { data: { audio: string } }).data.audio }) },
        });
        expect(await collect(speech.speak(speechRequest(c.base)))).toEqual([5, 6]);
    });

    it('fails with the status a line reports, and with 402 when the refusal reads as out of credit', async () => {
        const inStream = await httpServer((_req, res) => res.end(`${JSON.stringify({ error: { code: 429 } })}\n`));
        const lines = httpSpeech({
            adapter: 'test',
            endpoint: 'http://unused',
            call: () => ({ url: '/speak', headers: {} }),
            audio: { kind: 'lines', sampleRate: 24000, encoding: 'base64', read: (m) => ({ error: { status: (m as { error: { code: number } }).error.code } }) },
        });
        const error = await collect(lines.speak(speechRequest(inStream.base))).catch((e: unknown) => e);
        expect((error as ProviderError).status).toBe(429);

        const refused = await httpServer((_req, res) => {
            res.statusCode = 400;
            res.end('{"error":"insufficient balance"}');
        });
        const raw = httpSpeech({
            adapter: 'test',
            endpoint: 'http://unused',
            call: () => ({ url: '/speak', headers: { authorization: `Bearer ${KEY}` } }),
            audio: { kind: 'raw', sampleRate: 24000 },
            outOfCredit: (_s, body) => body.includes('insufficient balance'),
        });
        const credit = await collect(raw.speak(speechRequest(refused.base))).catch((e: unknown) => e);
        expect(credit).toBeInstanceOf(ProviderError);
        expect((credit as ProviderError).status).toBe(402);
        expect(`${(credit as Error).message} ${JSON.stringify(credit)}`).not.toContain(KEY);
    });

    it("brings a company's 16 kHz audio to 24 kHz", async () => {
        const c = await httpServer((_req, res) => res.end(Buffer.from(new Int16Array(16000).buffer)));
        const speech = httpSpeech({ adapter: 'test', endpoint: 'http://unused', call: () => ({ url: '/s', headers: {} }), audio: { kind: 'raw', sampleRate: 16000 } });
        const samples = await collect(speech.speak(speechRequest(c.base)));
        expect(Math.abs(samples.length - 24000)).toBeLessThan(40);
    });

    it('does not follow a redirect, so the key never goes to another address', async () => {
        const c = await httpServer((_req, res) => {
            res.statusCode = 307;
            res.setHeader('location', 'http://127.0.0.1:1/elsewhere');
            res.end();
        });
        const speech = httpSpeech({ adapter: 'test', endpoint: 'http://unused', call: () => ({ url: '/s', headers: { authorization: KEY } }), audio: { kind: 'raw', sampleRate: 24000 } });
        const error = await collect(speech.speak(speechRequest(c.base))).catch((e: unknown) => e);
        expect((error as ProviderError).status).toBe(307);
    });
});

describe('speaking over a WebSocket with the kit', () => {
    const spec = (url: string, extra: object = {}) =>
        socketSpeech({
            adapter: 'test',
            endpoint: url,
            connect: (request, base) => ({ url: `${base}/speak?model=${request.settings.model}`, headers: { authorization: `Bearer ${request.settings.key.reveal()}` } }),
            send: (request) => [JSON.stringify({ text: request.text }), JSON.stringify({ flush: true })],
            read: (data, isBinary) => {
                if (isBinary) return { audio: new Uint8Array(data) };
                const message = JSON.parse(data.toString()) as { audio?: string; done?: boolean; error?: number };
                return { audio: message.audio, done: message.done, error: message.error ? { status: message.error } : undefined };
            },
            audio: { sampleRate: 24000 },
            ...extra,
        });

    it('sends the setup and the text, plays binary and base64 audio in order, and ends at done', async () => {
        const sent: string[] = [];
        const s = await socketServer({
            onSocket: (ws) =>
                ws.on('message', (data) => {
                    sent.push(data.toString());
                    if (sent.length < 2) return;
                    ws.send(pcm(1, 2));
                    ws.send(JSON.stringify({ audio: pcm(3).toString('base64') }));
                    ws.send(JSON.stringify({ done: true }));
                }),
        });
        expect(await collect(spec(s.url).speak(speechRequest(s.url)))).toEqual([1, 2, 3]);
        expect(sent).toEqual(['{"text":"Hello there"}', '{"flush":true}']);
        expect(s.seen[0]).toEqual({ url: '/speak?model=m1', authorization: `Bearer ${KEY}` });
    });

    it('fails as the company, without crashing the worker, when the key cannot be sent in a header', async () => {
        const s = await socketServer({});
        const request = speechRequest(s.url);
        const error = await collect(spec(s.url).speak({ ...request, settings: { ...request.settings, key: new Secret('pasted\nkey') } })).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).message).not.toContain('pasted');
        expect(s.seen).toEqual([]);
    });

    it('fails with the status of a refused connection, without the key', async () => {
        const s = await socketServer({ refuse: 401 });
        const error = await collect(spec(s.url).speak(speechRequest(s.url))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(401);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('fails with the status an answer reports, and without one when the socket closes early', async () => {
        const reported = await socketServer({ onSocket: (ws) => ws.on('message', () => ws.send(JSON.stringify({ error: 402 }))) });
        expect(((await collect(spec(reported.url).speak(speechRequest(reported.url))).catch((e: unknown) => e)) as ProviderError).status).toBe(402);
        const closed = await socketServer({
            onSocket: (ws) => {
                ws.send(pcm(4));
                setTimeout(() => ws.close(), 20);
            },
        });
        const got: number[] = [];
        const error = await (async () => {
            for await (const chunk of spec(closed.url).speak(speechRequest(closed.url))) got.push(...chunk);
        })().catch((e: unknown) => e);
        expect(got).toEqual([4]);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
    });

    it('treats a close after audio as the end when the company just closes', async () => {
        const s = await socketServer({
            onSocket: (ws) => {
                ws.send(pcm(8, 9));
                setTimeout(() => ws.close(), 20);
            },
        });
        expect(await collect(spec(s.url, { closeEndsReply: true }).speak(speechRequest(s.url)))).toEqual([8, 9]);
    });

    it('fails when the company goes quiet, and stops quietly when the reply is no longer wanted', async () => {
        const silent = await socketServer({ onSocket: () => undefined });
        const error = await collect(spec(silent.url, { quietMs: 100 }).speak(speechRequest(silent.url))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);

        let closedByUs = false;
        const endless = await socketServer({
            onSocket: (ws) => {
                ws.on('close', () => (closedByUs = true));
                const timer = setInterval(() => ws.readyState === ws.OPEN && ws.send(pcm(7)), 10);
                ws.on('close', () => clearInterval(timer));
            },
        });
        const abort = new AbortController();
        const got: number[] = [];
        for await (const chunk of spec(endless.url).speak(speechRequest(endless.url, { signal: abort.signal }))) {
            got.push(...chunk);
            abort.abort();
        }
        expect(got).toEqual([7]);
        await waitFor('the socket to close', () => closedByUs);
    });
});

describe('hearing over a WebSocket with the kit', () => {
    interface Fake {
        url: string;
        seen: { url?: string; authorization?: string }[];
        setup: string[];
        audioBytes: number;
        ended: boolean;
        send: (m: object) => void;
        close: () => void;
    }

    async function fakeHearing(onEnd?: (fake: Fake) => void, refuse?: number): Promise<Fake> {
        let current: WebSocket | undefined;
        const fake = {} as Fake;
        const s = await socketServer({
            refuse,
            onSocket: (ws) => {
                current = ws;
                ws.on('message', (data, isBinary) => {
                    if (isBinary) {
                        fake.audioBytes += (data as Buffer).length;
                        return;
                    }
                    const text = data.toString();
                    if (text === '{"type":"end"}') {
                        fake.ended = true;
                        onEnd?.(fake);
                        return;
                    }
                    fake.setup.push(text);
                });
            },
        });
        Object.assign(fake, { url: s.url, seen: s.seen, setup: [], audioBytes: 0, ended: false, send: (m: object) => current?.send(JSON.stringify(m)), close: () => current?.close() });
        return fake;
    }

    const spec = (extra: object = {}) =>
        socketHearing({
            adapter: 'test',
            endpoint: 'ws://unused',
            connect: (settings, base) => ({ url: `${base}/listen`, headers: { authorization: `Token ${settings.key.reveal()}` } }),
            start: (settings) => [JSON.stringify({ model: settings.model, language: baseLanguage(settings.language ?? '') })],
            finish: () => ['{"type":"end"}'],
            read: (data) => JSON.parse(data.toString()) as HearingMessage,
            ...extra,
        });

    it('sends the setup, then audio held while connecting, shows words as they come, and ends with the last ones', async () => {
        const fake = await fakeHearing((f) => {
            f.send({ committed: 'world' });
            f.send({ finished: true });
        });
        const { got, events } = heard();
        const stream = spec().listen(hearingSettings(fake.url), events);
        stream.push(new Int16Array(1600));
        await waitFor('the setup', () => fake.setup.length === 1);
        expect(JSON.parse(fake.setup[0])).toEqual({ model: 'm1', language: 'ar' });
        await waitFor('the held audio', () => fake.audioBytes === 3200);
        fake.send({ interim: 'hel' });
        fake.send({ committed: 'hello', endpoint: true });
        await waitFor('the endpoint', () => got.endpoints === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['hel', 'hello', 'hello world']);
        expect(got.finals).toEqual(['hello world']);
        expect(got.failures).toEqual([]);
        expect(fake.seen[0]).toEqual({ url: '/listen', authorization: `Token ${KEY}` });
    });

    it('joins tokens as they are when the company sends its own spaces', async () => {
        const fake = await fakeHearing((f) => f.send({ finished: true }));
        const { got, events } = heard();
        const stream = spec({ join: 'tokens' }).listen(hearingSettings(fake.url), events);
        await waitFor('the setup', () => fake.setup.length === 1);
        fake.send({ committed: 'Hel' });
        fake.send({ committed: 'lo', interim: ' there' });
        await waitFor('the words', () => got.partials.length === 2);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Hel', 'Hello there']);
        // Words still open when the company finishes are kept, as Soniox's are
        expect(got.finals).toEqual(['Hello there']);
    });

    it('ends with the words heard when the company closes after the last words', async () => {
        const fake = await fakeHearing((f) => f.close());
        const { got, events } = heard();
        const stream = spec({ closeIsFinished: true }).listen(hearingSettings(fake.url), events);
        await waitFor('the setup', () => fake.setup.length === 1);
        fake.send({ committed: 'marhaba' });
        await waitFor('the words', () => got.partials.length === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['marhaba']);
    });

    it('fails with the status of a refused connection, and with 402 when it reads as out of credit', async () => {
        const fake = await fakeHearing(undefined, 401);
        const { got, events } = heard();
        spec().listen(hearingSettings(fake.url), events);
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);

        const s = await socketServer({ refuse: 403, body: '{"error":"no credits left"}' });
        const credit = heard();
        spec({ outOfCredit: (_s: number, body: string) => body.includes('no credits') }).listen(hearingSettings(s.url), credit.events);
        await waitFor('the failure', () => credit.got.failures.length === 1);
        expect(credit.got.failures).toEqual([{ text: '', status: 402 }]);
    });

    it('fails with the words so far when the socket drops or the last words take too long', async () => {
        const fake = await fakeHearing();
        const { got, events } = heard();
        spec().listen(hearingSettings(fake.url), events);
        await waitFor('the setup', () => fake.setup.length === 1);
        fake.send({ committed: 'half' });
        await waitFor('the words', () => got.partials.length === 1);
        fake.close();
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: 'half' }]);

        const slow = await fakeHearing();
        const late = heard();
        const stream = spec({ finalTimeoutMs: 100 }).listen(hearingSettings(slow.url), late.events);
        await waitFor('the setup', () => slow.setup.length === 1);
        stream.finish();
        await waitFor('the failure', () => late.got.failures.length === 1);
        expect(late.got.failures).toEqual([{ text: '' }]);
    });

    it('waits for an address the company hands out first, and fails with its status when that is refused', async () => {
        const fake = await fakeHearing((f) => f.send({ finished: true }));
        const { got, events } = heard();
        const stream = spec({ connect: async () => (await sleep(30), { url: `${fake.url}/session-1` }) }).listen(hearingSettings(''), events);
        stream.push(new Int16Array(160));
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(fake.seen[0].url).toBe('/session-1');
        expect(fake.audioBytes).toBe(320);

        const refused = heard();
        spec({ connect: async () => Promise.reject(new ProviderError('test refused the session', 401)) }).listen(hearingSettings(''), refused.events);
        await waitFor('the failure', () => refused.got.failures.length === 1);
        expect(refused.got.failures).toEqual([{ text: '', status: 401 }]);
    });

    it('waits for the last answer from when the end of the audio goes out, and fails when the socket never opens', async () => {
        const fake = await fakeHearing((f) => setTimeout(() => f.send({ committed: 'late words' }), 50));
        const { got, events } = heard();
        const lastAnswer = { lastAnswerAfterFinish: { quietMs: 100 }, finalTimeoutMs: 1_000 };
        const slow = spec({ ...lastAnswer, connect: async () => (await sleep(150), { url: `${fake.url}/listen` }) });
        const stream = slow.listen(hearingSettings(''), events);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['late words']);

        const stuck = heard();
        spec({ lastAnswerAfterFinish: { quietMs: 50 }, finalTimeoutMs: 150, connect: () => new Promise<never>(() => undefined) })
            .listen(hearingSettings(''), stuck.events)
            .finish();
        await waitFor('the failure', () => stuck.got.failures.length === 1);
        expect(stuck.got.finals).toEqual([]);
        expect(stuck.got.failures).toEqual([{ text: '' }]);
    });

    it('fails, without crashing the worker, when the key cannot be sent in a header', async () => {
        const fake = await fakeHearing();
        const { got, events } = heard();
        spec().listen({ ...hearingSettings(fake.url), key: new Secret('pasted\nkey') }, events);
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '' }]);
        expect(fake.seen).toEqual([]);
    });

    it('says nothing after close', async () => {
        const fake = await fakeHearing();
        const { got, events } = heard();
        const stream = spec().listen(hearingSettings(fake.url), events);
        await waitFor('the setup', () => fake.setup.length === 1);
        stream.close();
        fake.send({ committed: 'late' });
        await sleep(50);
        expect(got).toEqual({ partials: [], finals: [], failures: [], endpoints: 0 });
    });
});

describe('hearing by upload with the kit', () => {
    it('sends the stretch as one 16 kHz WAV at the pause and gives back the words', async () => {
        const uploads: { url?: string; authorization?: string; bytes: Buffer }[] = [];
        const c = await httpServer((req, res) => {
            const parts: Buffer[] = [];
            req.on('data', (d: Buffer) => parts.push(d));
            req.on('end', () => {
                uploads.push({ url: req.url, authorization: req.headers.authorization, bytes: Buffer.concat(parts) });
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ text: '  ahlan   wa sahlan ' }));
            });
        });
        const hearing = uploadHearing({
            adapter: 'test',
            endpoint: 'http://unused',
            request: (settings, wav) => ({ url: `/transcribe?model=${settings.model}`, headers: { authorization: `Bearer ${settings.key.reveal()}`, 'content-type': 'audio/wav' }, body: wav }),
            read: (answer) => (answer as { text: string }).text,
        });
        const { got, events } = heard();
        const stream = hearing.listen(hearingSettings(c.base), events);
        stream.push(new Int16Array([1, 2]));
        stream.push(new Int16Array([3]));
        expect(got.partials).toEqual([]);
        stream.finish();
        await waitFor('the words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['ahlan wa sahlan']);
        expect(uploads[0].url).toBe('/transcribe?model=m1');
        expect(uploads[0].authorization).toBe(`Bearer ${KEY}`);
        expect(uploads[0].bytes.subarray(0, 4).toString()).toBe('RIFF');
        expect(uploads[0].bytes.readUInt32LE(24)).toBe(16000);
        expect([...new Int16Array(uploads[0].bytes.buffer.slice(uploads[0].bytes.byteOffset + 44, uploads[0].bytes.byteOffset + uploads[0].bytes.length))]).toEqual([1, 2, 3]);
    });

    it('says nothing was heard without calling the company when there was no audio', async () => {
        let calls = 0;
        const c = await httpServer((_req, res) => {
            calls++;
            res.end('{}');
        });
        const hearing = uploadHearing({ adapter: 'test', endpoint: c.base, request: () => ({ url: '/t', headers: {} }), read: () => 'x' });
        const { got, events } = heard();
        hearing.listen(hearingSettings(c.base), events).finish();
        await waitFor('the words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['']);
        expect(calls).toBe(0);
    });

    it('fails with the status of a refusal, and without one when the company is too slow', async () => {
        const busy = await httpServer((_req, res) => {
            res.statusCode = 429;
            res.end('slow down');
        });
        const hearing = (timeoutMs?: number) => uploadHearing({ adapter: 'test', endpoint: 'http://unused', request: () => ({ url: '/t', headers: {} }), read: () => 'x', timeoutMs });
        const refused = heard();
        const one = hearing().listen(hearingSettings(busy.base), refused.events);
        one.push(new Int16Array(10));
        one.finish();
        await waitFor('the failure', () => refused.got.failures.length === 1);
        expect(refused.got.failures).toEqual([{ text: '', status: 429 }]);

        const stalled = await httpServer(() => undefined);
        const slow = heard();
        const two = hearing(100).listen(hearingSettings(stalled.base), slow.events);
        two.push(new Int16Array(10));
        two.finish();
        await waitFor('the failure', () => slow.got.failures.length === 1);
        expect(slow.got.failures).toEqual([{ text: '' }]);
    });
});

/** A WAV with chunks of the given ids and sizes put between its fmt chunk and its samples (an odd size is padded, as WAV wants). */
function withChunksBeforeData(wav: Uint8Array, chunks: [string, number][]): Uint8Array {
    const extra = chunks.map(([id, size]) => {
        const chunk = Buffer.alloc(8 + size + (size % 2), 0x5a);
        chunk.write(id, 0, 'ascii');
        chunk.writeUInt32LE(size, 4);
        return chunk;
    });
    return new Uint8Array(Buffer.concat([Buffer.from(wav.subarray(0, 36)), ...extra, Buffer.from(wav.subarray(36))]));
}
