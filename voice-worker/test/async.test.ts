// Speaking with Async (#1885), against a stand-in Async socket on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ASYNC_ADAPTER, AsyncSpeech, asyncStatus } from '../src/async.ts';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'async-speak-key-555';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

async function fakeAsync(options: { refuse?: number; onText?: (ws: WebSocket) => void } = {}) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { urls: [] as string[], messages: [] as Record<string, unknown>[], closed: false };
    server.on('upgrade', (req, socket, head) => {
        seen.urls.push(req.url ?? '');
        if (options.refuse) {
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.on('close', () => (seen.closed = true));
            ws.on('message', (data) => {
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                seen.messages.push(message);
                if ('transcript' in message) options.onText?.(ws);
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
    return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/text_to_speech/websocket/ws`, seen };
}

const request = (url: string, extra: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest => ({
    text: 'Ahlan, kaif halak?',
    settings: { adapter: 'async', model: 'async_flash_v1.0', voiceId: 'voice-7', key: new Secret(KEY), endpoint: url, language: 'ar-KW', ...settings },
    signal: new AbortController().signal,
    ...extra,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

const b64 = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer).toString('base64');

describe('speaking with Async', () => {
    it('opens the socket with the key and version in its address, sends the setup and the text, and plays until final', async () => {
        const s = await fakeAsync({
            onText: (ws) => {
                ws.send(JSON.stringify({ context_id: 'reply', audio: b64(1, 2), final: false }));
                ws.send(JSON.stringify({ context_id: 'reply', audio: b64(3), final: false }));
                ws.send(JSON.stringify({ context_id: 'reply', audio: '', final: true }));
            },
        });
        expect(await collect(new AsyncSpeech().speak(request(s.url)))).toEqual([1, 2, 3]);
        const url = new URL(s.seen.urls[0], 'ws://x');
        expect(url.pathname).toBe('/text_to_speech/websocket/ws');
        expect(Object.fromEntries(url.searchParams)).toEqual({ api_key: KEY, version: 'v1' });
        expect(s.seen.messages).toEqual([
            { model_id: 'async_flash_v1.0', voice: { mode: 'id', id: 'voice-7' }, output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 }, language: 'ar' },
            { transcript: 'Ahlan, kaif halak?', context_id: 'reply', force: true },
        ]);
        await waitFor('the socket to close', () => s.seen.closed);
    });

    it('keeps audio that comes with the final piece', async () => {
        const s = await fakeAsync({ onText: (ws) => ws.send(JSON.stringify({ context_id: 'reply', audio: b64(4, 5), final: true })) });
        expect(await collect(new AsyncSpeech().speak(request(s.url)))).toEqual([4, 5]);
    });

    it("sends the reply's own language over the profile's, and none when neither names one", async () => {
        const own = await fakeAsync({ onText: (ws) => ws.send(JSON.stringify({ final: true, audio: '' })) });
        await collect(new AsyncSpeech().speak(request(own.url, { lang: 'en-GB' })));
        expect(own.seen.messages[0].language).toBe('en');

        const none = await fakeAsync({ onText: (ws) => ws.send(JSON.stringify({ final: true, audio: '' })) });
        await collect(new AsyncSpeech().speak(request(none.url, {}, { language: undefined })));
        expect(none.seen.messages[0]).not.toHaveProperty('language');
    });

    it('fails with the status Async reports in the stream, or of a refused connection, without the key', async () => {
        const reported = await fakeAsync({ onText: (ws) => ws.send(JSON.stringify({ error_code: 'insufficient_credits', message: 'Not enough credits' })) });
        const error = await collect(new AsyncSpeech().speak(request(reported.url))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(402);

        const refused = await fakeAsync({ refuse: 401 });
        const turned = await collect(new AsyncSpeech().speak(request(refused.url))).catch((e: unknown) => e);
        expect((turned as ProviderError).status).toBe(401);
        expect(`${(turned as Error).message} ${JSON.stringify(turned)}`).not.toContain(KEY);
    });

    it('reads only what it knows as a status', () => {
        expect(asyncStatus(429, '')).toBe(429);
        expect(asyncStatus('401', 'Unauthorized')).toBe(401);
        expect(asyncStatus('invalid_api_key', 'Invalid API key')).toBe(401);
        expect(asyncStatus('rate_limited', 'Too many requests')).toBe(429);
        expect(asyncStatus('bad_voice', 'Voice not found')).toBeUndefined();
    });

    it('is registered as "async" for speaking unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(ASYNC_ADAPTER)).toBeInstanceOf(AsyncSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('async', own) }).connectors.speech('async')).toBe(own);
    });
});
