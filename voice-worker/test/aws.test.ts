// Talking with AWS's Nova Sonic (game #1910). The connectors run against a stand-in stream, and Bedrock's own stream against a
// stand-in HTTP/2 server on loopback: no key, no network, no spend. The model hears and speaks; the bot's own Mind writes
// every answer.
import http2 from 'node:http2';
import { crc32 } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { LISTEN_ONLY, READ_ALOUD } from '../src/openai.ts';
import { AWS_ADAPTER, AwsRecognition, AwsSpeech, awsKeyParts, awsStatus, bedrockSonic, type OpenSonic } from '../src/aws.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const MODEL = 'amazon.nova-2-sonic-v1:0';

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
    vi.useRealTimers();
    while (closers.length) await closers.pop()!();
});

/** A stand-in Nova Sonic stream. `onSend` answers what is sent; `emit` and `fail` play Nova Sonic's side. */
function sonic(onSend?: (event: Record<string, unknown>, emit: (event: Record<string, unknown>) => void) => void) {
    const state = { sent: [] as Record<string, unknown>[], ended: 0, closed: 0, opened: 0 };
    let queue: Record<string, unknown>[] = [];
    let wake: (() => void) | undefined;
    let over = false;
    let error: unknown;
    const emit = (event: Record<string, unknown>) => {
        queue.push(event);
        wake?.();
    };
    const finish = (failure?: unknown) => {
        over = true;
        error = failure;
        wake?.();
    };
    const open: OpenSonic = () => {
        state.opened++;
        queue = [];
        over = false;
        error = undefined;
        return {
            send: (event) => {
                state.sent.push(event);
                onSend?.(event, emit);
            },
            end: () => {
                state.ended++;
                finish();
            },
            close: () => {
                state.closed++;
                finish();
            },
            events: (async function* () {
                for (;;) {
                    const next = queue.shift();
                    if (next) {
                        yield next;
                        continue;
                    }
                    if (error) throw error;
                    if (over) return;
                    await new Promise<void>((resolve) => (wake = resolve));
                    wake = undefined;
                }
            })(),
        };
    };
    const kinds = () => state.sent.map((event) => Object.keys(event)[0]);
    return { state, open, emit, fail: (failure: unknown) => finish(failure), kinds };
}

/** What Nova Sonic sends when it has written down what the person said. */
const userSaid = (text: string) => [
    { contentStart: { role: 'USER', type: 'TEXT', additionalModelFields: '{"generationStage":"FINAL"}' } },
    { textOutput: { content: text } },
    { contentEnd: { type: 'TEXT', stopReason: 'END_TURN' } },
];

/** What Nova Sonic sends when it answers aloud: its plan as text, then audio, then the end of its turn. */
const assistantSays = (samples: number[], stopReason = 'END_TURN') => [
    { contentStart: { role: 'ASSISTANT', type: 'TEXT', additionalModelFields: '{"generationStage":"SPECULATIVE"}' } },
    { textOutput: { content: 'Sure, here it is.' } },
    { contentEnd: { type: 'TEXT', stopReason: 'PARTIAL_TURN' } },
    { contentStart: { role: 'ASSISTANT', type: 'AUDIO' } },
    { audioOutput: { content: Buffer.from(Int16Array.from(samples).buffer).toString('base64') } },
    { contentEnd: { type: 'AUDIO', stopReason } },
];

function listener() {
    const heard = { partials: [] as string[], finals: [] as string[], failed: [] as { text: string; status?: number }[], endpoints: 0 };
    const events: RecognizerEvents = {
        partial: (text) => heard.partials.push(text),
        final: (text) => heard.finals.push(text),
        failed: (text, failure) => heard.failed.push({ text, status: failure?.status }),
        endpoint: () => heard.endpoints++,
    };
    return { heard, events };
}

const settings = () => ({ adapter: AWS_ADAPTER, model: MODEL, key: new Secret(KEY), region: 'eu-north-1', language: 'en-US' });

function speechRequest(extra: Partial<SpeechRequest> = {}): SpeechRequest {
    return {
        text: 'Welcome to the counter. What can I get you?',
        settings: { ...settings(), voiceId: 'matthew' },
        expression: 'restrained',
        signal: new AbortController().signal,
        ...extra,
    };
}

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const samples: number[] = [];
    for await (const chunk of stream) samples.push(...chunk);
    return samples;
}

describe('the key and its failures', () => {
    it('splits a key kept as "ID:secret", and nothing else', () => {
        expect(awsKeyParts(KEY)).toEqual({ accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
        for (const wrong of ['', 'no-colon', ':secret', 'AKIAIOSFODNN7EXAMPLE:']) expect(awsKeyParts(wrong)).toBeNull();
    });

    it('reads a status from an AWS failure: its own, or the one its kind stands for', () => {
        expect(awsStatus({ $metadata: { httpStatusCode: 403 } })).toBe(403);
        expect(awsStatus({ name: 'UnrecognizedClientException' })).toBe(403);
        expect(awsStatus({ name: 'AccessDeniedException' })).toBe(403);
        expect(awsStatus({ name: 'ThrottlingException' })).toBe(429);
        expect(awsStatus({ name: 'ModelTimeoutException' })).toBe(408);
        expect(awsStatus({ name: 'ServiceUnavailableException' })).toBe(503);
        expect(awsStatus(new Error('socket hang up'))).toBeUndefined();
    });
});

describe('Bedrock’s stream', () => {
    /** A stand-in Bedrock on loopback (HTTP/2 without TLS) that refuses every stream as AWS refuses a wrong key. */
    async function bedrock() {
        const seen: http2.IncomingHttpHeaders[] = [];
        const server = http2.createServer();
        server.on('stream', (stream, headers) => {
            seen.push(headers);
            stream.respond({ ':status': 403, 'content-type': 'application/json', 'x-amzn-errortype': 'UnrecognizedClientException' });
            stream.end(JSON.stringify({ message: 'The security token included in the request is invalid.' }));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
        return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
    }

    it('signs the stream with the key for the key’s region, never sending the secret, and reads a refusal as 403', async () => {
        const server = await bedrock();
        const stream = bedrockSonic({ ...settings(), endpoint: server.url });
        stream.send({ sessionStart: {} });
        const failure = await (async () => {
            try {
                for await (const event of stream.events) void event;
            } catch (error) {
                return error;
            }
        })();
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(403);
        expect(String((failure as Error).message)).not.toContain('wJalrXUtnFEMI');
        const [headers] = server.seen;
        expect(headers[':path']).toBe(`/model/${encodeURIComponent(MODEL)}/invoke-with-bidirectional-stream`);
        expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/eu-north-1\/bedrock\/aws4_request, /);
        expect(JSON.stringify(headers)).not.toContain('wJalrXUtnFEMI');
    });

    it('opens no stream for a key that is not "ID:secret" (a refused key) or with no region', () => {
        expect(() => bedrockSonic({ ...settings(), key: new Secret('just-a-secret') })).toThrow(expect.objectContaining({ status: 401 }));
        expect(() => bedrockSonic({ ...settings(), region: undefined })).toThrow(ProviderError);
        expect(() => bedrockSonic({ ...settings(), region: 'eu-north-1.evil.com' })).toThrow(ProviderError);
    });

    /** One AWS event-stream message: the prelude, string headers, the payload and the checksums. */
    function eventMessage(headers: Record<string, string>, payload: Buffer): Buffer {
        const head = Buffer.concat(
            Object.entries(headers).map(([name, value]) => {
                const length = Buffer.alloc(2);
                length.writeUInt16BE(Buffer.byteLength(value));
                return Buffer.concat([Buffer.from([name.length]), Buffer.from(name), Buffer.from([7]), length, Buffer.from(value)]);
            })
        );
        const prelude = Buffer.alloc(8);
        prelude.writeUInt32BE(16 + head.length + payload.length, 0);
        prelude.writeUInt32BE(head.length, 4);
        const preludeCrc = Buffer.alloc(4);
        preludeCrc.writeUInt32BE(crc32(prelude));
        const body = Buffer.concat([prelude, preludeCrc, head, payload]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([body, crc]);
    }

    /** The Nova Sonic events in what the SDK sent: each signed message holds the event's own message as its payload. */
    function sentEvents(data: Buffer): string[] {
        const kinds: string[] = [];
        const read = (buffer: Buffer) => {
            for (let at = 0; at + 12 <= buffer.length; ) {
                const total = buffer.readUInt32BE(at);
                const headLength = buffer.readUInt32BE(at + 4);
                const payload = buffer.subarray(at + 12 + headLength, at + total - 4);
                const head = buffer.subarray(at + 12, at + 12 + headLength).toString('latin1');
                if (head.includes(':chunk-signature')) read(payload);
                else if (payload.length) {
                    const { bytes } = JSON.parse(payload.toString()) as { bytes?: string };
                    const { event } = JSON.parse(Buffer.from(bytes ?? '', 'base64').toString()) as { event: Record<string, unknown> };
                    kinds.push(Object.keys(event)[0]);
                }
                at += total;
            }
        };
        read(data);
        return kinds;
    }

    it('lets the closing events reach AWS when the reader stops early, as speaking does at the end of a reply', async () => {
        const received: Buffer[] = [];
        let cut = false;
        const server = http2.createServer();
        server.on('stream', (stream) => {
            stream.on('data', (chunk: Buffer) => received.push(chunk));
            stream.on('aborted', () => (cut = true));
            stream.on('close', () => (cut ||= stream.rstCode !== http2.constants.NGHTTP2_NO_ERROR));
            stream.respond({ ':status': 200, 'content-type': 'application/vnd.amazon.eventstream' });
            const event = { event: { contentEnd: { role: 'ASSISTANT', type: 'AUDIO', stopReason: 'END_TURN' } } };
            const payload = Buffer.from(JSON.stringify({ bytes: Buffer.from(JSON.stringify(event)).toString('base64') }));
            stream.write(eventMessage({ ':message-type': 'event', ':event-type': 'chunk', ':content-type': 'application/json' }, payload));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
        const stream = bedrockSonic({ ...settings(), endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
        stream.send({ sessionStart: {} });
        for await (const event of stream.events) {
            expect(Object.keys(event)).toEqual(['contentEnd']);
            break;
        }
        // As AwsSpeech does once the reply is whole: the closing events, then the end
        for (const kind of ['contentEnd', 'promptEnd', 'sessionEnd']) stream.send({ [kind]: {} });
        stream.end();
        await waitFor('the closing events at AWS', () => sentEvents(Buffer.concat(received)).includes('sessionEnd'));
        expect(sentEvents(Buffer.concat(received))).toEqual(['sessionStart', 'contentEnd', 'promptEnd', 'sessionEnd']);
        expect(cut).toBe(false);
    });
});

describe('hearing with Nova Sonic', () => {
    it('opens with the session, a voice it never plays, the listen-only prompt and one open audio block, then sends the audio', async () => {
        const fake = sonic();
        const { events } = listener();
        const recognizer = new AwsRecognition(fake.open).listen(settings(), events);
        recognizer.push(Int16Array.from([1, -2, 3]));
        expect(fake.kinds()).toEqual(['sessionStart', 'promptStart', 'contentStart', 'textInput', 'contentEnd', 'contentStart', 'audioInput']);
        const [session, prompt, system, systemText, , audio, piece] = fake.state.sent as Record<string, Record<string, unknown>>[];
        expect(session.sessionStart.turnDetectionConfiguration).toEqual({ endpointingSensitivity: 'HIGH' });
        expect((prompt.promptStart.audioOutputConfiguration as Record<string, unknown>).voiceId).toBe('tiffany');
        expect(system.contentStart).toMatchObject({ role: 'SYSTEM', type: 'TEXT', interactive: false });
        expect(systemText.textInput.content).toBe(LISTEN_ONLY);
        expect(audio.contentStart).toMatchObject({ role: 'USER', type: 'AUDIO', interactive: true, audioInputConfiguration: { sampleRateHertz: 16_000, encoding: 'base64' } });
        expect(Buffer.from(piece.audioInput.content as string, 'base64')).toEqual(Buffer.from(Int16Array.from([1, -2, 3]).buffer));
        // Every event names the same prompt
        expect(new Set(fake.state.sent.slice(1).map((event) => (Object.values(event)[0] as { promptName?: string }).promptName)).size).toBe(1);
        recognizer.close();
    });

    it('keeps what Nova Sonic wrote down, says the person finished, and closes before its answer is heard', async () => {
        const fake = sonic();
        const { heard, events } = listener();
        const recognizer = new AwsRecognition(fake.open).listen(settings(), events);
        recognizer.push(new Int16Array(320));
        for (const event of userSaid('I would like a latte')) fake.emit(event);
        await waitFor('the end of speech', () => heard.endpoints === 1);
        expect(heard.partials).toEqual(['I would like a latte']);
        // Its answer starts: nothing of it is heard
        for (const event of assistantSays([5, 6])) fake.emit(event);
        recognizer.finish();
        expect(heard.finals).toEqual(['I would like a latte']);
        expect(heard.failed).toEqual([]);
        // Closed the way AWS asks
        expect(fake.kinds().slice(-3)).toEqual(['contentEnd', 'promptEnd', 'sessionEnd']);
        expect(fake.state.ended).toBe(1);
    });

    it('sends quiet after the worker’s pause until Nova Sonic ends the turn itself, then gives the words', async () => {
        const fake = sonic();
        const { heard, events } = listener();
        const recognizer = new AwsRecognition(fake.open).listen(settings(), events);
        recognizer.push(new Int16Array(320));
        recognizer.finish();
        const before = fake.state.sent.length;
        await waitFor('quiet sent', () => fake.state.sent.length >= before + 3);
        const quiet = fake.state.sent.slice(before) as Record<string, Record<string, unknown>>[];
        for (const event of quiet) expect(Buffer.from(event.audioInput.content as string, 'base64').every((byte) => byte === 0)).toBe(true);
        for (const event of userSaid('Two please')) fake.emit(event);
        await waitFor('the last words', () => heard.finals.length === 1);
        expect(heard.finals).toEqual(['Two please']);
        expect(heard.endpoints).toBe(0);
    });

    it('ends with nothing heard when the person said nothing it kept', async () => {
        vi.useFakeTimers();
        const fake = sonic();
        const { heard, events } = listener();
        const recognizer = new AwsRecognition(fake.open).listen(settings(), events);
        fake.emit({ completionStart: {} });
        await vi.advanceTimersByTimeAsync(0);
        recognizer.finish();
        await vi.advanceTimersByTimeAsync(6_000);
        expect(heard.finals).toEqual(['']);
        expect(heard.failed).toEqual([]);
    });

    it('fails when Nova Sonic never answers at all', async () => {
        vi.useFakeTimers();
        const fake = sonic();
        const { heard, events } = listener();
        new AwsRecognition(fake.open).listen(settings(), events).finish();
        await vi.advanceTimersByTimeAsync(6_000);
        expect(heard.failed).toEqual([{ text: '', status: undefined }]);
    });

    it('says why the stream failed, with what was heard', async () => {
        const fake = sonic();
        const { heard, events } = listener();
        new AwsRecognition(fake.open).listen(settings(), events);
        for (const event of userSaid('Hello')) fake.emit(event);
        fake.fail(new ProviderError('aws answered with throttlingException', 429));
        await waitFor('the failure', () => heard.failed.length === 1);
        expect(heard.failed).toEqual([{ text: 'Hello', status: 429 }]);
    });

    it('fails a key AWS can’t take as a refused key, without opening anything', async () => {
        const { heard, events } = listener();
        const hearing = new AwsRecognition().listen({ ...settings(), key: new Secret('only-the-secret') }, events);
        // Said once the caller holds the hearing, not while it is being made
        expect(hearing).toBeDefined();
        expect(heard.failed).toEqual([]);
        await Promise.resolve();
        expect(heard.failed).toEqual([{ text: '', status: 401 }]);
    });
});

describe('speaking with Nova Sonic', () => {
    it('reads the Mind’s words aloud in the picked voice, as its one text, and closes once its turn ends', async () => {
        const fake = sonic((event, emit) => {
            if ('textInput' in event && (event.textInput as { content: string }).content.startsWith('Welcome')) {
                for (const answer of [{ completionStart: {} }, ...assistantSays([1, 2], 'PARTIAL_TURN').slice(3), ...assistantSays([3, 4]).slice(3)]) emit(answer);
            }
        });
        const samples = await collect(new AwsSpeech(fake.open).speak(speechRequest()));
        expect(samples).toEqual([1, 2, 3, 4]);
        const sent = fake.state.sent as Record<string, Record<string, unknown>>[];
        expect((sent[1].promptStart.audioOutputConfiguration as Record<string, unknown>)).toMatchObject({ voiceId: 'matthew', sampleRateHertz: 24_000 });
        expect(sent[3].textInput.content).toBe(`${READ_ALOUD} Read it in a calm, even voice.`);
        expect(sent[6].contentStart).toMatchObject({ role: 'USER', type: 'TEXT', interactive: true });
        expect(sent[7].textInput.content).toBe('Welcome to the counter. What can I get you?');
        expect(fake.kinds().slice(-3)).toEqual(['contentEnd', 'promptEnd', 'sessionEnd']);
        expect(fake.state.ended).toBe(1);
    });

    it('streams quiet while it speaks, as Nova Sonic asks', async () => {
        const fake = sonic();
        const request = speechRequest({ signal: AbortSignal.timeout(200) });
        await collect(new AwsSpeech(fake.open).speak(request));
        const quiet = fake.state.sent.slice(9).filter((event) => 'audioInput' in event);
        expect(quiet.length).toBeGreaterThan(2);
    });

    it('stops at once when the reply is no longer wanted', async () => {
        const controller = new AbortController();
        const fake = sonic((event, emit) => {
            if ('textInput' in event && (event.textInput as { content: string }).content.startsWith('Welcome')) for (const answer of assistantSays([1, 2]).slice(3, 5)) emit(answer);
        });
        const samples: number[] = [];
        for await (const chunk of new AwsSpeech(fake.open).speak(speechRequest({ signal: controller.signal }))) {
            samples.push(...chunk);
            controller.abort();
        }
        expect(samples).toEqual([1, 2]);
        // Dropped, not ended: nothing more is wanted from it
        expect(fake.state.closed).toBeGreaterThan(0);
        expect(fake.state.ended).toBe(0);
    });

    it('fails with Nova Sonic’s status, and when it closes without speaking', async () => {
        const failing = sonic((event) => {
            if ('textInput' in event) queueMicrotask(() => failing.fail(new ProviderError('aws answered with throttlingException', 429)));
        });
        await expect(collect(new AwsSpeech(failing.open).speak(speechRequest()))).rejects.toMatchObject({ status: 429 });
        const silent = sonic((event) => {
            if ('contentEnd' in event && silent.state.sent.length === 9) queueMicrotask(() => silent.fail(undefined));
        });
        await expect(collect(new AwsSpeech(silent.open).speak(speechRequest()))).rejects.toBeInstanceOf(ProviderError);
    });
});

describe('the worker', () => {
    it('hears and speaks with AWS under "aws"', () => {
        const worker = new VoiceWorker({ connectors: new ConnectorRegistry() } as ConstructorParameters<typeof VoiceWorker>[0]);
        expect(worker.connectors.recognition(AWS_ADAPTER)).toBeInstanceOf(AwsRecognition);
        expect(worker.connectors.speech(AWS_ADAPTER)).toBeInstanceOf(AwsSpeech);
    });
});
