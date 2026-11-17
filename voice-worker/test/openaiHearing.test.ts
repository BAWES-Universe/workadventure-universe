// Hearing with OpenAI (#1900), against a stand-in OpenAI realtime socket on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectorRegistry, Secret } from '../src/connectors.ts';
import { OPENAI_ADAPTER, OpenAIRecognition } from '../src/openaiHearing.ts';
import type { RecognizerEvents } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'sk-openai-key-1900';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    while (closers.length) await closers.pop()!();
});

/** A stand-in for OpenAI's realtime socket, answered by `onMessage`. It confirms the setup unless told not to. */
async function fakeRealtime(onMessage: (ws: WebSocket, message: Record<string, unknown>) => void = () => undefined, confirm = true) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const seen = { sockets: [] as { url: string; auth?: string }[], messages: [] as Record<string, unknown>[] };
    let current: WebSocket | undefined;
    server.on('upgrade', (req, socket, head) => {
        seen.sockets.push({ url: req.url ?? '', auth: req.headers.authorization });
        wss.handleUpgrade(req, socket, head, (ws) => {
            current = ws;
            ws.on('message', (data) => {
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                seen.messages.push(message);
                if (message.type === 'session.update' && confirm) ws.send(JSON.stringify({ type: 'session.updated', session: message.session }));
                onMessage(ws, message);
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
    adapter: 'openai',
    model: 'gpt-realtime-whisper',
    key: new Secret(KEY),
    endpoint,
    language: 'ar-KW',
    ...changes,
});

describe('hearing with OpenAI', () => {
    it('sets up a transcription session, holds audio until OpenAI confirms it, and ends with the transcript for the commit', async () => {
        const s = await fakeRealtime((ws, message) => {
            if (message.type === 'input_audio_buffer.commit') {
                ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: ' Marhaba, kaif halak? ' }));
            }
        });
        const { got, events } = heard();
        const stream = new OpenAIRecognition().listen(hearing(s.base), events);
        stream.push(new Int16Array(160));
        await waitFor('the audio', () => s.seen.messages.length === 2);
        s.send({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Marhaba,' });
        s.send({ type: 'conversation.item.input_audio_transcription.delta', delta: ' kaif' });
        await waitFor('the words so far', () => got.partials.length === 2);
        stream.finish();
        await waitFor('the last words', () => got.finals.length === 1);
        expect(got.partials).toEqual(['Marhaba,', 'Marhaba, kaif', 'Marhaba, kaif halak?']);
        expect(got.finals).toEqual(['Marhaba, kaif halak?']);
        expect(s.seen.sockets).toEqual([{ url: '/v1/realtime?intent=transcription', auth: `Bearer ${KEY}` }]);
        expect(s.seen.messages[0]).toEqual({
            type: 'session.update',
            session: {
                type: 'transcription',
                audio: {
                    input: {
                        format: { type: 'audio/pcm', rate: 24000 },
                        transcription: { model: 'gpt-realtime-whisper', language: 'ar' },
                        turn_detection: null,
                    },
                },
            },
        });
        // 10 ms of 16 kHz audio goes as 24 kHz: about 240 samples, base64
        const append = s.seen.messages[1];
        expect(append.type).toBe('input_audio_buffer.append');
        expect(Buffer.from(append.audio as string, 'base64').length / 2).toBeGreaterThan(200);
        expect(s.seen.messages[2]).toEqual({ type: 'input_audio_buffer.commit' });
    });

    it('sends no audio before OpenAI confirms the session', async () => {
        const s = await fakeRealtime(() => undefined, false);
        const { events } = heard();
        const stream = new OpenAIRecognition().listen(hearing(s.base, { language: undefined }), events);
        stream.push(new Int16Array(160));
        await waitFor('the setup', () => s.seen.messages.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(s.seen.messages.map((m) => m.type)).toEqual(['session.update']);
        expect((s.seen.messages[0].session as { audio: { input: { transcription: object } } }).audio.input.transcription).toEqual({
            model: 'gpt-realtime-whisper',
        });
        s.send({ type: 'session.updated' });
        await waitFor('the held audio', () => s.seen.messages.length === 2);
    });

    it('fails with the status of an error OpenAI sends', async () => {
        const s = await fakeRealtime();
        const { got, events } = heard();
        new OpenAIRecognition().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.sockets.length === 1);
        s.send({ type: 'error', error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided' } });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 401 }]);
    });

    it('reads a rate limit as one even when its message points to billing', async () => {
        const s = await fakeRealtime();
        const { got, events } = heard();
        new OpenAIRecognition().listen(hearing(s.base), events);
        await waitFor('the socket', () => s.seen.sockets.length === 1);
        s.send({
            type: 'error',
            error: {
                type: 'requests',
                code: 'rate_limit_exceeded',
                message: 'Rate limit reached for requests. Add a payment method at https://platform.openai.com/account/billing to raise it.',
            },
        });
        await waitFor('the failure', () => got.failures.length === 1);
        expect(got.failures).toEqual([{ text: '', status: 429 }]);
    });

    it('is registered as "openai" for hearing, and leaves every other OpenAI model (talking live) to the one already there', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        // On its own, the worker has OpenAI's talking connector too, under the same name
        expect(new VoiceWorker(base).connectors.recognition(OPENAI_ADAPTER)).not.toBeInstanceOf(OpenAIRecognition);
        expect(new VoiceWorker(base).connectors.recognition(OPENAI_ADAPTER)).toBeDefined();
        const asked: string[] = [];
        const recognizer = { push: () => undefined, finish: () => undefined, close: () => undefined };
        const talking = { listen: (settings: { model: string }) => (asked.push(settings.model), recognizer) };
        const both = new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerRecognition('openai', talking as never) }).connectors.recognition(
            'openai',
        )!;
        const { events } = heard();
        expect(both.listen(hearing('ws://127.0.0.1:9', { model: 'gpt-realtime-2.1' }), events)).toBe(recognizer);
        expect(asked).toEqual(['gpt-realtime-2.1']);
        both.listen(hearing('ws://127.0.0.1:9', { model: 'gpt-transcribe' }), events).close();
        expect(asked).toEqual(['gpt-realtime-2.1']);
    });
});
