// AWS's Nova Sonic (game #1910), a talking model: it hears and it speaks, and the bot's own Mind writes every answer. From
// AWS's Nova 2 Sonic docs (Nov 2026):
//
// - One Bedrock bidirectional stream per stretch of speech, and one per reply, in the key's own region. It is HTTP/2 with AWS's
//   event stream and Signature Version 4, so it goes through AWS's own SDK, not a socket. The key is kept as one, "ID:secret"
//   (Orbit), and is only ever handed to the SDK, which signs with it.
// - Every stream opens the same way: sessionStart, promptStart (the voice and the audio out), the system prompt as a text
//   block, then one audio block that stays open: Nova Sonic needs audio streamed all along, so quiet is sent when there is
//   nothing else.
// - Hearing: Nova Sonic has no way to only listen, and no way to end the person's turn: its own turn detection does, after a
//   short quiet. So the stream takes the person's audio, and once Nova Sonic writes down what it heard (role USER, FINAL)
//   the words are kept, the end of speech is said, and the stream is closed before the answer it starts is heard. After the
//   worker's own pause it is sent quiet until that happens.
// - Speaking: the Mind's words go in as the one text of a fresh stream, told to read them aloud exactly, in the picked voice.
//   Audio comes back at 24 kHz, the worker's own rate.
import { randomUUID } from 'node:crypto';
import { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand, type InvokeModelWithBidirectionalStreamInput } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { ProviderError, type RecognitionConnector, type RecognitionSettings, type SpeechConnector, type SpeechRequest, type SpeechSettings } from './connectors.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';
import { failure } from './kit/errors.ts';
import { PcmReader, pcmBytes } from './kit/pcm.ts';
import { LISTEN_ONLY, READ_ALOUD, TONE } from './openai.ts';

export const AWS_ADAPTER = 'aws';
const HEARING_RATE = 16_000;
const SPEAKING_RATE = 24_000;
/** Nova Sonic takes audio in pieces of about 32 ms. Quiet is sent in pieces this long. */
const QUIET_MS = 32;
const QUIET = new Int16Array((HEARING_RATE * QUIET_MS) / 1000);
/** Nova Sonic's turn detection on HIGH ends a turn after about 1.5 s of quiet: the worker's own pause waits a little longer. */
const PAUSE_MS = 2_000;
/** How long the last words may take after the worker's pause: Nova Sonic's own quiet, and some. */
const FINAL_TIMEOUT_MS = 6_000;
/** How long a reply may take to start. */
const FIRST_AUDIO_TIMEOUT_MS = 15_000;
/** Bedrock's own region names: letters and digits in dashed parts, so nothing else ends up in the address. */
const REGION = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;

/** One Nova Sonic stream: events in, events out. Bedrock's in the worker; a stand-in in tests. */
export interface SonicStream {
    send(event: Record<string, unknown>): void;
    /** Everything Nova Sonic sends, each `event` as an object, in order. Throws a ProviderError when the stream fails. */
    readonly events: AsyncIterable<Record<string, unknown>>;
    /** Ends the stream the way AWS asks (the open blocks, the prompt, the session), then lets it go. */
    end(): void;
    /** Drops the stream at once. */
    close(): void;
}

export type OpenSonic = (settings: RecognitionSettings | SpeechSettings) => SonicStream;

/** The two parts of a key kept as one, "ID:secret". Null when it is not that. */
export function awsKeyParts(key: string): { accessKeyId: string; secretAccessKey: string } | null {
    const split = key.indexOf(':');
    if (split <= 0 || split === key.length - 1) return null;
    return { accessKeyId: key.slice(0, split), secretAccessKey: key.slice(split + 1) };
}

/** The status of an AWS SDK failure: the HTTP status it came with, or the one its kind stands for. */
export function awsStatus(error: unknown): number | undefined {
    const value = error as { $metadata?: { httpStatusCode?: unknown }; name?: unknown } | null;
    const status = value?.$metadata?.httpStatusCode;
    if (typeof status === 'number' && status >= 400) return status;
    switch (value?.name) {
        case 'UnrecognizedClientException':
        case 'InvalidSignatureException':
        case 'AccessDeniedException':
            return 403;
        case 'ThrottlingException':
        case 'ServiceQuotaExceededException':
            return 429;
        case 'ValidationException':
            return 400;
        case 'ModelTimeoutException':
            return 408;
        case 'ServiceUnavailableException':
            return 503;
        case 'InternalServerException':
        case 'ModelStreamErrorException':
            return 500;
        default:
            return undefined;
    }
}

const SILENT = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

/** Events waiting to go out, read by the SDK as its request body. */
class Outbox implements AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
    private queue: Uint8Array[] = [];
    private wake?: () => void;
    private ended = false;
    private readonly encoder = new TextEncoder();

    push(event: Record<string, unknown>): void {
        if (this.ended) return;
        this.queue.push(this.encoder.encode(JSON.stringify({ event })));
        this.wake?.();
    }

    end(): void {
        this.ended = true;
        this.wake?.();
    }

    async *[Symbol.asyncIterator](): AsyncIterator<InvokeModelWithBidirectionalStreamInput> {
        for (;;) {
            const next = this.queue.shift();
            if (next) {
                yield { chunk: { bytes: next } };
                continue;
            }
            if (this.ended) return;
            await new Promise<void>((resolve) => (this.wake = resolve));
            this.wake = undefined;
        }
    }
}

/** A Nova Sonic stream on Bedrock, in the key's region. */
export const bedrockSonic: OpenSonic = (settings) => {
    const key = awsKeyParts(settings.key.reveal());
    if (!key) throw failure(AWS_ADAPTER, 'has a key that is not an access key ID and a secret', 401);
    const region = settings.region ?? '';
    if (!REGION.test(region)) throw failure(AWS_ADAPTER, 'has no region');
    const client = new BedrockRuntimeClient({
        region,
        credentials: key,
        // A test stand-in only: Orbit never sets one for AWS
        ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
        maxAttempts: 1,
        // The worker says what failed itself (failed, with the status); the SDK's own lines would only repeat it
        logger: SILENT,
        requestHandler: new NodeHttp2Handler({ requestTimeout: 300_000, sessionTimeout: 300_000, disableConcurrentStreams: false, maxConcurrentStreams: 20 }),
    });
    const outbox = new Outbox();
    const abort = new AbortController();
    const response = client.send(new InvokeModelWithBidirectionalStreamCommand({ modelId: settings.model, body: outbox }), { abortSignal: abort.signal });
    // Read below; until then a failure is kept for it, not left unhandled
    response.catch(() => undefined);
    const decoder = new TextDecoder();
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        outbox.end();
        abort.abort();
        client.destroy();
    };
    return {
        send: (event) => outbox.push(event),
        end: () => {
            outbox.end();
            // What is still on its way is not wanted: the stream goes once AWS has had a moment to take the ending
            setTimeout(close, 1_000).unref?.();
        },
        close,
        events: (async function* () {
            try {
                const answer = await response;
                for await (const part of answer.body ?? []) {
                    if (part.chunk?.bytes) {
                        const value: unknown = JSON.parse(decoder.decode(part.chunk.bytes));
                        const event = (value as { event?: unknown } | null)?.event;
                        if (typeof event === 'object' && event !== null) yield event as Record<string, unknown>;
                        continue;
                    }
                    // Any other member is one of the stream's own failures
                    const [name] = Object.entries(part).find(([, member]) => member !== undefined) ?? [''];
                    throw failure(AWS_ADAPTER, `answered with ${name || 'an error'}`, awsStatus({ name: capitalised(name) }));
                }
            } catch (error) {
                if (closed) return;
                throw error instanceof ProviderError ? error : failure(AWS_ADAPTER, 'stream failed', awsStatus(error));
            } finally {
                close();
            }
        })(),
    };
};

const capitalised = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** What one Nova Sonic event holds that the worker reads. */
export function readSonic(event: Record<string, unknown>) {
    const [kind, body] = Object.entries(event)[0] ?? ['', undefined];
    const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    let stage: unknown;
    try {
        stage = typeof fields.additionalModelFields === 'string' ? (JSON.parse(fields.additionalModelFields) as { generationStage?: unknown }).generationStage : undefined;
    } catch {
        stage = undefined;
    }
    return { kind, fields, stage };
}

/** The events every stream opens with: the session, the prompt with its voice, the system prompt, and the audio block. */
function opening(prompt: string, system: string, voiceId: string, audio: string): Record<string, unknown>[] {
    const system_ = randomUUID();
    return [
        { sessionStart: { inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.7 }, turnDetectionConfiguration: { endpointingSensitivity: 'HIGH' } } },
        {
            promptStart: {
                promptName: prompt,
                textOutputConfiguration: { mediaType: 'text/plain' },
                audioOutputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: SPEAKING_RATE, sampleSizeBits: 16, channelCount: 1, voiceId, encoding: 'base64', audioType: 'SPEECH' },
            },
        },
        { contentStart: { promptName: prompt, contentName: system_, type: 'TEXT', interactive: false, role: 'SYSTEM', textInputConfiguration: { mediaType: 'text/plain' } } },
        { textInput: { promptName: prompt, contentName: system_, content: system } },
        { contentEnd: { promptName: prompt, contentName: system_ } },
        {
            contentStart: {
                promptName: prompt,
                contentName: audio,
                type: 'AUDIO',
                interactive: true,
                role: 'USER',
                audioInputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: HEARING_RATE, sampleSizeBits: 16, channelCount: 1, audioType: 'SPEECH', encoding: 'base64' },
            },
        },
    ];
}

/** The events that end a stream: the open audio block, the prompt, the session. */
const closing = (prompt: string, audio: string): Record<string, unknown>[] => [
    { contentEnd: { promptName: prompt, contentName: audio } },
    { promptEnd: { promptName: prompt } },
    { sessionEnd: {} },
];

const audioEvent = (prompt: string, audio: string, pcm16k: Int16Array) => ({ audioInput: { promptName: prompt, contentName: audio, content: pcmBytes(pcm16k).toString('base64') } });

/** A voice no stream is opened without: Nova Sonic asks for one even to only listen. */
const LISTENING_VOICE = 'tiffany';

/** Hearing with Nova Sonic: one stream per stretch of speech, closed once it has written down what the person said. */
class SonicHearing implements Recognizer {
    readonly pauseMs = PAUSE_MS;
    private stream?: SonicStream;
    private readonly prompt = randomUUID();
    private readonly audio = randomUUID();
    private heardSoFar = '';
    private finishing = false;
    private done = false;
    /** Nova Sonic answered something, so the stream works. */
    private answered = false;
    private endpointed = false;
    /** Nova Sonic wrote down a whole turn, and nothing of a next one yet. */
    private turnHeard = false;
    private quiet?: NodeJS.Timeout;
    private timer?: NodeJS.Timeout;

    constructor(open: OpenSonic, settings: RecognitionSettings, private readonly events: RecognizerEvents) {
        try {
            this.stream = open(settings);
            for (const event of opening(this.prompt, LISTEN_ONLY, LISTENING_VOICE, this.audio)) this.stream.send(event);
        } catch (error) {
            this.fail(error instanceof ProviderError ? error : failure(AWS_ADAPTER, 'could not be reached'));
            return;
        }
        void this.read(this.stream);
    }

    push(pcm16k: Int16Array): void {
        if (this.done || this.finishing || pcm16k.length === 0) return;
        this.stream?.send(audioEvent(this.prompt, this.audio, pcm16k));
    }

    finish(): void {
        if (this.done || this.finishing) return;
        this.finishing = true;
        // Nova Sonic already ended the turn (and the worker paused after it): the words are all there
        if (this.turnHeard) return this.end();
        // Nova Sonic ends the turn itself, after a quiet: it is sent quiet, at the pace of speech, until it does
        this.quiet = setInterval(() => this.stream?.send(audioEvent(this.prompt, this.audio, QUIET)), QUIET_MS);
        this.quiet.unref?.();
        this.timer = setTimeout(() => {
            // A stream that answered and heard nothing more: the person said nothing it kept
            if (this.answered) this.end();
            else this.fail(failure(AWS_ADAPTER, 'took too long for the last words'));
        }, FINAL_TIMEOUT_MS);
        this.timer.unref?.();
    }

    close(): void {
        if (this.done) return;
        this.done = true;
        this.stop(false);
    }

    private async read(stream: SonicStream): Promise<void> {
        let role: unknown;
        let stage: unknown;
        try {
            for await (const event of stream.events) {
                if (this.done) return;
                this.answered = true;
                const read = readSonic(event);
                if (read.kind === 'contentStart') {
                    role = read.fields.role;
                    stage = read.stage;
                    if (role === 'USER') this.turnHeard = false;
                } else if (read.kind === 'textOutput' && role === 'USER' && stage !== 'SPECULATIVE') {
                    const text = typeof read.fields.content === 'string' ? read.fields.content.trim() : '';
                    if (text) {
                        this.heardSoFar = `${this.heardSoFar} ${text}`.trim();
                        this.events.partial(this.heardSoFar);
                    }
                } else if (read.kind === 'contentEnd' && role === 'USER') {
                    // What the person said is written down: Nova Sonic would answer now, so the stretch ends here
                    this.turnHeard = true;
                    if (this.finishing) return this.end();
                    if (!this.endpointed && this.heardSoFar) {
                        this.endpointed = true;
                        this.events.endpoint?.();
                    }
                }
                // Anything else is its own answer, which is never played
            }
            if (!this.done) this.fail(failure(AWS_ADAPTER, 'closed the stream before the last words'));
        } catch (error) {
            this.fail(error instanceof ProviderError ? error : failure(AWS_ADAPTER, 'sent an answer that could not be read'));
        }
    }

    private end(): void {
        if (this.done) return;
        this.done = true;
        this.stop(true);
        this.events.final(this.heardSoFar);
    }

    private fail(error: ProviderError): void {
        if (this.done) return;
        this.done = true;
        this.stop(false);
        this.events.failed(this.heardSoFar, error.status === undefined ? undefined : { status: error.status });
    }

    private stop(graceful: boolean): void {
        clearInterval(this.quiet);
        clearTimeout(this.timer);
        const stream = this.stream;
        if (!stream) return;
        if (graceful) {
            for (const event of closing(this.prompt, this.audio)) stream.send(event);
            stream.end();
        } else {
            stream.close();
        }
    }
}

export class AwsRecognition implements RecognitionConnector {
    constructor(private readonly open: OpenSonic = bedrockSonic) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return new SonicHearing(this.open, settings, events);
    }
}

/** Speaking with Nova Sonic: one stream per reply, the Mind's words its one text, read aloud in the picked voice. */
export class AwsSpeech implements SpeechConnector {
    constructor(private readonly open: OpenSonic = bedrockSonic) {}

    async *speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        if (request.signal.aborted) return;
        const prompt = randomUUID();
        const audio = randomUUID();
        const text = randomUUID();
        let stream: SonicStream;
        try {
            stream = this.open(request.settings);
        } catch (error) {
            throw error instanceof ProviderError ? error : failure(AWS_ADAPTER, 'could not be reached');
        }
        const stop = () => stream.close();
        request.signal.addEventListener('abort', stop, { once: true });
        let quiet: NodeJS.Timeout | undefined;
        let started = false;
        const slow = setTimeout(() => {
            if (!started) stream.close();
        }, FIRST_AUDIO_TIMEOUT_MS);
        slow.unref?.();
        let finished = false;
        try {
            for (const event of opening(prompt, `${READ_ALOUD} ${TONE[request.expression ?? 'natural']}`, request.settings.voiceId, audio)) stream.send(event);
            stream.send({ contentStart: { promptName: prompt, contentName: text, type: 'TEXT', interactive: true, role: 'USER', textInputConfiguration: { mediaType: 'text/plain' } } });
            stream.send({ textInput: { promptName: prompt, contentName: text, content: request.text } });
            stream.send({ contentEnd: { promptName: prompt, contentName: text } });
            // Nova Sonic needs audio all along, even while it speaks: quiet, at the pace of speech
            quiet = setInterval(() => stream.send(audioEvent(prompt, audio, QUIET)), QUIET_MS);
            quiet.unref?.();
            const reader = new PcmReader();
            let role: unknown;
            let type: unknown;
            for await (const event of stream.events) {
                const read = readSonic(event);
                if (read.kind === 'contentStart') {
                    role = read.fields.role;
                    type = read.fields.type;
                } else if (read.kind === 'audioOutput' && role === 'ASSISTANT') {
                    const content = typeof read.fields.content === 'string' ? read.fields.content : '';
                    const samples = content ? reader.take(Buffer.from(content, 'base64')) : undefined;
                    if (samples) {
                        started = true;
                        yield samples;
                    }
                } else if ((read.kind === 'contentEnd' && role === 'ASSISTANT' && type === 'AUDIO' && read.fields.stopReason !== 'PARTIAL_TURN') || read.kind === 'completionEnd') {
                    finished = true;
                    break;
                }
            }
            if (request.signal.aborted) return;
            if (!finished && !started) throw failure(AWS_ADAPTER, 'closed the stream without speaking');
            if (!finished) throw failure(AWS_ADAPTER, 'closed the stream before the end of the reply');
        } catch (error) {
            if (request.signal.aborted) return;
            throw error instanceof ProviderError ? error : failure(AWS_ADAPTER, 'sent an answer that could not be read');
        } finally {
            clearInterval(quiet);
            clearTimeout(slow);
            request.signal.removeEventListener('abort', stop);
            if (finished) {
                for (const event of closing(prompt, audio)) stream.send(event);
                stream.end();
            } else {
                stream.close();
            }
        }
    }
}
