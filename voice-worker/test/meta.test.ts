// Hearing with Meta (#1895), against a stand-in Meta server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import { META_ADAPTER, MetaRecognition, metaLanguage } from '../src/meta.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'meta-hear-key-284';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in Meta: what it answers the handshake with, and what it does at the end of the audio. */
async function fakeMeta(options: { handshake?: (ws: WebSocket) => void; onEnd?: (ws: WebSocket) => void } = {}) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { paths: [] as string[], handshakes: [] as Record<string, unknown>[], bytes: 0, bytesBeforeReady: 0, ended: false };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        seen.paths.push(req.url ?? '');
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            let ready = false;
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    seen.bytes += (data as Buffer).length;
                    if (!ready) seen.bytesBeforeReady += (data as Buffer).length;
                    return;
                }
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                if (message.type === 'endStream') {
                    seen.ended = true;
                    options.onEnd?.(ws);
                    return;
                }
                seen.handshakes.push(message);
                // Answered a little later, so audio sent in the meantime would show up before it
                setTimeout(() => {
                    if (options.handshake) return options.handshake(ws);
                    ready = true;
                    ws.send(JSON.stringify({ sessionId: 'session-1' }));
                }, 30);
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
    const base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/asr/realtime`;
    return { base, seen, send: (m: object) => current?.send(JSON.stringify(m)) };
}

function heard() {
    const got = { partials: [] as string[], finals: [] as string[], endpoints: 0, failures: [] as { text: string; status?: number }[] };
    const events: RecognizerEvents = {
        partial: (text) => got.partials.push(text),
        final: (text) => got.finals.push(text),
        endpoint: () => (got.endpoints += 1),
        failed: (text, failure) => got.failures.push({ text, ...(failure?.status === undefined ? {} : { status: failure.status }) }),
    };
    return { got, events };
}

const settings = (endpoint: string, changes: object = {}) => ({ adapter: 'meta', model: 'muse-voice-transcribe-1.0', key: new Secret(KEY), endpoint, language: 'ar-KW', ...changes });

describe('hearing with Meta', () => {
    it('sends the key in the handshake, holds the audio until Meta takes it, and ends with the last words when Meta closes', async () => {
        const m = await fakeMeta({
            onEnd: (ws) => {
                ws.send(JSON.stringify({ type: 'transcript', transcript: 'kaif', final: false }));
                ws.send(JSON.stringify({ type: 'speechComplete', transcript: 'Kaif halak?', turnId: 2 }));
                ws.close(1000);
            },
        });
        const { got, events } = heard();
        const stream = new MetaRecognition().listen(settings(m.base), events);
        stream.push(new Int16Array(320));
        await waitFor('the audio', () => m.seen.bytes === 640);
        expect(m.seen.bytesBeforeReady).toBe(0);
        m.send({ type: 'speechStart', turnId: 1 });
        m.send({ type: 'transcript', transcript: 'Marha', final: false });
        m.send({ type: 'transcript', transcript: 'Marhaba habibi', final: false });
        m.send({ type: 'speechComplete', transcript: 'Marhaba habibi.', turnId: 1 });
        await waitFor('the first turn', () => got.partials.includes('Marhaba habibi.'));
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Marha', 'Marhaba habibi', 'Marhaba habibi.', 'Marhaba habibi. kaif', 'Marhaba habibi. Kaif halak?']);
        expect(got.finals).toEqual(['Marhaba habibi. Kaif halak?']);
        expect(got.endpoints).toBe(1);
        expect(m.seen.ended).toBe(true);
        expect(m.seen.paths[0]).toMatch(/^\/v1\/asr\/realtime\?sessionId=stream-[0-9a-f-]{36}$/);
        expect(m.seen.paths[0]).not.toContain(KEY);
        expect(m.seen.handshakes[0]).toEqual({
            authorization: { accessToken: `Bearer ${KEY}` },
            audioEncoding: 'PCM_16KHZ',
            model: 'muse-voice-transcribe-1.0',
            mode: 'ENDPOINTING',
            partialMode: 'CUMULATIVE',
            emitAudioProgress: false,
            languageBias: ['Arabic'],
        });
    });

    it('sends the end of the audio only once Meta takes audio', async () => {
        const m = await fakeMeta({ onEnd: (ws) => ws.close(1000) });
        const { got, events } = heard();
        const stream = new MetaRecognition().listen(settings(m.base), events);
        stream.push(new Int16Array(160));
        stream.finish();
        await waitFor('the end', () => got.finals.length === 1);
        expect(m.seen.bytes).toBe(320);
        expect(m.seen.bytesBeforeReady).toBe(0);
        expect(m.seen.ended).toBe(true);
    });

    it('names the language Meta biases toward, and leaves one it does not list to Meta', async () => {
        expect(metaLanguage('ar-KW')).toBe('Arabic');
        expect(metaLanguage('zh-CN')).toBe('Mandarin Chinese');
        expect(metaLanguage('sw')).toBeUndefined();
        expect(metaLanguage(undefined)).toBeUndefined();
        const m = await fakeMeta();
        const stream = new MetaRecognition().listen(settings(m.base, { language: undefined }), heard().events);
        await waitFor('the handshake', () => m.seen.handshakes.length === 1);
        expect(m.seen.handshakes[0]).not.toHaveProperty('languageBias');
        stream.close();
    });

    it('fails with a refused key, and when Meta closes any way but normally after the end of the audio', async () => {
        const refused = await fakeMeta({ handshake: (ws) => ws.send(JSON.stringify({ type: 'error', message: 'Invalid access token' })) });
        const first = heard();
        new MetaRecognition().listen(settings(refused.base), first.events);
        await waitFor('the refusal', () => first.got.failures.length === 1);
        expect(first.got.failures).toEqual([{ text: '', status: 401 }]);

        const dropped = await fakeMeta({ onEnd: (ws) => ws.close(1011) });
        const second = heard();
        const stream = new MetaRecognition().listen(settings(dropped.base), second.events);
        stream.push(new Int16Array(160));
        await waitFor('the audio', () => dropped.seen.bytes === 320);
        dropped.send({ type: 'transcript', transcript: 'Marhaba', final: false });
        await waitFor('the words so far', () => second.got.partials.length === 1);
        stream.finish();
        await waitFor('the failure', () => second.got.failures.length === 1);
        expect(second.got.finals).toEqual([]);
        expect(second.got.failures).toEqual([{ text: 'Marhaba' }]);
    });

    it('is registered as "meta" for hearing unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.recognition(META_ADAPTER)).toBeInstanceOf(MetaRecognition);
        const own = { listen: () => ({ push: () => undefined, finish: () => undefined, close: () => undefined }) };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerRecognition('meta', own) }).connectors.recognition('meta')).toBe(own);
    });
});
