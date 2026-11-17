// Hearing with Gladia (#1885), against a stand-in Gladia server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import { GLADIA_ADAPTER, GladiaRecognition } from '../src/gladia.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'gladia-hear-key-135';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

async function fakeGladia(options: { refuse?: number; session?: unknown; onStop?: (ws: WebSocket) => void } = {}) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { sessions: [] as { key?: string | string[]; body: Record<string, unknown> }[], sockets: [] as string[], bytes: 0, stopped: false };
    let current: WebSocket | undefined;
    let base = '';
    server.on('request', (req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.sessions.push({ key: req.headers['x-gladia-key'], body: JSON.parse(raw) });
            res.statusCode = options.refuse ?? 201;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(options.session ?? { id: 's1', url: `${base.replace('http', 'ws')}/v2/live?token=one-session` }));
        });
    });
    server.on('upgrade', (req, socket, head) => {
        seen.sockets.push(req.url ?? '');
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    seen.bytes += (data as Buffer).length;
                    return;
                }
                if (JSON.parse(data.toString()).type === 'stop_recording') {
                    seen.stopped = true;
                    options.onStop?.(ws);
                }
            });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closers.push(
        () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                server.closeAllConnections();
                server.close(() => resolve());
            })
    );
    return { base, seen, send: (m: object) => current?.send(JSON.stringify(m)) };
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

const settings = (endpoint: string, changes: object = {}) => ({ adapter: 'gladia', model: 'solaria-1', key: new Secret(KEY), endpoint, language: 'ar-KW', ...changes });
const transcript = (text: string, isFinal: boolean) => ({ type: 'transcript', session_id: 's1', data: { id: 'u1', is_final: isFinal, utterance: { text, language: 'ar' } } });

describe('hearing with Gladia', () => {
    it('asks for a session with the key, opens its socket, sends binary audio, and ends with the last words when Gladia closes', async () => {
        const g = await fakeGladia({
            onStop: (ws) => {
                ws.send(JSON.stringify(transcript(' kaif halak?', true)));
                ws.close(1000);
            },
        });
        const { got, events } = heard();
        const stream = new GladiaRecognition().listen(settings(g.base), events);
        stream.push(new Int16Array(320));
        await waitFor('the socket', () => g.seen.sockets.length === 1 && g.seen.bytes === 640);
        g.send(transcript('Marha', false));
        g.send(transcript('Marhaba habibi.', true));
        await waitFor('the words so far', () => got.partials.includes('Marhaba habibi.'));
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Marha', 'Marhaba habibi.', 'Marhaba habibi. kaif halak?']);
        expect(got.finals).toEqual(['Marhaba habibi. kaif halak?']);
        expect(g.seen.stopped).toBe(true);
        expect(g.seen.sessions[0]).toEqual({
            key: KEY,
            body: {
                encoding: 'wav/pcm',
                bit_depth: 16,
                sample_rate: 16000,
                channels: 1,
                model: 'solaria-1',
                language_config: { languages: ['ar'], code_switching: false },
                messages_config: { receive_partial_transcripts: true, receive_final_transcripts: true },
            },
        });
        expect(g.seen.sockets[0]).toBe('/v2/live?token=one-session');
        expect(g.seen.sockets[0]).not.toContain(KEY);
    });

    it('fails, keeping the words heard, when Gladia closes any way but normally after the end of the audio', async () => {
        const g = await fakeGladia({ onStop: (ws) => ws.close(1011) });
        const { got, events } = heard();
        const stream = new GladiaRecognition().listen(settings(g.base), events);
        stream.push(new Int16Array(320));
        await waitFor('the socket', () => g.seen.sockets.length === 1);
        g.send(transcript('Marhaba.', true));
        await waitFor('the words so far', () => got.partials.includes('Marhaba.'));
        stream.finish();
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.finals).toEqual([]);
        expect(got.failures).toEqual([{ text: 'Marhaba.' }]);
    });

    it('lets Gladia work out the language when none is set', async () => {
        const g = await fakeGladia();
        const stream = new GladiaRecognition().listen(settings(g.base, { language: undefined }), heard().events);
        await waitFor('the session', () => g.seen.sessions.length === 1);
        expect(g.seen.sessions[0].body).not.toHaveProperty('language_config');
        stream.close();
    });

    it('fails with the status Gladia refuses the session with, or when it gives no socket address', async () => {
        const refused = await fakeGladia({ refuse: 401, session: { message: 'no' } });
        const one = heard();
        new GladiaRecognition().listen(settings(refused.base), one.events);
        await waitFor('the failure', () => one.got.failures.length === 1);
        expect(one.got.failures).toEqual([{ text: '', status: 401 }]);

        const odd = await fakeGladia({ session: { id: 's1', url: 'https://not-a-socket.example' } });
        const two = heard();
        new GladiaRecognition().listen(settings(odd.base), two.events);
        await waitFor('the failure', () => two.got.failures.length === 1);
        expect(two.got.failures).toEqual([{ text: '' }]);
        expect(odd.seen.sockets).toEqual([]);
    });

    it('is registered as "gladia" for hearing unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.recognition(GLADIA_ADAPTER)).toBeInstanceOf(GladiaRecognition);
        const own = { listen: () => ({ push: () => undefined, finish: () => undefined, close: () => undefined }) };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerRecognition('gladia', own) }).connectors.recognition('gladia')).toBe(own);
    });
});
