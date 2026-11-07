// Speaking with Soniox (#1872), against a stand-in Soniox TTS socket on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { VoiceWorker } from '../src/server.ts';
import { SONIOX_ADAPTER } from '../src/soniox.ts';
import { SonioxSpeech } from '../src/sonioxSpeech.ts';
import { waitFor } from './harness.ts';

const KEY = 'soniox-speak-key-777';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

async function fakeSoniox(options: { refuse?: number; onText?: (ws: WebSocket) => void } = {}) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { auth: [] as (string | undefined)[], messages: [] as Record<string, unknown>[], closed: false };
    server.on('upgrade', (req, socket, head) => {
        seen.auth.push(req.headers.authorization);
        if (options.refuse) {
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.on('close', () => (seen.closed = true));
            ws.on('message', (data) => {
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                seen.messages.push(message);
                if ('text' in message) options.onText?.(ws);
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
            })
    );
    return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/tts-websocket`, seen };
}

const request = (url: string, extra: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Ahlan, kaif halak?',
    settings: { adapter: 'soniox', model: 'tts-rt-v2', voiceId: 'Maya', key: new Secret(KEY), endpoint: url, language: 'ar-KW', ...settings },
    signal: new AbortController().signal,
    ...extra,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

const b64 = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer).toString('base64');

describe('speaking with Soniox', () => {
    it('sends the stream setup and the whole text with the key as a bearer, and plays the audio until terminated', async () => {
        const s = await fakeSoniox({
            onText: (ws) => {
                ws.send(JSON.stringify({ stream_id: 'reply', audio: b64(1, 2) }));
                ws.send(JSON.stringify({ stream_id: 'reply', audio: b64(3), audio_end: true }));
                ws.send(JSON.stringify({ stream_id: 'reply', terminated: true }));
            },
        });
        expect(await collect(new SonioxSpeech().speak(request(s.url)))).toEqual([1, 2, 3]);
        expect(s.seen.auth).toEqual([`Bearer ${KEY}`]);
        expect(s.seen.messages).toEqual([
            { stream_id: 'reply', model: 'tts-rt-v2', voice: 'Maya', audio_format: 'pcm_s16le', sample_rate: 24000, language: 'ar' },
            { text: 'Ahlan, kaif halak?', text_end: true, stream_id: 'reply' },
        ]);
        await waitFor('the socket to close', () => s.seen.closed);
    });

    it("sends the reply's own language over the profile's", async () => {
        const s = await fakeSoniox({ onText: (ws) => ws.send(JSON.stringify({ terminated: true })) });
        await collect(new SonioxSpeech().speak(request(s.url, { lang: 'en-GB' })));
        expect(s.seen.messages[0].language).toBe('en');
    });

    it('sends English when neither the reply nor the profile names a language', async () => {
        const s = await fakeSoniox({ onText: (ws) => ws.send(JSON.stringify({ terminated: true })) });
        await collect(new SonioxSpeech().speak(request(s.url, {}, { language: undefined })));
        expect(s.seen.messages[0].language).toBe('en');
    });

    it('fails with the status Soniox reports in the stream, or of a refused connection, without the key', async () => {
        const reported = await fakeSoniox({ onText: (ws) => ws.send(JSON.stringify({ stream_id: 'reply', error_code: 402, error_message: 'Out of credit' })) });
        const error = await collect(new SonioxSpeech().speak(request(reported.url))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(402);

        const refused = await fakeSoniox({ refuse: 401 });
        const turned = await collect(new SonioxSpeech().speak(request(refused.url))).catch((e: unknown) => e);
        expect((turned as ProviderError).status).toBe(401);
        expect(`${(turned as Error).message} ${JSON.stringify(turned)}`).not.toContain(KEY);
    });

    it('is registered as "soniox" for speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(SONIOX_ADAPTER)).toBeInstanceOf(SonioxSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('soniox', own) }).connectors.speech('soniox')).toBe(own);
    });
});
