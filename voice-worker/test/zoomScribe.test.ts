// Hearing with Zoom's Scribe (#1908), against a stand-in Scribe socket on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { ZOOM_SCRIBE_ADAPTER, ZoomScribeRecognition, zoomLocale } from '../src/zoomScribe.ts';
import { waitFor } from './harness.ts';

const KEY = 'zoom-key-908';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in for Scribe Live, answered by `onText` for each text message. */
async function fakeScribe(onText: (ws: WebSocket, message: Record<string, unknown>) => void) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { sockets: [] as { url: string; auth?: string }[], audio: [] as Buffer[], messages: [] as Record<string, unknown>[] };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        seen.sockets.push({ url: req.url ?? '', auth: req.headers.authorization });
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data, isBinary) => {
                if (isBinary) return void seen.audio.push(data as Buffer);
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                seen.messages.push(message);
                onText(ws, message);
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
    return { base: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, send: (m: object) => current?.send(JSON.stringify(m)) };
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
    adapter: 'zoom',
    model: 'whisper',
    key: new Secret(KEY),
    endpoint,
    language: 'ar-AE',
    ...changes,
});

const ready = (ws: WebSocket, message: Record<string, unknown>) => {
    if (message.type === 'session.update') ws.send(JSON.stringify({ type: 'session.updated', session: { id: 's-1' } }));
};

describe("hearing with Zoom's Scribe", () => {
    it('sets the session up, sends raw audio once Scribe is ready, and ends with the transcript that answers the commit', async () => {
        const s = await fakeScribe((ws, message) => {
            ready(ws, message);
            if (message.type === 'input_audio_buffer.commit') {
                ws.send(JSON.stringify({ type: 'transcription.completed', transcript: '[speaker_1] Hello there. ', language: 'ar-AE' }));
            }
        });
        const { got, events } = heard();
        const stream = new ZoomScribeRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array([1, -2]));
        await waitFor('the audio', () => s.seen.audio.length === 1);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.finals).toEqual(['Hello there.']);
        expect(s.seen.sockets).toEqual([{ url: '/v2/aiservices/scribe/live', auth: `Bearer ${KEY}` }]);
        expect(s.seen.messages).toEqual([
            { type: 'session.update', language: 'ar-AE', audio: { format: 'pcm16' }, config: { model: 'whisper' }, turn_detection: { type: 'none' } },
            { type: 'input_audio_buffer.commit' },
        ]);
        expect([...new Int16Array(new Uint8Array(s.seen.audio[0]).buffer)]).toEqual([1, -2]);
    });

    it("uses Scribe Multilingual when the bot names no model, and Scribe's locale for each language", async () => {
        const s = await fakeScribe(ready);
        const { events } = heard();
        new ZoomScribeRecognition().listen(hearing(s.base, { model: '', language: 'fr-CA' }), events);
        await waitFor('the setup', () => s.seen.messages.length === 1);
        expect(s.seen.messages[0]).toMatchObject({ language: 'fr-FR', config: { model: 'zoom-scribe-multilingual' } });
        expect(zoomLocale('ar-KW')).toBe('ar-SA');
        expect(zoomLocale('pt-PT')).toBe('pt-PT');
        expect(zoomLocale('sw')).toBe('en-US');
        expect(zoomLocale(undefined)).toBe('en-US');
    });

    it('fails with the status of an error Scribe sends', async () => {
        const s = await fakeScribe(() => undefined);
        const { got, events } = heard();
        new ZoomScribeRecognition().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.sockets.length === 1);
        s.send({ type: 'error', error: { code: 'invalid_token', message: 'Invalid access token', fatal: true } });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });

    it('is registered as "zoom" for hearing, leaving every other Zoom model (talking live) to the one already there', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.recognition(ZOOM_SCRIBE_ADAPTER)).toBeInstanceOf(ZoomScribeRecognition);
        const asked: string[] = [];
        const recognizer = { push: () => undefined, finish: () => undefined, close: () => undefined };
        const talking = { listen: (settings: { model: string }) => (asked.push(settings.model), recognizer) };
        const both = new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerRecognition('zoom', talking as never) }).connectors.recognition(
            'zoom',
        )!;
        expect(both.listen(hearing('ws://127.0.0.1:9', { model: 'gemma-4' }), heard().events)).toBe(recognizer);
        expect(asked).toEqual(['gemma-4']);
    });
});
