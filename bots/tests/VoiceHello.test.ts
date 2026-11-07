/**
 * "Hear this voice say hello" (#1852): the voice worker says one short fixed line with the bot's voice for the maker, and a hello
 * made a moment ago for the same voice is played again. These check who pays (the maker's voice reply on Universe AI the first time,
 * a lent key's characters otherwise, nothing for one that is played again), that nothing is counted for a hello that was not
 * heard, that the bubble's own voice settings are used, and that nothing carries a key.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/BotManager', () => ({ BotManager: class {} }));
vi.mock('../server/BotRegistry', () => ({ BotRegistry: class {} }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { BotAPI } from '../server/BotAPI';
import { voiceHelloCacheSettings } from '../voice/settings';

import {
    HELLO_LINES,
    HELLO_MAX_SECONDS,
    HelloCache,
    VoiceHello,
    helloLine,
    previewAtWorker,
    helloSourceOf,
    typedVoiceName,
    workerPreviewUrl,
    type HelloCacheSettings,
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
    cache?: HelloCache;
    allowance?: Awaited<ReturnType<HelloPorts['allowance']['checkVoiceAllowance']>>;
    preview?: HelloPreviewAnswer | (() => Promise<HelloPreviewAnswer>);
    /** What the voice of a speech server typed for at the door reads as (see `VoiceSettings.ownSpeech`) */
    ownSpeech?: SessionSettings['speech'] | null;
} = {}) {
    const report = vi.fn();
    const voice: VoiceSettings = {
        active: vi.fn(async () => options.active ?? speaking(options.owner ?? false, options.language)),
        sessionSettings: vi.fn(async () => (options.settings === undefined ? session() : options.settings)),
        report,
        ...(options.ownSpeech !== undefined ? { ownSpeech: vi.fn(async () => options.ownSpeech ?? null) } : {}),
    };
    const checkVoiceAllowance = vi.fn(async () => (options.allowance === undefined ? { allowed: true as const, left: 17 } : options.allowance));
    const releaseVoiceReply = vi.fn(async () => true as boolean | null);
    const preview = vi.fn(async (_request: HelloPreviewRequest, _ms: number): Promise<HelloPreviewAnswer> =>
        typeof options.preview === 'function' ? options.preview() : (options.preview ?? { ok: true, wav: WAV, ms: 2300 })
    );
    let n = 0;
    const ports: HelloPorts = {
        voice: () => voice,
        allowance: { checkVoiceAllowance, releaseVoiceReply },
        preview,
        newId: () => `id${++n}`,
        ...(options.cache ? { cache: options.cache } : {}),
    };
    return { hello: new VoiceHello(ports), voice, report, checkVoiceAllowance, releaseVoiceReply, preview };
}

const say = (h: VoiceHello, extra: Partial<{ locale: string; personId: string; voiceId: string; source: { providerId: string; model: string } }> = {}) => h.say({ botId: 'hala', personId: 'maker-uuid', ...extra });
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('hearing a voice say hello', () => {
    it('on Universe AI: counts one voice reply for the maker and speaks the fixed line with the bot\'s own voice settings', async () => {
        const h = hello({ owner: false });
        const result = await say(h.hello, { locale: 'en-US' });
        expect(result).toEqual({ ok: true, text: HELLO_LINES.en, wav: WAV, ms: 2300 });
        // One reply counted, for the maker as a signed-in person, under an id of its own
        expect(h.checkVoiceAllowance).toHaveBeenCalledTimes(1);
        expect(h.checkVoiceAllowance).toHaveBeenCalledWith('hala', { userId: 'maker-uuid', isGuest: false, turnId: 'hello-id1' });
        // Spoken exactly as a bubble would: the provider, model, voice and key of the session, and the style
        const [request] = h.preview.mock.calls[0];
        expect(request).toEqual({ speech: session().speech, text: HELLO_LINES.en, lang: 'en', expression: 'natural', maxSeconds: HELLO_MAX_SECONDS });
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

    it('names no bot and says nothing a bot would say of itself', () => {
        for (const line of Object.values(HELLO_LINES)) {
            expect(line.length).toBeGreaterThan(10);
            expect(line.length).toBeLessThanOrEqual(80);
            expect(line).toContain('Universe');
        }
    });

    it('says it in the language the voice is set to, else the one the game is read in, else English', async () => {
        expect(helloLine('ar-KW', 'en-US')).toBe(HELLO_LINES.ar);
        expect(helloLine(undefined, 'fr-FR')).toBe(HELLO_LINES.fr);
        expect(helloLine(undefined, 'zh_CN')).toBe(HELLO_LINES.zh);
        // A language there is no line for (or no language at all) falls to the next one, then to English
        expect(helloLine('xx', 'de-DE')).toBe(HELLO_LINES.de);
        expect(helloLine('hsb-DE', 'dsb-DE')).toBe(HELLO_LINES.en);
        expect(helloLine(undefined, 'not a locale')).toBe(HELLO_LINES.en);
        expect(helloLine()).toBe(HELLO_LINES.en);
        const pinned = hello({ language: 'ar-KW' });
        await say(pinned.hello, { locale: 'en-US' });
        expect(pinned.preview.mock.calls[0][0].text).toBe(HELLO_LINES.ar);
        expect(pinned.preview.mock.calls[0][0].lang).toBe('ar');
        const following = hello();
        await say(following.hello, { locale: 'es-ES' });
        expect(following.preview.mock.calls[0][0].text).toBe(HELLO_LINES.es);
        // A voice that follows the person's language is told which one the line is in, so it does not say it with an English model
        expect(following.preview.mock.calls[0][0].lang).toBe('es');
        const noLine = hello();
        await say(noLine.hello, { locale: 'dsb-DE' });
        expect(noLine.preview.mock.calls[0][0]).toMatchObject({ text: HELLO_LINES.en, lang: 'en' });
    });

    it('is not made when the maker\'s voice replies are used up, and says when they come back', async () => {
        const h = hello({ allowance: { allowed: false, resetsAt: '2026-11-06T18:40:00.000Z' } });
        expect(await say(h.hello)).toEqual({ ok: false, status: 429, error: 'used_up', resetsAt: '2026-11-06T18:40:00.000Z' });
        expect(h.preview).not.toHaveBeenCalled();
        expect(h.releaseVoiceReply).not.toHaveBeenCalled();
    });

    it('says nothing out loud when Orbit cannot settle the allowance', async () => {
        const h = hello({ allowance: null });
        expect(await say(h.hello)).toEqual({ ok: false, status: 503, error: 'unavailable' });
        expect(h.preview).not.toHaveBeenCalled();
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
        expect(h.preview).not.toHaveBeenCalled();
    });

    it('is not available when Orbit cannot be asked or the keys cannot be read, and not found for an unknown bot', async () => {
        expect(await say(hello({ active: { speaks: false, reason: 'orbit' } }).hello)).toEqual({ ok: false, status: 503, error: 'unavailable' });
        expect(await say(hello({ settings: null }).hello)).toEqual({ ok: false, status: 503, error: 'unavailable' });
        expect(await say(hello({ active: { speaks: false, reason: 'unknown-bot' } }).hello)).toEqual({ ok: false, status: 404, error: 'unknown_bot' });
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

    it('never puts the key in anything it answers', async () => {
        const failing = await say(hello({ preview: { ok: false, kind: 'provider', status: 401, rejected: true } }).hello);
        const refused = await say(hello({ allowance: { allowed: false, resetsAt: '2026-11-06T18:40:00.000Z' } }).hello);
        for (const answer of [failing, refused]) expect(JSON.stringify(answer)).not.toContain(KEY);
    });
});

describe('keeping a hello so trying a voice again costs nothing (#1852)', () => {
    const minute = 60_000;
    const kept = (over: Parameters<typeof hello>[0] = {}, settings: HelloCacheSettings = { ttlMs: 60 * minute, maxBytes: 1_000_000 }) => {
        let at = 0;
        const cache = new HelloCache(settings, () => at);
        return { ...hello({ ...over, cache }), cache, later: (ms: number) => (at += ms) };
    };

    it('plays the first hello again for the same voice: nothing counted, nothing asked of the voice company', async () => {
        const h = kept();
        expect(await say(h.hello)).toEqual({ ok: true, text: HELLO_LINES.en, wav: WAV, ms: 2300 });
        const again = await say(h.hello);
        expect(again).toEqual({ ok: true, text: HELLO_LINES.en, wav: WAV, ms: 2300, cached: true });
        expect(await say(h.hello, { personId: 'co-manager-uuid' })).toMatchObject({ ok: true, cached: true });
        expect(h.checkVoiceAllowance).toHaveBeenCalledTimes(1);
        expect(h.preview).toHaveBeenCalledTimes(1);
    });

    it('plays it for the maker even when their voice replies are used up, as it costs none', async () => {
        const h = kept();
        await say(h.hello);
        h.checkVoiceAllowance.mockResolvedValue({ allowed: false, resetsAt: '2026-11-06T18:40:00.000Z' } as never);
        expect(await say(h.hello)).toMatchObject({ ok: true, cached: true });
    });

    it('is the same for every bot that has that voice, since the line names none', async () => {
        const h = kept();
        await h.hello.say({ botId: 'hala', personId: 'maker-uuid' });
        expect(await h.hello.say({ botId: 'omar', personId: 'maker-uuid' })).toMatchObject({ ok: true, cached: true });
        expect(h.preview).toHaveBeenCalledTimes(1);
    });

    it.each<[string, (s: SessionSettings) => SessionSettings]>([
        ['the voice', (s) => ({ ...s, speech: { ...s.speech, voiceId: 'omar' } })],
        ['the model', (s) => ({ ...s, speech: { ...s.speech, model: 'eleven_flash_v2_5' } })],
        ['the style', (s) => ({ ...s, expression: 'expressive' as never })],
        ['the language of the voice', (s) => ({ ...s, speech: { ...s.speech, language: 'ar' } })],
        ['the company', (s) => ({ ...s, speech: { ...s.speech, adapter: 'fish' } })],
    ])('is a new hello when %s changes', async (_name, change) => {
        const h = kept();
        await say(h.hello);
        (h.voice.sessionSettings as ReturnType<typeof vi.fn>).mockResolvedValue(change(session()));
        expect(await say(h.hello)).toEqual({ ok: true, text: expect.any(String), wav: WAV, ms: 2300 });
        expect(h.preview).toHaveBeenCalledTimes(2);
    });

    it('is a new hello in another language, and for another lent key, but not when the same key is replaced by a newer one', async () => {
        const h = kept();
        await say(h.hello, { locale: 'en-US' });
        expect(await say(h.hello, { locale: 'fr-FR' })).not.toHaveProperty('cached');
        expect(h.preview).toHaveBeenCalledTimes(2);
        expect(await say(h.hello, { locale: 'fr-FR' })).toHaveProperty('cached', true);
        (h.voice.sessionSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...session(), speech: { ...session().speech, key: 'sk-a-newer-key' } });
        expect(await say(h.hello, { locale: 'fr-FR' })).toHaveProperty('cached', true);
        (h.voice.active as ReturnType<typeof vi.fn>).mockResolvedValue({ ...speaking(true), providers: { recognition: { providerId: 'ears', owner: true }, speech: { providerId: 'another-key', owner: true } } });
        expect(await say(h.hello, { locale: 'fr-FR' })).not.toHaveProperty('cached');
    });

    it('is made again once the time it is kept for has passed', async () => {
        const h = kept();
        await say(h.hello);
        h.later(59 * minute);
        expect(await say(h.hello)).toHaveProperty('cached', true);
        h.later(2 * minute);
        expect(await say(h.hello)).not.toHaveProperty('cached');
        expect(h.preview).toHaveBeenCalledTimes(2);
    });

    it('keeps nothing when the time is set to 0, and nothing that failed', async () => {
        const off = kept({}, { ttlMs: 0, maxBytes: 1_000_000 });
        await say(off.hello);
        expect(await say(off.hello)).not.toHaveProperty('cached');
        const failing = kept({ preview: { ok: false, kind: 'provider', status: 402, rejected: false } });
        await say(failing.hello);
        failing.preview.mockResolvedValue({ ok: true, wav: WAV, ms: 1 });
        expect(await say(failing.hello)).not.toHaveProperty('cached');
        expect(failing.preview).toHaveBeenCalledTimes(2);
    });

    it('keeps no more than the room it is given: the one used longest ago goes first, and one too big is not kept', () => {
        let at = 0;
        const cache = new HelloCache({ ttlMs: 60 * minute, maxBytes: 100 }, () => at);
        const wav = (n: number) => Buffer.alloc(n);
        cache.set('a', { text: 'a', wav: wav(40), ms: 1 });
        cache.set('b', { text: 'b', wav: wav(40), ms: 1 });
        expect(cache.get('a')).toBeDefined(); // a is the newest now
        cache.set('c', { text: 'c', wav: wav(40), ms: 1 });
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toBeDefined();
        expect(cache.get('c')).toBeDefined();
        cache.set('big', { text: 'big', wav: wav(101), ms: 1 });
        expect(cache.get('big')).toBeUndefined();
        // Setting a key again replaces it without counting it twice
        cache.set('a', { text: 'a2', wav: wav(40), ms: 1 });
        cache.set('c', { text: 'c2', wav: wav(40), ms: 1 });
        expect(cache.get('a')?.text).toBe('a2');
        expect(cache.get('c')?.text).toBe('c2');
    });

    it('is read from the settings: an hour and 32 MB unless told otherwise, 0 minutes for none', () => {
        expect(voiceHelloCacheSettings({})).toEqual({ ttlMs: 60 * minute, maxBytes: 32 * 1024 * 1024 });
        expect(voiceHelloCacheSettings({ VOICE_HELLO_CACHE_MINUTES: '5', VOICE_HELLO_CACHE_MB: '8' })).toEqual({ ttlMs: 5 * minute, maxBytes: 8 * 1024 * 1024 });
        expect(voiceHelloCacheSettings({ VOICE_HELLO_CACHE_MINUTES: '0' }).ttlMs).toBe(0);
        expect(voiceHelloCacheSettings({ VOICE_HELLO_CACHE_MINUTES: 'soon', VOICE_HELLO_CACHE_MB: '-3' })).toEqual({ ttlMs: 60 * minute, maxBytes: 32 * 1024 * 1024 });
    });
});

describe('a voice name typed for a person\'s own speech server (#1874)', () => {
    const own = (): SessionSettings => ({
        recognition: { adapter: 'openai-compatible', model: 'whisper-1', endpoint: 'https://speech.example.com/v1' },
        speech: { adapter: 'openai-compatible', model: 'kokoro', voiceId: 'af_heart', endpoint: 'https://speech.example.com/v1' },
        expression: 'natural',
    });

    it('says the line with the typed name, for the speech server only, and nothing of it is saved', async () => {
        const h = hello({ owner: true, settings: own() });
        expect((await say(h.hello, { voiceId: 'bm_george' })).ok).toBe(true);
        const [request] = h.preview.mock.calls[0];
        expect(request.speech).toEqual({ ...own().speech, voiceId: 'bm_george' });
        // The own server is free: no allowance is touched
        expect(h.checkVoiceAllowance).not.toHaveBeenCalled();
    });

    it('hears the saved name when none is typed', async () => {
        const h = hello({ owner: true, settings: own() });
        await say(h.hello);
        expect(h.preview.mock.calls[0][0].speech.voiceId).toBe('af_heart');
    });

    it('keeps one hello for each typed name', async () => {
        const cache = new HelloCache({ ttlMs: 60_000, maxBytes: 1_000_000 });
        const h = hello({ owner: true, settings: own(), cache });
        await say(h.hello, { voiceId: 'bm_george' });
        await say(h.hello, { voiceId: 'bm_george' });
        await say(h.hello, { voiceId: 'af_sky' });
        expect(h.preview).toHaveBeenCalledTimes(2);
    });

    it('refuses a typed name for any other speech source, and says nothing out loud nor counts anything', async () => {
        const h = hello({ owner: false });
        expect(await say(h.hello, { voiceId: 'bm_george' })).toEqual({ ok: false, status: 409, error: 'voice_name_not_typed' });
        expect(h.preview).not.toHaveBeenCalled();
        expect(h.checkVoiceAllowance).not.toHaveBeenCalled();
    });

    it('passes on how the server answered a name it did not take', async () => {
        const h = hello({ owner: true, settings: own(), preview: { ok: false, kind: 'provider', status: 404, rejected: false } });
        expect(await say(h.hello, { voiceId: 'nope' })).toEqual({ ok: false, status: 502, error: 'provider', providerStatus: 404, rejected: false });
    });

    it('takes one line of text of at most 255 characters, trimmed, and nothing else', () => {
        expect(typedVoiceName('  af_heart ')).toBe('af_heart');
        expect(typedVoiceName('a'.repeat(255))).toHaveLength(255);
        for (const bad of ['', '   ', 'a'.repeat(256), 'two\nlines', 'tab\there', 'nul\u0000', 42, null, undefined, {}]) {
            expect(typedVoiceName(bad)).toBeUndefined();
        }
    });
});

describe('a voice name typed at the door, before voice is on (#1874)', () => {
    const SOURCE = { providerId: 'my-server', model: 'kokoro' };
    const OWN_SPEECH = { adapter: 'openai-compatible', model: 'kokoro', voiceId: 'bm_george', endpoint: 'https://speech.example.com/v1' };
    // The bot does not speak yet: Orbit would say voice is off
    const off: ActiveVoice = { speaks: false, reason: 'off' };

    it('speaks it from the server named, without the bot\'s own voice being on, and counts nothing', async () => {
        const h = hello({ active: off, ownSpeech: OWN_SPEECH });
        expect((await say(h.hello, { voiceId: 'bm_george', source: SOURCE })).ok).toBe(true);
        expect(h.voice.ownSpeech).toHaveBeenCalledWith('my-server', 'kokoro', 'bm_george');
        expect(h.preview.mock.calls[0][0]).toMatchObject({ speech: OWN_SPEECH, text: HELLO_LINES.en, expression: 'natural' });
        expect(h.checkVoiceAllowance).not.toHaveBeenCalled();
        expect(h.report).toHaveBeenCalledWith('my-server', 'speech', { ok: true });
    });

    it('keeps one hello for each name, as the bot\'s own does', async () => {
        const cache = new HelloCache({ ttlMs: 60_000, maxBytes: 1_000_000 });
        const h = hello({ active: off, ownSpeech: OWN_SPEECH, cache });
        await say(h.hello, { voiceId: 'bm_george', source: SOURCE });
        expect((await say(h.hello, { voiceId: 'bm_george', source: SOURCE })).ok).toBe(true);
        expect(h.preview).toHaveBeenCalledTimes(1);
    });

    it('is not available when the bot may not use that server (not lent here), and says nothing out loud', async () => {
        const h = hello({ active: off, ownSpeech: null });
        expect(await say(h.hello, { voiceId: 'bm_george', source: SOURCE })).toEqual({ ok: false, status: 503, error: 'unavailable' });
        expect(h.preview).not.toHaveBeenCalled();
    });

    it('is only for a speech server of the person\'s own: another company\'s key is not spoken with a typed name', async () => {
        const h = hello({ active: off, ownSpeech: { ...OWN_SPEECH, adapter: 'elevenlabs', key: KEY } });
        expect(await say(h.hello, { voiceId: 'sarah', source: SOURCE })).toEqual({ ok: false, status: 409, error: 'voice_name_not_typed' });
        expect(h.preview).not.toHaveBeenCalled();
    });

    it('does not take a name from a bot server that cannot read keys for it', async () => {
        const h = hello({ active: off });
        expect(await say(h.hello, { voiceId: 'bm_george', source: SOURCE })).toEqual({ ok: false, status: 503, error: 'unavailable' });
    });

    it('does not tell Orbit the key failed when the server only did not take the name, but does when the key is refused', async () => {
        const named = hello({ active: off, ownSpeech: OWN_SPEECH, preview: { ok: false, kind: 'provider', status: 404, rejected: false } });
        expect(await say(named.hello, { voiceId: 'nope', source: SOURCE })).toMatchObject({ ok: false, status: 502, providerStatus: 404 });
        expect(named.report).not.toHaveBeenCalled();
        const refused = hello({ active: off, ownSpeech: OWN_SPEECH, preview: { ok: false, kind: 'provider', status: 401, rejected: true } });
        await say(refused.hello, { voiceId: 'af_heart', source: SOURCE });
        expect(refused.report).toHaveBeenCalledWith('my-server', 'speech', { ok: false, status: 401, rejected: true });
    });

    it('reads a source from a request: two short texts, else nothing', () => {
        expect(helloSourceOf({ providerId: 'p', model: 'm' })).toEqual({ providerId: 'p', model: 'm' });
        for (const bad of [null, 'p', {}, { providerId: 'p' }, { providerId: '', model: 'm' }, { providerId: 'p', model: 5 }, { providerId: 'x'.repeat(201), model: 'm' }]) {
            expect(helloSourceOf(bad)).toBeUndefined();
        }
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
        const say = vi.fn(async () => ({ ok: true, text: HELLO_LINES.en, wav: WAV, ms: 2300 }));
        const { post } = await api({ hello: { say } });
        const response = await post({ locale: 'ar-SA' });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ text: HELLO_LINES.en, mime: 'audio/wav', audio: WAV.toString('base64'), ms: 2300 });
        expect(say).toHaveBeenCalledWith({ botId: 'hala', personId: 'maker-uuid', locale: 'ar-SA' });
    });

    it('hands on a typed voice name, and refuses one that is not a name before asking anything', async () => {
        const say = vi.fn(async () => ({ ok: true, text: HELLO_LINES.en, wav: WAV, ms: 2300 }));
        const { post } = await api({ hello: { say } });
        expect((await post({ voiceId: ' bm_george ' })).status).toBe(200);
        expect(say).toHaveBeenCalledWith({ botId: 'hala', personId: 'maker-uuid', locale: undefined, voiceId: 'bm_george' });
        say.mockClear();
        expect((await post({ voiceId: 'bm_george', source: { providerId: 'my-server', model: 'kokoro' } })).status).toBe(200);
        expect(say).toHaveBeenCalledWith({ botId: 'hala', personId: 'maker-uuid', locale: undefined, voiceId: 'bm_george', source: { providerId: 'my-server', model: 'kokoro' } });
        say.mockClear();
        // A source without a name, or one that is not a source, is refused before anything is asked
        for (const body of [{ source: { providerId: 'p', model: 'm' } }, { voiceId: 'x', source: 'p' }, { voiceId: 'x', source: { providerId: 'p' } }]) {
            const response = await post(body);
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({ error: 'bad_source' });
        }
        expect(say).not.toHaveBeenCalled();
        for (const voiceId of ['', 'x'.repeat(256), 7, 'a\nb']) {
            const response = await post({ voiceId });
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({ error: 'bad_voice_name' });
        }
        expect(say).not.toHaveBeenCalled();
    });

    it('says when the hello was kept from earlier', async () => {
        const say = vi.fn(async () => ({ ok: true, text: HELLO_LINES.en, wav: WAV, ms: 2300, cached: true }));
        const { post } = await api({ hello: { say } });
        expect(await (await post()).json()).toEqual({ text: HELLO_LINES.en, mime: 'audio/wav', audio: WAV.toString('base64'), ms: 2300, cached: true });
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
