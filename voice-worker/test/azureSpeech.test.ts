// Hearing and speaking with Azure AI Speech (#1875), against stand-in Speech services on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import {
    AZURE_SPEECH_ADAPTER,
    AzureSpeechRecognition,
    AzureTts,
    audioMessage,
    azureLocale,
    azureSsml,
    readMessage,
    textMessage,
    wavHeader,
} from '../src/azureSpeech.ts';
import { ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'azure-speech-key-1875';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** One audio message as Azure reads it: its headers and its audio. */
function readAudio(data: Buffer): { headers: string; audio: Buffer } {
    const length = data.readUInt16BE(0);
    return { headers: data.subarray(2, 2 + length).toString('ascii'), audio: data.subarray(2 + length) };
}

/** Azure's answer: headers, a blank line, a JSON body. */
const answer = (path: string, body: object) =>
    `X-RequestId: r\r\nContent-Type: application/json; charset=utf-8\r\nPath: ${path}\r\n\r\n${JSON.stringify(body)}`;

/** A stand-in for the Speech service's socket. `onAudio` is told of each audio message, `end` when the audio ends. */
async function fakeAzure(onAudio: (ws: WebSocket, audio: Buffer, end: boolean) => void) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = {
        sockets: [] as { url: string; key?: string; connectionId?: string }[],
        texts: [] as string[],
        audio: [] as { headers: string; audio: Buffer }[],
    };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        const key = req.headers['ocp-apim-subscription-key'] as string | undefined;
        seen.sockets.push({ url: req.url ?? '', key, connectionId: req.headers['x-connectionid'] as string | undefined });
        if (key !== KEY) {
            socket.end('HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n');
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data, isBinary) => {
                if (!isBinary) return void seen.texts.push(data.toString());
                const message = readAudio(data as Buffer);
                seen.audio.push(message);
                onAudio(ws, message.audio, message.audio.length === 0);
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
    return { base: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, socket: () => current };
}

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
    adapter: AZURE_SPEECH_ADAPTER,
    model: 'azure-stt',
    key: new Secret(KEY),
    endpoint,
    region: 'uaenorth',
    language: 'ar-KW',
    ...changes,
});

describe('hearing with Azure AI Speech', () => {
    it("speaks the Speech protocol: the setup, a WAV header, then audio, and ends with Azure's phrases at turn.end", async () => {
        const s = await fakeAzure((ws, audio, end) => {
            if (audio.length === 4) ws.send(answer('speech.hypothesis', { Text: 'marhaba', Offset: 0, Duration: 1 }));
            if (end) {
                ws.send(answer('speech.phrase', { RecognitionStatus: 'Success', DisplayText: 'Marhaba, shlonik?', Offset: 0, Duration: 2 }));
                ws.send(answer('speech.phrase', { RecognitionStatus: 'EndOfDictation', Offset: 2, Duration: 0 }));
                ws.send(answer('turn.end', {}));
            }
        });
        const { got, events } = heard();
        const stream = new AzureSpeechRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array([1, -2]));
        await waitFor('the audio', () => s.seen.audio.length === 2);
        await waitFor('the partial', () => got.partials.length === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials[0]).toBe('marhaba');
        expect(got.finals).toEqual(['Marhaba, shlonik?']);
        expect(got.failures).toEqual([]);

        // The locale picked is Kuwait's; the key goes in its one header, with a connection id
        expect(s.seen.sockets).toHaveLength(1);
        expect(s.seen.sockets[0].url).toBe('/speech/recognition/conversation/cognitiveservices/v1?language=ar-KW&format=simple');
        expect(s.seen.sockets[0].connectionId).toMatch(/^[0-9a-f]{32}$/);
        // speech.config first, as text with its headers
        expect(s.seen.texts).toHaveLength(1);
        expect(s.seen.texts[0]).toMatch(
            /^Path: speech\.config\r\nX-RequestId: [0-9a-f]{32}\r\nX-Timestamp: [^\r]+\r\nContent-Type: application\/json\r\n\r\n\{/,
        );
        // Then the WAV header, the audio, and an empty message, every one in the same request
        expect(s.seen.audio.map((message) => message.audio.length)).toEqual([44, 4, 0]);
        expect(s.seen.audio[0].audio.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(s.seen.audio[0].audio.readUInt32LE(24)).toBe(16000);
        expect([...new Int16Array(new Uint8Array(s.seen.audio[1].audio).buffer)]).toEqual([1, -2]);
        const requestId = /X-RequestId: (\w+)/.exec(s.seen.texts[0])![1];
        for (const message of s.seen.audio)
            expect(message.headers).toMatch(new RegExp(`^Path: audio\\r\\nX-RequestId: ${requestId}\\r\\n.*Content-Type: audio/x-wav\\r\\n$`, 's'));
    });

    it('ends with no words after silence, and fails on a refused key or a missing region', async () => {
        const s = await fakeAzure((ws, _audio, end) => {
            if (!end) return;
            ws.send(answer('speech.phrase', { RecognitionStatus: 'InitialSilenceTimeout', Offset: 0, Duration: 0 }));
            ws.send(answer('turn.end', {}));
        });
        const quiet = heard();
        const stream = new AzureSpeechRecognition().listen(hearing(s.base), quiet.events);
        stream.finish();
        await waitFor('the end', () => quiet.got.finals.length === 1);
        expect(quiet.got.finals).toEqual(['']);
        expect(quiet.got.failures).toEqual([]);

        const wrong = heard();
        new AzureSpeechRecognition().listen(hearing(s.base, { key: new Secret('wrong-key') }), wrong.events);
        await waitFor('the refusal', () => wrong.got.failures.length === 1);
        expect(wrong.got.failures).toEqual([{ text: '', status: 401 }]);

        const noRegion = heard();
        new AzureSpeechRecognition().listen(hearing(s.base, { region: 'uaenorth.evil.com' }), noRegion.events);
        await waitFor('the refusal', () => noRegion.got.failures.length === 1);
        expect(noRegion.got.failures).toEqual([{ text: '', status: 400 }]);
        expect(s.seen.sockets).toHaveLength(2);
    });

    it('fails with the status a close from Azure gives', async () => {
        const s = await fakeAzure(() => undefined);
        const { got, events } = heard();
        new AzureSpeechRecognition().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.texts.length === 1);
        s.socket()!.close(1007, 'Quota exceeded.');
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 429 }]);
    });

    it("hears each language in its own locale, or that language's most spoken one", () => {
        expect(azureLocale('ar-KW')).toBe('ar-KW');
        expect(azureLocale('ar_ae')).toBe('ar-AE');
        expect(azureLocale('ar')).toBe('ar-SA');
        expect(azureLocale('fil')).toBe('fil-PH');
        expect(azureLocale('xx')).toBe('en-US');
        expect(azureLocale(undefined)).toBe('en-US');
    });

    it('frames messages the way the Speech protocol reads them', () => {
        const message = Buffer.from(audioMessage('abc', new Uint8Array([9, 8])));
        expect(readAudio(message)).toEqual({ headers: expect.stringMatching(/^Path: audio\r\nX-RequestId: abc\r\n/), audio: Buffer.from([9, 8]) });
        expect(readMessage(textMessage('speech.config', 'abc', { a: 1 }))).toEqual({ path: 'speech.config', body: { a: 1 } });
        expect(readMessage(answer('turn.end', {}))).toEqual({ path: 'turn.end', body: {} });
        expect(readMessage('no headers')).toBeUndefined();
        expect(wavHeader().length).toBe(44);
    });
});

/** A stand-in for /cognitiveservices/v1, answering with `answer`. */
async function fakeTts(reply: (res: http.ServerResponse) => void) {
    const seen: { url?: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
            seen.push({ url: req.url, headers: req.headers, body });
            reply(res);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const speaking = (base: string, settings: object = {}): SpeechRequest => ({
    text: 'Hala & welcome <friend>.',
    settings: {
        adapter: AZURE_SPEECH_ADAPTER,
        model: 'azure-tts',
        voiceId: 'ar-KW-FahedNeural',
        key: new Secret(KEY),
        endpoint: base,
        region: 'uaenorth',
        language: 'ar-KW',
        ...settings,
    },
    signal: new AbortController().signal,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const piece of stream) out.push(...piece);
    return out;
}

describe('speaking with Azure AI Speech', () => {
    it('sends SSML for the voice with the key in its one header, and plays the raw 24 kHz audio as it comes', async () => {
        const s = await fakeTts((res) => res.end(Buffer.from(new Int16Array([5, 6, 7]).buffer)));
        expect(await collect(new AzureTts().speak(speaking(s.base)))).toEqual([5, 6, 7]);
        expect(s.seen[0].url).toBe('/cognitiveservices/v1');
        expect(s.seen[0].headers['ocp-apim-subscription-key']).toBe(KEY);
        expect(s.seen[0].headers['x-microsoft-outputformat']).toBe('raw-24khz-16bit-mono-pcm');
        expect(s.seen[0].headers['content-type']).toBe('application/ssml+xml');
        expect(s.seen[0].body).toBe(
            "<speak version='1.0' xml:lang='ar-KW' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts'><voice name='ar-KW-FahedNeural'>Hala &amp; welcome &lt;friend&gt;.</voice></speak>",
        );
    });

    it("tells a multilingual voice the reply's language, uses Pipecat's voice when none is named, and fails with Azure's status", async () => {
        expect(azureSsml('Hi', 'en-US-AvaMultilingualNeural', 'fr-CA')).toContain(
            "<voice name='en-US-AvaMultilingualNeural'><lang xml:lang='fr-CA'>Hi</lang></voice>",
        );
        const s = await fakeTts((res) => res.end());
        await collect(new AzureTts().speak(speaking(s.base, { voiceId: '' })));
        expect(s.seen[0].body).toContain("<voice name='en-US-SaraNeural'>");

        const refused = await fakeTts((res) => {
            res.statusCode = 401;
            res.end();
        });
        const error = await collect(new AzureTts().speak(speaking(refused.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(401);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('is registered as "azure-speech" for hearing and speaking', () => {
        const worker = new VoiceWorker({ port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } });
        expect(worker.connectors.recognition(AZURE_SPEECH_ADAPTER)).toBeInstanceOf(AzureSpeechRecognition);
        expect(worker.connectors.speech(AZURE_SPEECH_ADAPTER)).toBeInstanceOf(AzureTts);
    });
});
