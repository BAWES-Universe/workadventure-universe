/**
 * "Hear <bot> say hello" (#1852): the bot writes a hello with its own brain and the voice worker speaks it once for the maker. These
 * check who pays (the maker's voice reply on Universe AI, a lent key's characters otherwise), that nothing is counted for a hello
 * that was not heard, that the bot's own words and the bubble's own voice settings are used, and that nothing carries a key.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/BotManager', () => ({ BotManager: class {} }));
vi.mock('../server/BotRegistry', () => ({ BotRegistry: class {} }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { BotAPI } from '../server/BotAPI';
import {
    HELLO_MAX_SECONDS,
    VoiceHello,
    helloWords,
    previewAtWorker,
    workerPreviewUrl,
    type HelloPorts,
    type HelloPreviewAnswer,
    type HelloPreviewRequest,
} from '../voice/VoiceHello';
import type { ActiveVoice, SessionSettings, SpeakingNow, VoiceSettings } from '../voice/VoiceSettings';

const KEY = 'sk-eleven-hello-key-123';
const WAV = Buffer.from('RIFF....WAVEdata');

const speaking = (owner: boolean, language?: string): SpeakingNow => ({
    speaks: true,
    signature: 'one',
    providers: { recognition: { providerId: 'ears', owner }, speech: { providerId: 'voice-key', owner } },
    profile: { recognitionModel: 'stt-rt-v6', speechModel: 'eleven_v4_turbo', voiceId: 'sarah', expression: 'natural', ...(language ? { language } : {}) },
});

const session = (): SessionSettings => ({
    recognition: { adapter: 'soniox', model: 'stt-rt-v6', key: 'ears-key' },
    speech: { adapter: 'elevenlabs', model: 'eleven_v4_turbo', voiceId: 'sarah', key: KEY },
    expression: 'natural',
});

function hello(options: {
    active?: ActiveVoice;
    owner?: boolean;
    language?: string;
    settings?: SessionSettings | null;
    bot?: Awaited<ReturnType<HelloPorts['bot']>>;
    allowance?: Awaited<ReturnType<HelloPorts['allowance']['checkVoiceAllowance']>>;
    written?: string | (() => Promise<string>);
    preview?: HelloPreviewAnswer | (() => Promise<HelloPreviewAnswer>);
} = {}) {
    const report = vi.fn();
    const voice: VoiceSettings = {
        active: vi.fn(async () => options.active ?? speaking(options.owner ?? false, options.language)),
        sessionSettings: vi.fn(async () => (options.settings === undefined ? session() : options.settings)),
        report,
    };
    const checkVoiceAllowance = vi.fn(async () => (options.allowance === undefined ? { allowed: true as const, left: 17 } : options.allowance));
    const releaseVoiceReply = vi.fn(async () => true as boolean | null);
    const write = vi.fn(async (_ref: string, _system: string, _user: string, _botId: string, _ms: number) =>
        typeof options.written === 'function' ? options.written() : (options.written ?? 'Hi, I am Hala. What can I get you?')
    );
    const preview = vi.fn(async (_request: HelloPreviewRequest, _ms: number): Promise<HelloPreviewAnswer> =>
        typeof options.preview === 'function' ? options.preview() : (options.preview ?? { ok: true, wav: WAV, ms: 2300 })
    );
    let n = 0;
    const ports: HelloPorts = {
        voice: () => voice,
        allowance: { checkVoiceAllowance, releaseVoiceReply },
        bot: async () => (options.bot === undefined ? { name: 'Hala', chatInstructions: 'You work at Zaatar & Co. and take orders.', aiProviderRef: 'universe-ai' } : options.bot),
        write,
        preview,
        newId: () => `id${++n}`,
    };
    return { hello: new VoiceHello(ports), voice, report, checkVoiceAllowance, releaseVoiceReply, write, preview };
}

const say = (h: VoiceHello, extra: Partial<{ locale: string; personId: string }> = {}) => h.say({ botId: 'hala', personId: 'maker-uuid', ...extra });
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('hearing a bot say hello', () => {
    it('on Universe AI: counts one voice reply for the maker, has the bot write its hello and speaks it with the bot\'s own voice settings', async () => {
        const h = hello({ owner: false });
        const result = await say(h.hello, { locale: 'ar-SA' });
        expect(result).toEqual({ ok: true, text: 'Hi, I am Hala. What can I get you?', wav: WAV, ms: 2300 });
        // One reply counted, for the maker as a signed-in person, under an id of its own
        expect(h.checkVoiceAllowance).toHaveBeenCalledTimes(1);
        expect(h.checkVoiceAllowance).toHaveBeenCalledWith('hala', { userId: 'maker-uuid', isGuest: false, turnId: 'hello-id1' });
        // The bot's own instructions and name, on its own AI, in the language the maker reads the game in
        const [ref, system, user, botId] = h.write.mock.calls[0];
        expect([ref, botId]).toEqual(['universe-ai', 'hala']);
        expect(system).toContain('You work at Zaatar & Co. and take orders.');
        expect(system).toContain('Your name is Hala.');
        expect(user).toContain('Arabic');
        // Spoken exactly as a bubble would: the provider, model, voice and key of the session, and the style
        const [request] = h.preview.mock.calls[0];
        expect(request).toEqual({ speech: session().speech, text: 'Hi, I am Hala. What can I get you?', expression: 'natural', maxSeconds: HELLO_MAX_SECONDS });
        // Heard, so nothing is given back
        await flush();
        expect(h.releaseVoiceReply).not.toHaveBeenCalled();
        expect(h.report).not.toHaveBeenCalled();
    });

    it('on a lent key: counts nothing against the maker, and tells Orbit the key worked', async () => {
        const h = hello({ owner: true });
        expect((await say(h.hello)).ok).toBe(true);
        expect(h.checkVoiceAllowance).not.toHaveBeenCalled();
        expect(h.report).toHaveBeenCalledWith('voice-key', 'speech', { ok: true });
    });

    it('says the language a bot is set to speak, whatever the game is read in', async () => {
        const h = hello({ language: 'ar-KW' });
        await say(h.hello, { locale: 'en-US' });
        expect(h.write.mock.calls[0][2]).toContain('"ar-KW"');
        expect(h.write.mock.calls[0][2]).not.toContain('English');
    });

    it('leaves the language to the bot\'s instructions when it is not set to one and the game language is not known', async () => {
        const h = hello();
        await say(h.hello, { locale: 'not a locale' });
        expect(h.write.mock.calls[0][2]).toContain('language your instructions use');
    });

    it('is not made when the maker\'s voice replies are used up, and says when they come back', async () => {
        const h = hello({ allowance: { allowed: false, resetsAt: '2026-11-06T18:40:00.000Z' } });
        expect(await say(h.hello)).toEqual({ ok: false, status: 429, error: 'used_up', resetsAt: '2026-11-06T18:40:00.000Z' });
        expect(h.write).not.toHaveBeenCalled();
        expect(h.preview).not.toHaveBeenCalled();
        expect(h.releaseVoiceReply).not.toHaveBeenCalled();
    });

    it('says nothing out loud when Orbit cannot settle the allowance', async () => {
        const h = hello({ allowance: null });
        expect(await say(h.hello)).toEqual({ ok: false, status: 503, error: 'unavailable' });
        expect(h.write).not.toHaveBeenCalled();
    });

    it('gives the counted reply back when the bot writes nothing', async () => {
        const h = hello({ written: '' });
        expect(await say(h.hello)).toEqual({ ok: false, status: 502, error: 'no_words' });
        await flush();
        expect(h.releaseVoiceReply).toHaveBeenCalledWith('hala', { turnId: 'hello-id1' });
        expect(h.preview).not.toHaveBeenCalled();
    });

    it('treats an AI that throws as having written nothing', async () => {
        const h = hello({ written: () => Promise.reject(new Error('boom')) });
        expect(await say(h.hello)).toEqual({ ok: false, status: 502, error: 'no_words' });
        await flush();
        expect(h.releaseVoiceReply).toHaveBeenCalledTimes(1);
    });

    it('gives the counted reply back when the voice company fails, and passes its status on', async () => {
        const h = hello({ preview: { ok: false, kind: 'provider', status: 402, rejected: false } });
        expect(await say(h.hello)).toEqual({ ok: false, status: 502, error: 'provider', providerStatus: 402, rejected: false });
        await flush();
        expect(h.releaseVoiceReply).toHaveBeenCalledWith('hala', { turnId: 'hello-id1' });
    });

    it('tells Orbit when a lent key is refused (so the key shows as not working), and gives nothing back as nothing was counted', async () => {
        const h = hello({ owner: true, preview: { ok: false, kind: 'provider', status: 401, rejected: true } });
        const result = await say(h.hello);
        expect(result).toEqual({ ok: false, status: 502, error: 'provider', providerStatus: 401, rejected: true });
        expect(h.report).toHaveBeenCalledWith('voice-key', 'speech', { ok: false, status: 401, rejected: true });
        await flush();
        expect(h.releaseVoiceReply).not.toHaveBeenCalled();
    });

    it.each<[string, HelloPreviewAnswer]>([
        ['the worker is busy', { ok: false, kind: 'busy' }],
        ['the worker cannot be reached', { ok: false, kind: 'down' }],
        ['the worker refuses the request', { ok: false, kind: 'refused' }],
    ])('is not available, with the reply given back, when %s', async (_name, preview) => {
        const h = hello({ preview });
        expect(await say(h.hello)).toEqual({ ok: false, status: 503, error: 'unavailable' });
        await flush();
        expect(h.releaseVoiceReply).toHaveBeenCalledTimes(1);
    });

    it('does not speak when the bot\'s voice is off, and says Orbit\'s reason', async () => {
        const h = hello({ active: { speaks: false, reason: 'universe-off' } });
        expect(await say(h.hello)).toEqual({ ok: false, status: 409, error: 'voice_off', reason: 'universe-off' });
        expect(h.checkVoiceAllowance).not.toHaveBeenCalled();
        expect(h.write).not.toHaveBeenCalled();
    });

    it('is not available when Orbit cannot be asked or the keys cannot be read, and not found for an unknown bot', async () => {
        expect(await say(hello({ active: { speaks: false, reason: 'orbit' } }).hello)).toEqual({ ok: false, status: 503, error: 'unavailable' });
        expect(await say(hello({ settings: null }).hello)).toEqual({ ok: false, status: 503, error: 'unavailable' });
        expect(await say(hello({ active: { speaks: false, reason: 'unknown-bot' } }).hello)).toEqual({ ok: false, status: 404, error: 'unknown_bot' });
        expect(await say(hello({ bot: null }).hello)).toEqual({ ok: false, status: 404, error: 'unknown_bot' });
    });

    it('writes nothing for a bot with no AI to write with, and counts nothing', async () => {
        const h = hello({ bot: { name: 'Hala' } });
        expect(await say(h.hello)).toEqual({ ok: false, status: 502, error: 'no_words' });
        expect(h.checkVoiceAllowance).not.toHaveBeenCalled();
    });

    it('makes one hello at a time for a person and bot, and lets another person make theirs', async () => {
        const finishers: Array<() => void> = [];
        const h = hello({ preview: () => new Promise((resolve) => finishers.push(() => resolve({ ok: true, wav: WAV, ms: 1 }))) });
        const first = say(h.hello);
        await flush();
        await flush();
        expect(await say(h.hello)).toEqual({ ok: false, status: 429, error: 'busy' });
        const other = say(h.hello, { personId: 'co-manager-uuid' });
        await flush();
        await flush();
        expect(finishers).toHaveLength(2);
        finishers.forEach((finish) => finish());
        expect((await first).ok).toBe(true);
        expect((await other).ok).toBe(true);
        // Free again once it is done
        h.preview.mockImplementation(async () => ({ ok: true, wav: WAV, ms: 1 }));
        expect((await say(h.hello)).ok).toBe(true);
        // The refused one counted nothing
        expect(h.checkVoiceAllowance).toHaveBeenCalledTimes(3);
    });

    it('never puts the key or the bot\'s instructions in anything it answers', async () => {
        const failing = await say(hello({ preview: { ok: false, kind: 'provider', status: 401, rejected: true } }).hello);
        const refused = await say(hello({ allowance: { allowed: false, resetsAt: '2026-11-06T18:40:00.000Z' } }).hello);
        for (const answer of [failing, refused]) {
            expect(JSON.stringify(answer)).not.toContain(KEY);
            expect(JSON.stringify(answer)).not.toContain('Zaatar');
        }
    });
});

describe('the words that are spoken', () => {
    it('are the bot\'s own, without markup, quotation marks or an emotion block', () => {
        expect(helloWords('"Hello there, I\'m **Hala**!"')).toBe("Hello there, I'm Hala!");
        expect(helloWords('Hi!\n\n[EMOTION_UPDATE]{"personSentiment":5}[/EMOTION_UPDATE]')).toBe('Hi!');
        expect(helloWords('  \n ')).toBe('');
        expect(helloWords('مرحبا، أنا هالة. كيف أخدمك؟')).toBe('مرحبا، أنا هالة. كيف أخدمك؟');
    });

    it('stop at whole sentences when the bot goes on, and never say the rest is in the chat', () => {
        const long = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i}.`).join(' ');
        const words = helloWords(long);
        expect(words.length).toBeLessThanOrEqual(400);
        expect(words.endsWith('.')).toBe(true);
        expect(words).not.toContain('chat');
    });
});

describe('asking the worker', () => {
    const request: HelloPreviewRequest = { speech: session().speech, text: 'Hello', expression: 'natural', maxSeconds: 20 };
    const servers: http.Server[] = [];
    afterEach(async () => {
        for (const s of servers.splice(0)) {
            s.closeAllConnections();
            await new Promise((resolve) => s.close(resolve));
        }
    });

    async function worker(reply: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
        const seen: { url?: string; method?: string; authorization?: string; body: string }[] = [];
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (d) => (body += d));
            req.on('end', () => {
                seen.push({ url: req.url, method: req.method, authorization: req.headers.authorization, body });
                reply(req, res, body);
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        servers.push(server);
        return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/preview`, seen };
    }

    it('sends the settings with the worker\'s secret and takes the audio and its length', async () => {
        const w = await worker((_req, res) => (res.writeHead(200, { 'content-type': 'audio/wav', 'x-audio-ms': '2300' }), res.end(WAV)));
        const answer = await previewAtWorker(w.url, 'worker-secret', request, 2000);
        expect(answer).toEqual({ ok: true, wav: WAV, ms: 2300 });
        expect(w.seen).toHaveLength(1);
        expect(w.seen[0]).toMatchObject({ method: 'POST', url: '/preview', authorization: 'Bearer worker-secret' });
        expect(JSON.parse(w.seen[0].body)).toEqual(request);
    });

    it('reads the worker\'s answers: the voice company\'s failure, too many at once, a refusal', async () => {
        const answers: [number, object, HelloPreviewAnswer][] = [
            [502, { error: 'provider', status: 401, rejected: true }, { ok: false, kind: 'provider', status: 401, rejected: true }],
            [502, { error: 'provider', rejected: false }, { ok: false, kind: 'provider', rejected: false }],
            [429, { error: 'busy' }, { ok: false, kind: 'busy' }],
            [401, { error: 'unauthorized' }, { ok: false, kind: 'refused' }],
            [400, { error: 'no_adapter' }, { ok: false, kind: 'refused' }],
            [404, { error: 'not found' }, { ok: false, kind: 'refused' }],
        ];
        for (const [status, body, expected] of answers) {
            const w = await worker((_req, res) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body))));
            expect(await previewAtWorker(w.url, undefined, request, 2000)).toEqual(expected);
        }
    });

    it('says the worker is down when it cannot be reached or takes too long, and never throws', async () => {
        expect(await previewAtWorker('http://127.0.0.1:1/preview', 'x', request, 500)).toEqual({ ok: false, kind: 'down' });
        const slow = await worker(() => undefined);
        expect(await previewAtWorker(slow.url, 'x', request, 100)).toEqual({ ok: false, kind: 'down' });
    });

    it('finds the worker\'s preview address next to its bridge address', () => {
        expect(workerPreviewUrl('ws://voice-worker:8830')).toBe('http://voice-worker:8830/preview');
        expect(workerPreviewUrl('wss://voice.example.com/worker?x=1')).toBe('https://voice.example.com/preview');
        expect(workerPreviewUrl('wss://voice.example.com/worker/')).toBe('https://voice.example.com/worker/preview');
    });
});

describe('the route', () => {
    const SESSION = `orb_sess_v2_${'a'.repeat(64)}`;
    const servers: http.Server[] = [];
    afterEach(() => servers.splice(0).forEach((s) => s.close()));

    async function api(options: { hello?: { say: ReturnType<typeof vi.fn> } | null; manager?: boolean; session?: boolean } = {}) {
        const admin: any = {
            validateSessionToken: vi.fn(async () => (options.session === false ? null : { uuid: 'maker-uuid', email: 'maker@example.com' })),
            canSessionManageBot: vi.fn(async () => options.manager !== false),
        };
        const server = new (BotAPI as any)({} as any, admin, {} as any, [], { voiceHello: options.hello === undefined ? null : options.hello }).app.listen(0) as http.Server;
        servers.push(server);
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const post = (body: unknown = {}, headers: Record<string, string> = { Authorization: `Bearer ${SESSION}` }) =>
            fetch(`${base}/api/bots/hala/voice/hello`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
        return { post, admin };
    }

    it('gives the audio as base64 with the words, for the person behind the session', async () => {
        const say = vi.fn(async () => ({ ok: true, text: 'Hi, I am Hala.', wav: WAV, ms: 2300 }));
        const { post } = await api({ hello: { say } });
        const response = await post({ locale: 'ar-SA' });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ text: 'Hi, I am Hala.', mime: 'audio/wav', audio: WAV.toString('base64'), ms: 2300 });
        expect(say).toHaveBeenCalledWith({ botId: 'hala', personId: 'maker-uuid', locale: 'ar-SA' });
    });

    it('answers a failure with its status and its reason, and nothing else', async () => {
        const say = vi.fn(async () => ({ ok: false, status: 429, error: 'used_up', resetsAt: '2026-11-06T18:40:00.000Z' }));
        const { post } = await api({ hello: { say } });
        const response = await post();
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ error: 'used_up', resetsAt: '2026-11-06T18:40:00.000Z' });
    });

    it('is only for people who manage the bot, signed in', async () => {
        const say = vi.fn();
        expect((await (await api({ hello: { say }, manager: false })).post()).status).toBe(403);
        expect((await (await api({ hello: { say }, session: false })).post()).status).toBe(401);
        expect((await (await api({ hello: { say } })).post({}, {})).status).toBe(401);
        expect(say).not.toHaveBeenCalled();
    });

    it('is not available where voice is not set up', async () => {
        const { post } = await api({ hello: null });
        const response = await post();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'unavailable' });
    });

    it('answers a hello that blew up with a plain failure, not what the error held', async () => {
        const say = vi.fn(async () => {
            throw new Error(`the key ${KEY} was refused`);
        });
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { post } = await api({ hello: { say } });
        const response = await post();
        const text = await response.text();
        expect(response.status).toBe(500);
        expect(text).not.toContain(KEY);
        expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
        log.mockRestore();
    });
});
