// Hearing and speaking with NVIDIA (#1899), against a stand-in Riva gRPC server on loopback (HTTP/2 without TLS): no key, no
// network, no spend. The stand-in reads and writes the same protobuf fields the connector does.
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { GrpcFrames, grpcFrame, pb, pbBytes, pbRead, pbUint } from '../src/kit/grpc.ts';
import { NVIDIA_ADAPTER, NVIDIA_FUNCTIONS, NvidiaRecognition, NvidiaSpeech, nvidiaHearing, nvidiaVoice } from '../src/nvidia.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'nvapi-key-1899';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

interface Call {
    path: string;
    auth?: string;
    functionId?: string;
    messages: Buffer[];
    ended: boolean;
    stream: http2.ServerHttp2Stream;
}

/** A stand-in gRPC server: `onCall` runs when a call opens, `onMessage` for each message, `onEnd` when the client ends its side. */
async function fakeRiva(handlers: { onCall?: (call: Call) => void; onMessage?: (call: Call, message: Buffer) => void; onEnd?: (call: Call) => void }) {
    const server = http2.createServer();
    const calls: Call[] = [];
    server.on('stream', (stream, headers) => {
        const call: Call = {
            path: String(headers[':path']),
            auth: headers.authorization as string | undefined,
            functionId: headers['function-id'] as string | undefined,
            messages: [],
            ended: false,
            stream,
        };
        calls.push(call);
        const frames = new GrpcFrames();
        stream.on('data', (chunk: Buffer) => {
            for (const message of frames.take(chunk)) {
                call.messages.push(message);
                handlers.onMessage?.(call, message);
            }
        });
        stream.on('end', () => {
            call.ended = true;
            handlers.onEnd?.(call);
        });
        stream.on('error', () => undefined);
        handlers.onCall?.(call);
    });
    const sessions = new Set<http2.ServerHttp2Session>();
    server.on('session', (session) => sessions.add(session));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(
        () =>
            new Promise<void>((resolve) => {
                for (const session of sessions) session.destroy();
                server.close(() => resolve());
            }),
    );
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls };
}

const respond = (call: Call) => {
    if (!call.stream.headersSent) call.stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true });
};
const sendMessage = (call: Call, message: Buffer) => {
    respond(call);
    call.stream.write(grpcFrame(message));
};
const endCall = (call: Call, status = 0, message = '') => {
    respond(call);
    call.stream.once('wantTrailers', () => call.stream.sendTrailers({ 'grpc-status': String(status), ...(message ? { 'grpc-message': message } : {}) }));
    call.stream.end();
};

/** A StreamingRecognizeResponse with one result. */
const result = (transcript: string, isFinal: boolean) => pb.message(1, pb.message(1, pb.bytes(1, transcript)), pb.uint(2, isFinal));

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
    adapter: 'nvidia',
    model: 'nemotron-asr-streaming',
    key: new Secret(KEY),
    endpoint,
    language: 'ar-KW',
    ...changes,
});

describe('hearing with NVIDIA', () => {
    it('sets up the stream, sends audio, and ends with the words NVIDIA sends once this side ends', async () => {
        const riva = await fakeRiva({
            onEnd: (call) => {
                sendMessage(call, result('kaif halak?', true));
                endCall(call);
            },
        });
        const { got, events } = heard();
        const stream = new NvidiaRecognition().listen(hearing(riva.base), events);
        stream.push(new Int16Array([1, -2]));
        await waitFor('the audio', () => riva.calls[0]?.messages.length === 2);
        const call = riva.calls[0];
        sendMessage(call, result('Marha', false));
        sendMessage(call, Buffer.concat([result('Marhaba,', true), result('kai', false)]));
        await waitFor('the words so far', () => got.partials.length === 3);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Marha', 'Marhaba,', 'Marhaba, kai', 'Marhaba, kaif halak?']);
        expect(got.finals).toEqual(['Marhaba, kaif halak?']);
        expect(call).toMatchObject({
            path: '/nvidia.riva.asr.RivaSpeechRecognition/StreamingRecognize',
            auth: `Bearer ${KEY}`,
            functionId: NVIDIA_FUNCTIONS['nemotron-asr-streaming'],
        });

        // The setup: LINEAR_PCM, 16 kHz, Arabic, one alternative, one channel, punctuation, 320 ms endpointing, interim words
        const streaming = pbRead(pbBytes(pbRead(call.messages[0]), 1)[0]);
        const config = pbRead(pbBytes(streaming, 1)[0]);
        expect([pbUint(config, 1), pbUint(config, 2), pbBytes(config, 3)[0].toString(), pbUint(config, 4), pbUint(config, 7), pbUint(config, 11)]).toEqual([
            1,
            16000,
            'ar-AR',
            1,
            1,
            1,
        ]);
        expect(pbUint(pbRead(pbBytes(config, 25)[0]), 3)).toBe(320);
        expect(pbUint(streaming, 2)).toBe(1);
        // The audio, as s16 bytes
        expect([...new Int16Array(Uint8Array.from(pbBytes(pbRead(call.messages[1]), 2)[0]).buffer)]).toEqual([1, -2]);
    });

    it('fails with the status a refused call carries', async () => {
        const riva = await fakeRiva({ onCall: (call) => endCall(call, 16, 'Unauthenticated') });
        const { got, events } = heard();
        new NvidiaRecognition().listen(hearing(riva.base), events);
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });

    it('reads its locales, and US English for a language it does not hear', () => {
        expect(nvidiaHearing('en-GB')).toBe('en-GB');
        expect(nvidiaHearing('es-us')).toBe('es-US');
        expect(nvidiaHearing('pt-PT')).toBe('pt-BR');
        expect(nvidiaHearing('sw')).toBe('en-US');
        expect(nvidiaHearing(undefined)).toBe('en-US');
    });
});

const speaking = (base: string, changes: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Marhaba.',
    settings: {
        adapter: 'nvidia',
        model: 'magpie-tts-multilingual',
        voiceId: 'Magpie-Multilingual.AR-AR.Sofia',
        key: new Secret(KEY),
        endpoint: base,
        language: 'en-US',
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

const audio = (...values: number[]) => pb.bytes(1, new Uint8Array(new Int16Array(values).buffer));

describe('speaking with NVIDIA', () => {
    it("sends the text in the voice's own locale at 24 kHz, and plays the audio until the call ends", async () => {
        const riva = await fakeRiva({
            onEnd: (call) => {
                sendMessage(call, audio(1, 2));
                sendMessage(call, audio(-3));
                endCall(call);
            },
        });
        expect(await collect(new NvidiaSpeech().speak(speaking(riva.base)))).toEqual([1, 2, -3]);
        const call = riva.calls[0];
        expect(call).toMatchObject({
            path: '/nvidia.riva.tts.RivaSpeechSynthesis/SynthesizeOnline',
            auth: `Bearer ${KEY}`,
            functionId: NVIDIA_FUNCTIONS['magpie-tts-multilingual'],
        });
        const request = pbRead(call.messages[0]);
        expect([
            pbBytes(request, 1)[0].toString(),
            pbBytes(request, 2)[0].toString(),
            pbUint(request, 3),
            pbUint(request, 4),
            pbBytes(request, 5)[0].toString(),
        ]).toEqual(['Marhaba.', 'ar-AR', 1, 24000, 'Magpie-Multilingual.AR-AR.Sofia']);
    });

    it('picks a voice for the language when the bot picked none', () => {
        expect(nvidiaVoice('', 'fr-FR')).toEqual({ voice: 'Magpie-Multilingual.FR-FR.Pascal', locale: 'fr-FR' });
        expect(nvidiaVoice('', 'sw')).toEqual({ voice: 'Magpie-Multilingual.EN-US.Aria', locale: 'en-US' });
        expect(nvidiaVoice('my-own-voice', 'de')).toEqual({ voice: 'my-own-voice', locale: 'de-DE' });
    });

    it("fails with NVIDIA's status, the key in no failure", async () => {
        const riva = await fakeRiva({ onCall: (call) => endCall(call, 7, 'Forbidden') });
        const failure = await collect(new NvidiaSpeech().speak(speaking(riva.base))).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(403);
        expect(`${(failure as Error).message} ${JSON.stringify(failure)}`).not.toContain(KEY);
    });

    it('fails, without taking the worker down, when NVIDIA sends a message it cannot read', async () => {
        // Field 1 says 127 bytes follow, and none do
        const riva = await fakeRiva({ onEnd: (call) => sendMessage(call, Buffer.from([0x0a, 0x7f])) });
        const failure = await collect(new NvidiaSpeech().speak(speaking(riva.base))).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ProviderError);
    });

    it('stops when the reply is no longer wanted', async () => {
        const riva = await fakeRiva({ onEnd: (call) => sendMessage(call, audio(5)) });
        const controller = new AbortController();
        const stream = new NvidiaSpeech().speak(speaking(riva.base, { signal: controller.signal }));
        const first = await stream.next();
        expect([...(first.value as Int16Array)]).toEqual([5]);
        controller.abort();
        expect((await stream.next()).done).toBe(true);
    });

    it('is registered as "nvidia" for hearing and speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        const worker = new VoiceWorker(base);
        expect(worker.connectors.recognition(NVIDIA_ADAPTER)).toBeInstanceOf(NvidiaRecognition);
        expect(worker.connectors.speech(NVIDIA_ADAPTER)).toBeInstanceOf(NvidiaSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('nvidia', own) }).connectors.speech('nvidia')).toBe(own);
    });
});

describe('protobuf and gRPC helpers', () => {
    it('write and read whole numbers past one byte, and split messages however they arrive', () => {
        const fields = pbRead(Buffer.concat([pb.uint(1, 300), pb.uint(2, 0), pb.bytes(3, 'hi'), pb.uint(4, 2 ** 33)]));
        expect([pbUint(fields, 1), pbUint(fields, 2), pbBytes(fields, 3)[0].toString(), pbUint(fields, 4)]).toEqual([300, 0, 'hi', 2 ** 33]);
        const wire = Buffer.concat([grpcFrame(Buffer.from('ab')), grpcFrame(Buffer.from('cde'))]);
        const frames = new GrpcFrames();
        expect([...frames.take(wire.subarray(0, 4)), ...frames.take(wire.subarray(4, 9)), ...frames.take(wire.subarray(9))].map(String)).toEqual(['ab', 'cde']);
        expect(() => pbRead(Buffer.from([0x0a, 0x05, 0x01]))).toThrow();
    });
});
