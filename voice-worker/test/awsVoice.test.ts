// Hearing with Amazon Transcribe and speaking with Amazon Polly (#1886), against stand-in AWS servers on loopback: no key, no
// network, no spend. The signer is checked against AWS's own published example.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { AWS_VOICE_ADAPTER, AwsPolly, AwsTranscribe, transcribeLocale } from '../src/awsVoice.ts';
import { awsKey, presignUrl, signRequest } from '../src/kit/awsSign.ts';
import { crc32, decodeEventMessage, encodeEventMessage } from '../src/kit/eventStream.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const ID = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const KEY = `${ID}:${SECRET}`;

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

describe('signing and framing', () => {
    it('signs a POST as AWS’s own example does, and reads a key kept as "ID:secret"', () => {
        // AWS's Signature Version 4 test suite, "post-x-www-form-urlencoded"
        const headers = signRequest(
            'POST',
            new URL('https://example.amazonaws.com/'),
            'Param1=value1',
            'application/x-www-form-urlencoded',
            { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
            { region: 'us-east-1', service: 'service' },
            new Date('2015-08-30T12:36:00Z'),
        );
        expect(headers.authorization).toBe(
            'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a',
        );
        expect(headers['x-amz-date']).toBe('20150830T123600Z');
        expect(awsKey(KEY)).toEqual({ accessKeyId: ID, secretAccessKey: SECRET });
        expect(awsKey('no-colon')).toBeNull();
        // Kept as sign-in fields: read by name, not split at the first colon
        expect(awsKey(JSON.stringify({ accessKeyId: ID, secretAccessKey: SECRET, region: 'eu-north-1' }))).toEqual({ accessKeyId: ID, secretAccessKey: SECRET });
        expect(awsKey(JSON.stringify({ accessKeyId: ID }))).toBeNull();
        expect(awsKey('{"accessKeyId": ')).toBeNull();
    });

    it('presigns a socket address with the ID and a signature in its query, never the secret', () => {
        const url = new URL('wss://transcribestreaming.eu-north-1.amazonaws.com:8443/stream-transcription-websocket?language-code=ar-AE&sample-rate=16000');
        const at = new Date('2026-11-07T18:00:00Z');
        const signed = presignUrl(url, awsKey(KEY)!, { region: 'eu-north-1', service: 'transcribe' }, 300, at);
        expect(signed).toMatch(
            /^wss:\/\/transcribestreaming\.eu-north-1\.amazonaws\.com:8443\/stream-transcription-websocket\?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261107%2Feu-north-1%2Ftranscribe%2Faws4_request&X-Amz-Date=20261107T180000Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&language-code=ar-AE&sample-rate=16000&X-Amz-Signature=[0-9a-f]{64}$/,
        );
        expect(signed).not.toContain(SECRET);
        expect(signed).not.toContain(encodeURIComponent(SECRET));
        // The same request and time sign the same way
        expect(presignUrl(url, awsKey(KEY)!, { region: 'eu-north-1', service: 'transcribe' }, 300, at)).toBe(signed);
    });

    it('frames a message and reads it back, refusing one whose checksum is wrong', () => {
        expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
        const message = encodeEventMessage({ ':message-type': 'event', ':event-type': 'AudioEvent' }, Buffer.from([1, 2, 3]));
        expect(decodeEventMessage(message)).toEqual({ headers: { ':message-type': 'event', ':event-type': 'AudioEvent' }, payload: Buffer.from([1, 2, 3]) });
        message[message.length - 5] ^= 0xff;
        expect(() => decodeEventMessage(message)).toThrow(/checksum/);
    });
});

/** A stand-in for Transcribe's streaming socket: answered by `onAudio` for each audio event it gets. */
async function fakeTranscribe(onAudio: (ws: WebSocket, audio: Buffer) => void = () => undefined) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { urls: [] as string[], audio: [] as Buffer[] };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        seen.urls.push(req.url ?? '');
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data) => {
                const { headers, payload } = decodeEventMessage(data as Buffer);
                if (headers[':event-type'] !== 'AudioEvent') return;
                seen.audio.push(payload);
                onAudio(ws, payload);
            });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(
        () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    );
    const transcript = (results: object[]) =>
        current?.send(
            encodeEventMessage(
                { ':message-type': 'event', ':event-type': 'TranscriptEvent', ':content-type': 'application/json' },
                Buffer.from(JSON.stringify({ Transcript: { Results: results } })),
            ),
        );
    const exception = (type: string) =>
        current?.send(
            encodeEventMessage({ ':message-type': 'exception', ':exception-type': type, ':content-type': 'application/json' }, Buffer.from('{"Message":"no"}')),
        );
    return { base: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, transcript, exception };
}

const result = (text: string, partial: boolean) => ({ ResultId: 'r', IsPartial: partial, Alternatives: [{ Transcript: text }] });

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

const hearing = (endpoint: string, changes: object = {}) => ({
    adapter: 'aws',
    model: 'amazon-transcribe',
    key: new Secret(KEY),
    endpoint,
    region: 'eu-north-1',
    language: 'ar-KW',
    ...changes,
});

describe('hearing with Amazon Transcribe', () => {
    it('signs the socket, sends framed audio, shows partial results, and ends with the results after the empty audio event', async () => {
        const s = await fakeTranscribe();
        const { got, events } = heard();
        const stream = new AwsTranscribe().listen(hearing(s.base), events);
        stream.push(new Int16Array([1, -2]));
        await waitFor('the audio', () => s.seen.audio.length === 1);
        s.transcript([result('Hello', true)]);
        await waitFor('the words so far', () => got.partials.length === 1);
        s.transcript([result('Hello there.', false)]);
        await waitFor('the settled words', () => got.partials.length === 2);
        stream.finish();
        await waitFor('the empty audio event', () => s.seen.audio.length === 2);
        expect(s.seen.audio[1].length).toBe(0);
        s.transcript([result('How are you?', false)]);
        await waitFor('the words after the end', () => got.partials.length === 3);
        expect(got.partials).toEqual(['Hello', 'Hello there.', 'Hello there. How are you?']);
        const url = new URL(`http://x${s.seen.urls[0]}`);
        expect(url.pathname).toBe('/stream-transcription-websocket');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            'language-code': 'ar-AE',
            'media-encoding': 'pcm',
            'sample-rate': '16000',
            'enable-partial-results-stabilization': 'true',
            'partial-results-stability': 'high',
            'X-Amz-SignedHeaders': 'host',
        });
        expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^AKIAIOSFODNN7EXAMPLE\/\d{8}\/eu-north-1\/transcribe\/aws4_request$/);
        expect(s.seen.urls[0]).not.toContain(encodeURIComponent(SECRET));
        expect([...new Int16Array(new Uint8Array(s.seen.audio[0]).buffer)]).toEqual([1, -2]);
    });

    it('ends the stretch when Transcribe closes after the last results', async () => {
        const s = await fakeTranscribe((ws, audio) => {
            if (audio.length === 0) {
                ws.send(
                    encodeEventMessage(
                        { ':message-type': 'event', ':event-type': 'TranscriptEvent' },
                        Buffer.from(JSON.stringify({ Transcript: { Results: [result('Bye.', false)] } })),
                    ),
                );
                ws.close();
            }
        });
        const { got, events } = heard();
        const stream = new AwsTranscribe().listen(hearing(s.base), events);
        stream.push(new Int16Array([3]));
        await waitFor('the audio', () => s.seen.audio.length === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['Bye.']);
    });

    it('fails with the status of an exception Transcribe sends, and on a key or region it cannot sign with', async () => {
        const s = await fakeTranscribe();
        const { got, events } = heard();
        new AwsTranscribe().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.urls.length === 1);
        s.exception('UnrecognizedClientException');
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 403 }]);

        const noRegion = heard();
        new AwsTranscribe().listen(hearing(s.base, { region: 'eu-north-1/../x' }), noRegion.events);
        await waitFor('the refusal', () => noRegion.got.failures.length === 1);
        expect(noRegion.got.failures).toEqual([{ text: '', status: 400 }]);
        expect(s.seen.urls).toHaveLength(1);
        expect(transcribeLocale('en-GB')).toBe('en-GB');
        expect(transcribeLocale('ar-EG')).toBe('ar-SA');
        expect(transcribeLocale('pt')).toBe('pt-PT');
        expect(transcribeLocale(undefined)).toBe('en-US');
    });
});

/** A stand-in for Polly's /v1/speech, answering with `answer`. */
async function fakePolly(answer: (res: http.ServerResponse) => void) {
    const seen: { url?: string; headers: http.IncomingHttpHeaders; body?: Record<string, unknown> }[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
            answer(res);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Marhaba.',
    settings: { adapter: 'aws', model: 'neural', voiceId: 'Hala', key: new Secret(KEY), endpoint: base, region: 'eu-north-1', language: 'ar-AE', ...settings },
    signal: new AbortController().signal,
    ...changes,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

describe('speaking with Amazon Polly', () => {
    it('signs the request, asks for 16 kHz PCM with the engine and voice, and plays the audio at 24 kHz', async () => {
        const s = await fakePolly((res) => res.end(Buffer.from(new Int16Array(160).fill(1000).buffer)));
        const audio = await collect(new AwsPolly().speak(speaking(s.base)));
        // 160 samples at 16 kHz are about 240 at 24 kHz
        expect(audio.length).toBeGreaterThan(200);
        expect(s.seen[0].url).toBe('/v1/speech');
        expect(s.seen[0].body).toEqual({ Engine: 'neural', OutputFormat: 'pcm', SampleRate: '16000', Text: 'Marhaba.', TextType: 'text', VoiceId: 'Hala' });
        expect(s.seen[0].headers.authorization).toMatch(
            /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/eu-north-1\/polly\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
        );
        expect(JSON.stringify(s.seen[0])).not.toContain(SECRET);
    });

    it("uses the generative engine and Pipecat's voice when the bot names neither, and fails with Polly's status", async () => {
        const s = await fakePolly((res) => res.end());
        await collect(new AwsPolly().speak(speaking(s.base, {}, { model: '', voiceId: '' })));
        expect(s.seen[0].body).toMatchObject({ Engine: 'generative', VoiceId: 'Joanna' });

        const refused = await fakePolly((res) => {
            res.statusCode = 403;
            res.end('{"message":"The security token included in the request is invalid."}');
        });
        const error = await collect(new AwsPolly().speak(speaking(refused.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(403);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(SECRET);
    });
});

describe('AWS under one name with its talking model', () => {
    it('is registered as "aws" for hearing and speaking, leaving Nova Sonic to the one already there', async () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(AWS_VOICE_ADAPTER)).toBeInstanceOf(AwsTranscribe);
        expect(worker.connectors.speech(AWS_VOICE_ADAPTER)).toBeInstanceOf(AwsPolly);
        const said: string[] = [];
        const talking = {
            speak: async function* (request: SpeechRequest) {
                said.push(request.settings.model);
                yield new Int16Array([7]);
            },
        };
        const speech = new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('aws', talking) }).connectors.speech('aws')!;
        expect(await collect(speech.speak(speaking('http://127.0.0.1:9', {}, { model: 'amazon.nova-2-sonic-v1:0' })))).toEqual([7]);
        expect(said).toEqual(['amazon.nova-2-sonic-v1:0']);
    });
});
