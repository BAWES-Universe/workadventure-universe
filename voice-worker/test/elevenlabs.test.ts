// Speaking with ElevenLabs (#1748), against a stand-in ElevenLabs server on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry, ProviderError, Secret, type SpeechRequest } from '../src/connectors.ts';
import { WebSocketServer, type WebSocket } from 'ws';
import { ELEVENLABS_ADAPTER, ELEVENLABS_MODELS, ElevenLabsSpeech, WARM_SOCKET_MS, currentElevenLabsModel, elevenLabsModel } from '../src/elevenlabs.ts';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'sk-eleven-test-key-456';

interface Seen {
    method?: string;
    url?: string;
    key?: string | string[];
    body?: Record<string, unknown>;
}

let server: http.Server | undefined;
afterEach(
    () =>
        new Promise<void>((resolve) => {
            if (!server) return resolve();
            server.closeAllConnections();
            server.close(() => resolve());
            server = undefined;
        })
);

/** A stand-in that answers each request with `reply`, after noting what it was asked. */
async function fakeElevenLabs(reply: (res: http.ServerResponse) => void): Promise<{ base: string; seen: Seen[] }> {
    const seen: Seen[] = [];
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', () => {
            seen.push({ method: req.method, url: req.url, key: req.headers['xi-api-key'], body: raw ? JSON.parse(raw) : undefined });
            reply(res);
        });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function request(base: string, extra: Partial<SpeechRequest> = {}, settings: object = {}): SpeechRequest {
    return {
        text: 'Hello there',
        settings: { adapter: 'elevenlabs', model: 'eleven_flash_v2_5', voiceId: 'voice/1', key: new Secret(KEY), endpoint: base, ...settings },
        signal: new AbortController().signal,
        ...extra,
    };
}

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
    const out: number[] = [];
    for await (const chunk of stream) out.push(...chunk);
    return out;
}

/** Little-endian s16 bytes of these samples. */
const pcm = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer);

describe('speaking with ElevenLabs', () => {
    it('streams one request per reply with the key in xi-api-key, asking for 24 kHz PCM with the chosen voice and model', async () => {
        const el = await fakeElevenLabs((res) => res.end(pcm(1, 2, 3)));
        const samples = await collect(new ElevenLabsSpeech().speak(request(el.base)));
        expect(samples).toEqual([1, 2, 3]);
        expect(el.seen).toHaveLength(1);
        expect(el.seen[0]).toMatchObject({ method: 'POST', url: '/v1/text-to-speech/voice%2F1/stream?output_format=pcm_24000', key: KEY });
        expect(el.seen[0].body).toEqual({ text: 'Hello there', model_id: 'eleven_flash_v2_5' });
    });

    it('puts a sample split across two pieces of the stream back together', async () => {
        const bytes = pcm(1000, -2000, 3000);
        const el = await fakeElevenLabs((res) => {
            res.write(bytes.subarray(0, 3));
            setTimeout(() => {
                res.write(bytes.subarray(3, 5));
                setTimeout(() => res.end(bytes.subarray(5)), 20);
            }, 20);
        });
        expect(await collect(new ElevenLabsSpeech().speak(request(el.base)))).toEqual([1000, -2000, 3000]);
    });

    it("sends the reply's language as language_code, but not to a model that refuses one", async () => {
        const el = await fakeElevenLabs((res) => res.end(pcm(1)));
        await collect(new ElevenLabsSpeech().speak(request(el.base, { lang: 'ar-KW' })));
        await collect(new ElevenLabsSpeech().speak(request(el.base, {}, { language: 'fr' })));
        // Eleven v4, and a model newer than the table: ElevenLabs ignores a code a newer model cannot use
        for (const model of ['eleven_v4', 'eleven_v3', 'eleven_v5']) {
            await collect(new ElevenLabsSpeech().speak(request(el.base, { lang: 'ar_KW' }, { model })));
        }
        for (const model of ['eleven_multilingual_v2', 'eleven_turbo_v2', 'eleven_flash_v2', 'eleven_monolingual_v1']) {
            await collect(new ElevenLabsSpeech().speak(request(el.base, { lang: 'ar' }, { model })));
        }
        expect(el.seen.map((s) => s.body?.language_code)).toEqual(['ar', 'fr', 'ar', 'ar', 'ar', undefined, undefined, undefined, undefined]);
    });

    it('makes the voice steadier or livelier for the chosen expression, and leaves the saved settings for natural', async () => {
        const el = await fakeElevenLabs((res) => res.end(pcm(1)));
        for (const expression of ['restrained', 'natural', 'expressive'] as const) {
            await collect(new ElevenLabsSpeech().speak(request(el.base, { expression })));
        }
        expect(el.seen.map((s) => s.body?.voice_settings)).toEqual([{ stability: 0.75 }, undefined, { stability: 0.3 }]);
    });

    it('uses the Robust and Creative presets on v3, which takes stability only as 0, 0.5 or 1', async () => {
        const el = await fakeElevenLabs((res) => res.end(pcm(1)));
        for (const expression of ['restrained', 'natural', 'expressive'] as const) {
            await collect(new ElevenLabsSpeech().speak(request(el.base, { expression }, { model: 'eleven_v3' })));
        }
        expect(el.seen.map((s) => s.body?.voice_settings)).toEqual([{ stability: 1 }, undefined, { stability: 0 }]);
    });

    it.each([401, 422, 429])('fails with status %i when ElevenLabs refuses, and the key is in no failure', async (status) => {
        const el = await fakeElevenLabs((res) => {
            res.statusCode = status;
            res.end(JSON.stringify({ detail: { message: 'no' } }));
        });
        const error = await collect(new ElevenLabsSpeech().speak(request(el.base))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(status);
        expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain(KEY);
    });

    it('fails without a status when ElevenLabs cannot be reached', async () => {
        const error = await collect(new ElevenLabsSpeech().speak(request('http://127.0.0.1:1'))).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
    });

    it('fails without a status when the stream drops part-way, after the audio it gave', async () => {
        const el = await fakeElevenLabs((res) => {
            res.write(pcm(5, 6));
            setTimeout(() => res.socket?.destroy(), 20);
        });
        const got: number[] = [];
        const error = await (async () => {
            for await (const chunk of new ElevenLabsSpeech().speak(request(el.base))) got.push(...chunk);
        })().catch((e: unknown) => e);
        expect(got).toEqual([5, 6]);
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBeUndefined();
    });

    it('stops quietly when the reply is no longer wanted', async () => {
        const el = await fakeElevenLabs((res) => {
            res.write(pcm(7));
            // Never ends on its own
        });
        const abort = new AbortController();
        const got: number[] = [];
        for await (const chunk of new ElevenLabsSpeech().speak(request(el.base, { signal: abort.signal }))) {
            got.push(...chunk);
            abort.abort();
        }
        expect(got).toEqual([7]);
    });
});

describe('the worker speaks with ElevenLabs by name', () => {
    it('has it registered as "elevenlabs" unless a registry already brings one', () => {
        const base = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };
        expect(new VoiceWorker(base).connectors.speech(ELEVENLABS_ADAPTER)).toBeInstanceOf(ElevenLabsSpeech);
        const own = { speak: async function* () {} };
        expect(new VoiceWorker({ ...base, connectors: new ConnectorRegistry().registerSpeech('elevenlabs', own) }).connectors.speech('elevenlabs')).toBe(own);
    });
});

describe('the ElevenLabs models', () => {
    it('knows how each documented model is served and what it takes', () => {
        expect(elevenLabsModel('eleven_v4_turbo')).toEqual({ transport: 'dialogue', languageCode: true, stability: 'any' });
        expect(elevenLabsModel('eleven_v3_conversational')).toEqual({ transport: 'dialogue', languageCode: true, stability: 'presets' });
        expect(elevenLabsModel('eleven_v4')).toEqual({ transport: 'stream', languageCode: true, stability: 'any' });
        expect(elevenLabsModel('eleven_v3')).toEqual({ transport: 'stream', languageCode: true, stability: 'presets' });
        expect(elevenLabsModel('eleven_flash_v2_5')).toEqual({ transport: 'stream', languageCode: true, stability: 'any' });
        expect(elevenLabsModel('eleven_multilingual_v2').languageCode).toBe(false);
    });

    it('speaks a Turbo v2 profile with the Flash model ElevenLabs replaced it with', async () => {
        const el = await fakeElevenLabs((res) => res.end(pcm(1)));
        await collect(new ElevenLabsSpeech().speak(request(el.base, { lang: 'ar' }, { model: 'eleven_turbo_v2_5' })));
        await collect(new ElevenLabsSpeech().speak(request(el.base, { lang: 'ar' }, { model: 'eleven_turbo_v2' })));
        expect(el.seen.map((s) => [s.body?.model_id, s.body?.language_code])).toEqual([
            ['eleven_flash_v2_5', 'ar'],
            ['eleven_flash_v2', undefined],
        ]);
        expect(currentElevenLabsModel('eleven_v4_turbo')).toBe('eleven_v4_turbo');
    });

    it('treats a model newer than the table as one that streams over HTTP and takes the language', () => {
        expect(elevenLabsModel('eleven_v5')).toEqual({ transport: 'stream', languageCode: true, stability: 'any' });
        // Not a lookup through the prototype
        expect(elevenLabsModel('toString')).toEqual({ transport: 'stream', languageCode: true, stability: 'any' });
    });

    it('sends only the dialogue models over the Text to Dialogue WebSocket', () => {
        expect(Object.keys(ELEVENLABS_MODELS).filter((id) => ELEVENLABS_MODELS[id].transport === 'dialogue')).toEqual(['eleven_v4_turbo', 'eleven_v3_conversational']);
    });
});

interface FakeDialogue {
    /** Drops every open socket, as ElevenLabs would on its side. */
    dropAll: () => void;
    base: string;
    upgrades: { url?: string; key?: string | string[] }[];
    messages: Record<string, unknown>[];
    closed: boolean;
}

const dialogueServers: { close: () => Promise<void> }[] = [];
afterEach(async () => {
    while (dialogueServers.length) await dialogueServers.pop()!.close();
});

/** A stand-in Text to Dialogue WebSocket: `onClose` runs once the worker asks it to close the socket. */
async function fakeDialogue(options: { refuse?: number; onClose?: (send: (m: object) => void, ws: WebSocket) => void } = {}): Promise<FakeDialogue> {
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const state: FakeDialogue = { base: '', upgrades: [], messages: [], closed: false, dropAll: () => wss.clients.forEach((c) => c.terminate()) };
    httpServer.on('upgrade', (req, socket, head) => {
        state.upgrades.push({ url: req.url, key: req.headers['xi-api-key'] });
        if (options.refuse) {
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.on('close', () => (state.closed = true));
            ws.on('message', (data) => {
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                state.messages.push(message);
                if (message.close_socket === true) options.onClose?.((m) => ws.send(JSON.stringify(m)), ws);
            });
        });
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    state.base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    dialogueServers.push({
        close: () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                httpServer.closeAllConnections();
                httpServer.close(() => resolve());
            }),
    });
    return state;
}

const b64 = (bytes: Buffer) => bytes.toString('base64');

describe('speaking with Eleven v4 Turbo over the Text to Dialogue WebSocket', () => {
    const turbo = (base: string, extra: Partial<SpeechRequest> = {}) => request(base, extra, { model: 'eleven_v4_turbo' });

    it('opens one socket per reply with the key in xi-api-key, asks for 24 kHz PCM in the language, and sends the whole reply then closes', async () => {
        const bytes = pcm(1000, -2000, 3000);
        const el = await fakeDialogue({
            onClose: (send, ws) => {
                // A sample split across two chunks
                send({ audio: b64(bytes.subarray(0, 3)) });
                send({ audio: b64(bytes.subarray(3)) });
                send({ is_final_audio_for_turn: true });
                send({ is_final: true });
                ws.close();
            },
        });
        const samples = await collect(new ElevenLabsSpeech().speak(turbo(el.base, { lang: 'ar-KW', expression: 'expressive' })));
        expect(samples).toEqual([1000, -2000, 3000]);
        expect(el.upgrades).toHaveLength(1);
        const url = new URL(el.upgrades[0].url!, 'ws://x');
        expect(url.pathname).toBe('/v1/text-to-dialogue/stream-input');
        // Numbers, dates and amounts read as words: the reply's text is also the chat's, so it can't be written out for the voice
        expect(Object.fromEntries(url.searchParams)).toEqual({ model_id: 'eleven_v4_turbo', output_format: 'pcm_24000', apply_text_normalization: 'on', language_code: 'ar' });
        expect(el.upgrades[0].key).toBe(KEY);
        expect(el.messages).toEqual([
            { voices: ['voice/1'], voice_settings: { stability: 0.3 } },
            { inputs: [{ text: 'Hello there', voice_id: 'voice/1' }] },
            { close_socket: true },
        ]);
        // The key is only in the header, never in a message
        expect(JSON.stringify(el.messages)).not.toContain(KEY);
    });

    it('sends no voice settings for natural, and uses the v3 presets on v3 Conversational', async () => {
        const end = (send: (m: object) => void) => send({ is_final: true });
        const el = await fakeDialogue({ onClose: end });
        await collect(new ElevenLabsSpeech().speak(turbo(el.base)));
        await collect(new ElevenLabsSpeech().speak(request(el.base, { expression: 'restrained' }, { model: 'eleven_v3_conversational' })));
        expect(el.messages.filter((m) => 'voices' in m)).toEqual([{ voices: ['voice/1'] }, { voices: ['voice/1'], voice_settings: { stability: 1 } }]);
    });

    it.each([
        ['authentication_required', 401],
        ['quota_exceeded', 401],
        ['too_many_concurrent_requests', 429],
        ['something_new', undefined],
    ])('fails when ElevenLabs answers %s, with status %s', async (error, status) => {
        const el = await fakeDialogue({ onClose: (send, ws) => (send({ error, message: 'no', code: 1008 }), ws.close(1008)) });
        const failure = await collect(new ElevenLabsSpeech().speak(turbo(el.base))).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(status);
        expect(`${(failure as Error).message} ${JSON.stringify(failure)}`).not.toContain(KEY);
    });

    it('fails with the status when the socket is refused before it opens', async () => {
        const el = await fakeDialogue({ refuse: 401 });
        const failure = await collect(new ElevenLabsSpeech().speak(turbo(el.base))).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBe(401);
    });

    it('fails without a status when ElevenLabs cannot be reached', async () => {
        const failure = await collect(new ElevenLabsSpeech().speak(turbo('http://127.0.0.1:1'))).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBeUndefined();
    });

    it('fails without a status when the socket closes before the last audio, after the audio it gave', async () => {
        const el = await fakeDialogue({ onClose: (send, ws) => (send({ audio: b64(pcm(5, 6)) }), setTimeout(() => ws.terminate(), 20)) });
        const got: number[] = [];
        const failure = await (async () => {
            for await (const chunk of new ElevenLabsSpeech().speak(turbo(el.base))) got.push(...chunk);
        })().catch((e: unknown) => e);
        expect(got).toEqual([5, 6]);
        expect(failure).toBeInstanceOf(ProviderError);
        expect((failure as ProviderError).status).toBeUndefined();
    });

    it('closes the socket quietly when the reply is no longer wanted', async () => {
        const el = await fakeDialogue({ onClose: (send) => send({ audio: b64(pcm(7)) }) });
        const abort = new AbortController();
        const got: number[] = [];
        for await (const chunk of new ElevenLabsSpeech().speak(turbo(el.base, { signal: abort.signal }))) {
            got.push(...chunk);
            abort.abort();
        }
        expect(got).toEqual([7]);
        await waitFor('the socket to be closed', () => el.closed);
    });

    it('stops quietly when the reply was cancelled before the socket opened', async () => {
        const el = await fakeDialogue({ onClose: (send) => send({ audio: b64(pcm(7)) }) });
        const abort = new AbortController();
        const stream = new ElevenLabsSpeech().speak(turbo(el.base, { signal: abort.signal }));
        abort.abort();
        expect(await collect(stream)).toEqual([]);
    });
});

describe('getting Eleven v4 Turbo ready before the reply', () => {
    const turbo = (base: string, extra: Partial<SpeechRequest> = {}, settings: object = {}) => request(base, extra, { model: 'eleven_v4_turbo', ...settings });

    it('opens and sets up the socket when someone starts talking, then speaks the reply on it', async () => {
        const el = await fakeDialogue({ onClose: (send, ws) => (send({ audio: b64(pcm(4, 5)) }), send({ is_final: true }), ws.close()) });
        const speech = new ElevenLabsSpeech();
        const reply = turbo(el.base, { expression: 'restrained' });
        speech.prepare({ settings: reply.settings, expression: 'restrained' });
        await waitFor('the socket to be set up', () => el.messages.length === 1);
        // Set up, nothing to speak yet
        expect(el.messages).toEqual([{ voices: ['voice/1'], voice_settings: { stability: 0.75 } }]);
        expect(await collect(speech.speak(reply))).toEqual([4, 5]);
        expect(el.upgrades).toHaveLength(1);
        expect(el.messages.slice(1)).toEqual([{ inputs: [{ text: 'Hello there', voice_id: 'voice/1' }] }, { close_socket: true }]);
    });

    it('keeps one ready socket per bubble however often people start talking', async () => {
        const el = await fakeDialogue();
        const speech = new ElevenLabsSpeech();
        const { settings } = turbo(el.base);
        speech.prepare({ settings });
        speech.prepare({ settings });
        await waitFor('the socket to be set up', () => el.messages.length === 1);
        speech.prepare({ settings });
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(el.upgrades).toHaveLength(1);
        speech.release(settings);
        await waitFor('the socket to be closed', () => el.closed);
    });

    it('opens a new socket when the reply is in another language than the ready one', async () => {
        const el = await fakeDialogue({ onClose: (send) => send({ is_final: true }) });
        const speech = new ElevenLabsSpeech();
        const reply = turbo(el.base, { lang: 'fr' }, { language: 'ar' });
        speech.prepare({ settings: reply.settings, lang: 'ar' });
        await waitFor('the socket to be set up', () => el.messages.length === 1);
        await collect(speech.speak(reply));
        expect(el.upgrades.map((u) => new URL(u.url!, 'ws://x').searchParams.get('language_code'))).toEqual(['ar', 'fr']);
    });

    it('does not use a ready socket that failed, and opens a fresh one', async () => {
        const el = await fakeDialogue({
            onClose: (send) => {
                send({ audio: b64(pcm(9)) });
                send({ is_final: true });
            },
        });
        const speech = new ElevenLabsSpeech();
        const reply = turbo(el.base);
        speech.prepare({ settings: reply.settings });
        await waitFor('the socket to be set up', () => el.messages.length === 1);
        // ElevenLabs drops it while it waits
        el.dropAll();
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(await collect(speech.speak(reply))).toEqual([9]);
        expect(el.upgrades).toHaveLength(2);
    });

    it('says it is still there while it waits, and closes when no reply comes', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'] });
        try {
            const el = await fakeDialogue();
            const speech = new ElevenLabsSpeech();
            speech.prepare({ settings: turbo(el.base).settings });
            await vi.waitFor(() => expect(el.messages).toHaveLength(1));
            await vi.advanceTimersByTimeAsync(10_000);
            await vi.waitFor(() => expect(el.messages).toContainEqual({ keep_alive: true }));
            await vi.advanceTimersByTimeAsync(WARM_SOCKET_MS);
            await vi.waitFor(() => expect(el.closed).toBe(true));
        } finally {
            vi.useRealTimers();
        }
    });

    it('opens nothing ahead for a model that streams over HTTP', () => {
        const speech = new ElevenLabsSpeech();
        // Nothing listens there: opening a socket would fail loudly in the test
        expect(() => speech.prepare({ settings: request('http://127.0.0.1:1').settings })).not.toThrow();
    });
});
