// One line spoken outside a bubble (#1852), through the worker's /preview. The providers are stand-ins on loopback: no key, no network, no spend.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ConnectorRegistry, ProviderError, type SpeechConnector } from '../src/connectors.ts';
import { FAKE_ADAPTER, FakeSpeech } from '../src/fakeSpeech.ts';
import { readPreviewRequest, wavOf } from '../src/preview.ts';
import { VoiceWorker, type WorkerOptions } from '../src/server.ts';
import { waitFor } from './harness.ts';

const KEY = 'sk-eleven-preview-key-789';
const base: WorkerOptions = { port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } };

const workers: VoiceWorker[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
    for (const w of workers.splice(0)) await w.close();
    for (const s of servers.splice(0)) {
        s.closeAllConnections();
        await new Promise((resolve) => s.close(resolve));
    }
});

async function start(options: Partial<WorkerOptions> = {}): Promise<{ worker: VoiceWorker; url: string }> {
    const worker = new VoiceWorker({ ...base, ...options });
    workers.push(worker);
    const port = await worker.listen();
    return { worker, url: `http://127.0.0.1:${port}` };
}

const speech = (extra: Record<string, unknown> = {}) => ({ adapter: FAKE_ADAPTER, model: 'fake', voiceId: 'v', key: KEY, ...extra });

async function ask(url: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${url}/preview`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

/** A stand-in ElevenLabs that serves both calls: the HTTP stream, and the Text to Dialogue WebSocket Eleven v4 Turbo needs. */
async function fakeElevenLabs(audio: Buffer, options: { refuse?: number } = {}) {
    const seen: { url?: string; key?: string | string[]; frames: Record<string, unknown>[] }[] = [];
    const server = http.createServer((req, res) => {
        const entry = { url: req.url, key: req.headers['xi-api-key'], frames: [] as Record<string, unknown>[] };
        seen.push(entry);
        req.on('data', () => undefined);
        req.on('end', () => res.end(audio));
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        const entry = { url: req.url, key: req.headers['xi-api-key'], frames: [] as Record<string, unknown>[] };
        seen.push(entry);
        if (options.refuse) {
            socket.end(`HTTP/1.1 ${options.refuse} Refused\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.on('message', (data) => {
                const frame = JSON.parse(data.toString()) as Record<string, unknown>;
                entry.frames.push(frame);
                if (frame.close_socket === true) {
                    ws.send(JSON.stringify({ audio: audio.toString('base64') }));
                    ws.send(JSON.stringify({ is_final: true }));
                    ws.close();
                }
            });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return { endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

/** s16 little-endian audio of `ms` of a steady tone, as a provider would send it. */
function tone(ms: number): Buffer {
    const samples = new Int16Array((24000 * ms) / 1000).map((_, i) => Math.round(8000 * Math.sin(i / 10)));
    return Buffer.from(samples.buffer);
}

describe('the worker speaks one line on its own', () => {
    it('answers a WAV of 24 kHz mono audio, made by the connector the bubble would use', async () => {
        const { url } = await start();
        const response = await ask(url, { speech: speech(), text: 'Hi, I am Hala.' });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('audio/wav');
        const wav = Buffer.from(await response.arrayBuffer());
        expect(wav.subarray(0, 4).toString()).toBe('RIFF');
        expect(wav.subarray(8, 12).toString()).toBe('WAVE');
        expect(wav.readUInt16LE(22)).toBe(1);
        expect(wav.readUInt32LE(24)).toBe(24000);
        expect(wav.readUInt16LE(34)).toBe(16);
        const dataBytes = wav.readUInt32LE(40);
        expect(wav.length).toBe(44 + dataBytes);
        // What the test engine makes for this line, to the sample
        const made = new FakeSpeech().synth('Hi, I am Hala.');
        expect(dataBytes).toBe(made.length * 2);
        expect(Number(response.headers.get('x-audio-ms'))).toBe(Math.round((made.length / 24000) * 1000));
        expect([...new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length))].slice(0, 2000)).toEqual([...made.subarray(0, 2000)]);
    });

    it('speaks with Eleven v4 Turbo over the Text to Dialogue WebSocket, with the key only in the header', async () => {
        const el = await fakeElevenLabs(tone(500));
        const { url, worker } = await start();
        const response = await ask(url, {
            speech: speech({ adapter: 'elevenlabs', model: 'eleven_v4_turbo', voiceId: 'voice/9', endpoint: el.endpoint }),
            text: 'Welcome to Zaatar & Co.',
            lang: 'ar-KW',
            expression: 'expressive',
        });
        expect(response.status).toBe(200);
        const wav = Buffer.from(await response.arrayBuffer());
        expect(wav.length).toBe(44 + 24000);
        expect(el.seen).toHaveLength(1);
        const url1 = new URL(el.seen[0].url!, 'ws://x');
        expect(url1.pathname).toBe('/v1/text-to-dialogue/stream-input');
        expect(url1.searchParams.get('model_id')).toBe('eleven_v4_turbo');
        expect(url1.searchParams.get('language_code')).toBe('ar');
        expect(el.seen[0].key).toBe(KEY);
        expect(el.seen[0].frames).toEqual([
            { voices: ['voice/9'], voice_settings: { stability: 0.3 } },
            { inputs: [{ text: 'Welcome to Zaatar & Co.', voice_id: 'voice/9' }] },
            { close_socket: true },
        ]);
        expect(JSON.stringify(el.seen[0].frames)).not.toContain(KEY);
        expect(worker.counters.get('previews_made')).toBe(1);
        expect(wav.toString('latin1')).not.toContain(KEY);
    });

    it('speaks with a model served over HTTP too', async () => {
        const el = await fakeElevenLabs(tone(250));
        const { url } = await start();
        const response = await ask(url, { speech: speech({ adapter: 'elevenlabs', model: 'eleven_flash_v2_5', voiceId: 'v1', endpoint: el.endpoint }), text: 'Hello' });
        expect(response.status).toBe(200);
        expect((await response.arrayBuffer()).byteLength).toBe(44 + 12000);
        expect(el.seen[0].url).toBe('/v1/text-to-speech/v1/stream?output_format=pcm_24000');
        expect(el.seen[0].key).toBe(KEY);
    });

    it('stops at the longest a preview may play', async () => {
        const el = await fakeElevenLabs(tone(5000));
        const { url } = await start({ maxPreviewSeconds: 1 });
        const response = await ask(url, { speech: speech({ adapter: 'elevenlabs', model: 'eleven_flash_v2_5', endpoint: el.endpoint }), text: 'A long one', maxSeconds: 30 });
        expect(response.status).toBe(200);
        const bytes = (await response.arrayBuffer()).byteLength - 44;
        expect(bytes).toBeLessThanOrEqual(24000 * 2);
        expect(bytes).toBeGreaterThan(24000);
    });

    it('says the provider refused the key, with its status, and never the key', async () => {
        const el = await fakeElevenLabs(tone(10), { refuse: 401 });
        const { url, worker } = await start();
        const response = await ask(url, { speech: speech({ adapter: 'elevenlabs', model: 'eleven_v4_turbo', endpoint: el.endpoint }), text: 'Hello' });
        expect(response.status).toBe(502);
        const text = await response.text();
        expect(JSON.parse(text)).toEqual({ error: 'provider', status: 401, rejected: true });
        expect(text).not.toContain(KEY);
        expect(worker.counters.get('previews_failed')).toBe(1);
    });

    it('says a provider that could not be reached failed, with no status', async () => {
        const { url } = await start();
        const response = await ask(url, { speech: speech({ adapter: 'elevenlabs', model: 'eleven_v4_turbo', endpoint: 'http://127.0.0.1:1' }), text: 'Hello' });
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: 'provider', rejected: false });
    });

    it('says a provider that makes no audio failed', async () => {
        const silent: SpeechConnector = { speak: async function* () {} };
        const { url } = await start({ connectors: new ConnectorRegistry().registerSpeech('silent', silent) });
        const response = await ask(url, { speech: speech({ adapter: 'silent' }), text: 'Hello' });
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: 'provider', rejected: false });
    });

    it('keeps a provider failure that has a status (402: out of credit)', async () => {
        const broke: SpeechConnector = {
            // eslint-disable-next-line require-yield
            speak: async function* () {
                throw new ProviderError('no credit', 402);
            },
        };
        const { url } = await start({ connectors: new ConnectorRegistry().registerSpeech('broke', broke) });
        const response = await ask(url, { speech: speech({ adapter: 'broke' }), text: 'Hello' });
        expect(await response.json()).toEqual({ error: 'provider', status: 402, rejected: false });
    });

    it('refuses an adapter the worker does not have', async () => {
        const { url } = await start();
        const response = await ask(url, { speech: speech({ adapter: 'nobody' }), text: 'Hello' });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'no_adapter' });
    });

    it('tells a preview beyond the limit to come back, and serves it once there is room', async () => {
        let release: () => void = () => undefined;
        const slow: SpeechConnector = {
            speak: async function* () {
                await new Promise<void>((resolve) => (release = resolve));
                yield new Int16Array(480);
            },
        };
        const { url } = await start({ maxPreviews: 1, connectors: new ConnectorRegistry().registerSpeech('slow', slow) });
        const first = ask(url, { speech: speech({ adapter: 'slow' }), text: 'One' });
        await waitFor('the first to be waiting on its provider', () => release !== undefined && true);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const second = await ask(url, { speech: speech({ adapter: 'slow' }), text: 'Two' });
        expect(second.status).toBe(429);
        expect(await second.json()).toEqual({ error: 'busy' });
        release();
        expect((await first).status).toBe(200);
    });

    it('closes the provider call when the asker goes away', async () => {
        let aborted = false;
        const hang: SpeechConnector = {
            speak: async function* (request) {
                request.signal.addEventListener('abort', () => (aborted = true));
                await new Promise((resolve) => setTimeout(resolve, 5000));
                yield new Int16Array(480);
            },
        };
        const { url } = await start({ connectors: new ConnectorRegistry().registerSpeech('hang', hang) });
        const stop = new AbortController();
        const asking = fetch(`${url}/preview`, { method: 'POST', body: JSON.stringify({ speech: speech({ adapter: 'hang' }), text: 'Hello' }), signal: stop.signal }).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 50));
        stop.abort();
        await asking;
        await waitFor('the provider call to be closed', () => aborted);
    });

    it('wants the secret when the worker has one', async () => {
        const { url } = await start({ secret: 'worker-secret' });
        expect((await ask(url, { speech: speech(), text: 'Hello' })).status).toBe(401);
        expect((await ask(url, { speech: speech(), text: 'Hello' }, { authorization: 'Bearer wrong' })).status).toBe(401);
        expect((await ask(url, { speech: speech(), text: 'Hello' }, { authorization: 'Bearer worker-secret' })).status).toBe(200);
    });

    it('reads a line whose characters arrive split across two pieces of the request', async () => {
        const { url } = await start();
        const text = 'مرحبًا يا Universe. هذا هو صوتي.';
        const bytes = Buffer.from(JSON.stringify({ speech: speech(), text }));
        // Cut in the middle of the first Arabic letter, which takes two bytes
        const cut = bytes.indexOf(Buffer.from('مرحبًا')) + 1;
        const wav = await new Promise<Buffer>((resolve, reject) => {
            const req = http.request(`${url}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
                const parts: Buffer[] = [];
                res.on('data', (part: Buffer) => parts.push(part));
                res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(parts)) : reject(new Error(`status ${res.statusCode}`))));
            });
            req.on('error', reject);
            req.write(bytes.subarray(0, cut));
            setTimeout(() => req.end(bytes.subarray(cut)), 50);
        });
        // The very samples the test engine makes for the line as it was written
        expect(wav.readUInt32LE(40)).toBe(new FakeSpeech().synth(text).length * 2);
        expect(wav.readUInt32LE(40)).not.toBe(new FakeSpeech().synth(text.replace('م', '\uFFFD\uFFFD')).length * 2);
    });

    it('refuses what is not a usable request', async () => {
        const { url } = await start();
        expect((await ask(url, 'not json')).status).toBe(400);
        expect((await ask(url, { text: 'Hello' })).status).toBe(400);
        expect((await ask(url, { speech: speech(), text: '   ' })).status).toBe(400);
        expect((await ask(url, { speech: speech(), text: 'x'.repeat(1001) })).status).toBe(400);
        expect((await ask(url, { speech: speech(), text: 'Hello', expression: 'shouting' })).status).toBe(400);
        expect((await ask(url, { speech: speech({ key: '' }), text: 'Hello' })).status).toBe(400);
        expect((await ask(url, { speech: speech(), text: 'x', pad: 'y'.repeat(20000) })).status).toBe(413);
        expect((await fetch(`${url}/preview`)).status).toBe(405);
    });
});

describe('reading a preview request', () => {
    it('keeps only the fields it knows and returns a reason (never the key) for the rest', () => {
        expect(readPreviewRequest({ speech: speech({ extra: 1 }), text: 'Hi', ignored: true })).toEqual({
            speech: { adapter: 'fake', model: 'fake', voiceId: 'v', key: KEY, endpoint: undefined, region: undefined, language: undefined },
            text: 'Hi',
            lang: undefined,
            expression: undefined,
            maxSeconds: undefined,
        });
        const reason = readPreviewRequest({ speech: speech({ key: 5 }), text: 'Hi' });
        expect(typeof reason).toBe('string');
        expect(String(reason)).not.toContain(KEY);
    });

    it('writes a WAV whose sizes match its samples', () => {
        const wav = wavOf(new Int16Array([1, -1, 300]));
        expect(wav.length).toBe(44 + 6);
        expect(wav.readUInt32LE(4)).toBe(36 + 6);
        expect(wav.readUInt32LE(40)).toBe(6);
        expect(wav.readInt16LE(46)).toBe(-1);
    });
});
