import { describe, expect, it, vi } from 'vitest';
import { HearingError, NoteHearing, tidyTranscript, type ClipHearer, type HearingSettings } from '../voice/NoteHearing';
import { SonioxNotes, asyncModelFor } from '../voice/SonioxNotes';
import type { RecognitionConfig } from '../voice/protocol';

const soniox: RecognitionConfig = { adapter: 'soniox', model: 'stt-rt-v6', key: 'secret-key', language: 'ar-KW', terms: ['Linear'] };

/** A Soniox that answers like the real one: queued once, then completed. */
function fakeSoniox(options: { status?: number; failAt?: string; errorState?: boolean } = {}) {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    let polls = 0;
    const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET';
        const path = url.replace('https://api.soniox.com/v1', '');
        calls.push({ method, url: path, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
        const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
        if (options.failAt && `${method} ${path}`.startsWith(options.failAt)) return json({}, options.status ?? 500);
        if (method === 'POST' && path === '/files') return json({ id: 'file-1' }, 201);
        if (method === 'POST' && path === '/transcriptions') return json({ id: 'tr-1', status: 'queued' }, 201);
        if (method === 'GET' && path === '/transcriptions/tr-1') {
            polls++;
            if (options.errorState) return json({ id: 'tr-1', status: 'error' });
            return json({ id: 'tr-1', status: polls < 2 ? 'processing' : 'completed', audio_duration_ms: 4200 });
        }
        if (method === 'GET' && path === '/transcriptions/tr-1/transcript') return json({ id: 'tr-1', text: 'hello there', tokens: [] });
        return new Response(null, { status: 204 });
    });
    return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe('Soniox note hearing', () => {
    const run = (fake: ReturnType<typeof fakeSoniox>) =>
        new SonioxNotes({ fetch: fake.fetcher, sleep: async () => undefined }).hear(soniox, { bytes: new Uint8Array([1, 2, 3]), filename: 'Voice message.m4a' });

    it('uploads the clip, reads the words, and deletes both from Soniox', async () => {
        const fake = fakeSoniox();
        const heard = await run(fake);
        expect(heard.text).toBe('hello there');
        expect(heard.seconds).toBe(4.2);
        const made = fake.calls.find((c) => c.method === 'POST' && c.url === '/transcriptions');
        expect(made?.body).toEqual({ model: 'stt-async-v6', file_id: 'file-1', language_hints: ['ar'], context: { terms: ['Linear'] } });
        expect(fake.calls.filter((c) => c.method === 'DELETE').map((c) => c.url).sort()).toEqual(['/files/file-1', '/transcriptions/tr-1']);
    });

    it('deletes what it made even when the transcription fails', async () => {
        const fake = fakeSoniox({ errorState: true });
        await expect(run(fake)).rejects.toBeInstanceOf(HearingError);
        expect(fake.calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
    });

    it('ends a call that stalls instead of holding its slot, and still cleans up', async () => {
        const calls: { method: string; signalled: boolean }[] = [];
        const stalled = vi.fn((url: string, init: RequestInit = {}) => {
            calls.push({ method: init.method ?? 'GET', signalled: init.signal instanceof AbortSignal });
            if (init.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
            if (init.method === 'POST' && url.endsWith('/files')) return Promise.resolve(new Response(JSON.stringify({ id: 'file-1' })));
            // The transcription call never answers until its time runs out
            return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
        });
        const hearing = new SonioxNotes({ fetch: stalled as unknown as typeof fetch, timeoutMs: 30 });
        const error = await hearing.hear(soniox, { bytes: new Uint8Array([1]), filename: 'Voice message.m4a' }).catch((e: unknown) => e as HearingError);
        expect(error).toBeInstanceOf(HearingError);
        expect((error as HearingError).status).toBe(504);
        expect(calls.every((c) => c.signalled)).toBe(true);
        expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    });

    it('reports the status of a refusal and never the key', async () => {
        const fake = fakeSoniox({ failAt: 'POST /files', status: 401 });
        const error = await run(fake).catch((e: unknown) => e as HearingError);
        expect(error).toBeInstanceOf(HearingError);
        expect((error as HearingError).rejected).toBe(true);
        expect(String((error as HearingError).message)).not.toContain('secret-key');
    });

    it('maps the live model to the file model', () => {
        expect(asyncModelFor('stt-rt-v6')).toBe('stt-async-v6');
        expect(asyncModelFor('stt-rt-v4')).toBe('stt-async-v6');
        expect(asyncModelFor('stt-async-v6')).toBe('stt-async-v6');
    });
});

describe('NoteHearing', () => {
    const settings = (overrides: Partial<HearingSettings> = {}): HearingSettings => ({
        recognition: async () => ({ recognition: soniox, providerId: 'p1', owner: false }),
        report: vi.fn(),
        ...overrides,
    });
    const hearer = (text = 'words'): ClipHearer & { hear: ReturnType<typeof vi.fn> } => ({ hear: vi.fn(async () => ({ text, seconds: 5, uploadMs: 10, waitMs: 20 })) });
    const build = (h: ClipHearer, s = settings(), extra: Partial<ConstructorParameters<typeof NoteHearing>[0]> = {}) =>
        new NoteHearing({ fetchClip: async () => new Uint8Array(10), hearers: { soniox: h }, settings: s, limits: { maxSeconds: 300, maxBytes: 1_000_000 }, ...extra });
    const clip = { url: 'https://files.example/a.m4a', filename: 'Voice message.m4a' };

    it('hears a note once for the same message', async () => {
        const h = hearer();
        const hearing = build(h);
        const [a, b] = await Promise.all([hearing.hear('$m1', clip), hearing.hear('$m1', clip)]);
        expect(a).toEqual(b);
        expect(a.ok && a.text).toBe('words');
        await hearing.hear('$m1', clip);
        expect(h.hear).toHaveBeenCalledTimes(1);
    });

    it('does not fetch a clip that is over the limit', async () => {
        const fetchClip = vi.fn();
        const result = await build(hearer(), settings(), { fetchClip }).hear('$m2', { ...clip, seconds: 301 });
        expect(result).toEqual({ ok: false, reason: 'too-long' });
        expect(fetchClip).not.toHaveBeenCalled();
    });

    it('says when the bot has no hearing, or its provider cannot read a file', async () => {
        expect(await build(hearer(), settings({ recognition: async () => null })).hear('$m3', clip)).toEqual({ ok: false, reason: 'none' });
        const other = settings({ recognition: async () => ({ recognition: { ...soniox, adapter: 'deepgram' }, providerId: 'p2', owner: true }) });
        expect(await build(hearer(), other).hear('$m4', clip)).toEqual({ ok: false, reason: 'unsupported' });
    });

    it('refuses once the listening allowance is used, only for Universe AI', async () => {
        const allowance = { allowed: async () => false, spend: vi.fn() };
        expect(await build(hearer(), settings(), { allowance }).hear('$m5', clip)).toEqual({ ok: false, reason: 'allowance' });
        const lent = settings({ recognition: async () => ({ recognition: soniox, providerId: 'p1', owner: true }) });
        const heard = await build(hearer(), lent, { allowance }).hear('$m6', clip);
        expect(heard.ok).toBe(true);
        expect(allowance.spend).not.toHaveBeenCalled();
    });

    it('counts the seconds heard for Universe AI, and tells Orbit nothing about its key', async () => {
        const allowance = { allowed: async () => true, spend: vi.fn() };
        const s = settings();
        await build(hearer(), s, { allowance }).hear('$m7', clip);
        expect(allowance.spend).toHaveBeenCalledWith(5);
        expect(s.report).not.toHaveBeenCalled();
        const refused: ClipHearer = { hear: async () => { throw new HearingError('no', 401); } };
        const s2 = settings();
        expect(await build(refused, s2).hear('$m8', clip)).toEqual({ ok: false, reason: 'rejected', status: 401 });
        expect(s2.report).not.toHaveBeenCalled();
    });

    it('tells Orbit how a person\'s own key did: a success clears a refusal, a refusal is reported', async () => {
        const own = () => settings({ recognition: async () => ({ recognition: soniox, providerId: 'p1', owner: true }) });
        const good = own();
        await build(hearer(), good).hear('$m7b', clip);
        expect(good.report).toHaveBeenCalledWith('p1', 'recognition', { ok: true });
        const refused: ClipHearer = { hear: async () => { throw new HearingError('no', 401); } };
        const bad = own();
        await build(refused, bad).hear('$m8b', clip);
        expect(bad.report).toHaveBeenCalledWith('p1', 'recognition', { ok: false, status: 401, rejected: true });
    });

    it('tries a note again after a failure, and says busy instead of queueing', async () => {
        let fail = true;
        const flaky: ClipHearer = { hear: async () => { if (fail) throw new HearingError('down', 500); return { text: 'ok', uploadMs: 0, waitMs: 0 }; } };
        const hearing = build(flaky);
        expect((await hearing.hear('$m9', clip)).ok).toBe(false);
        fail = false;
        expect((await hearing.hear('$m9', clip)).ok).toBe(true);

        let release: () => void = () => undefined;
        const slow: ClipHearer = { hear: () => new Promise((resolve) => { release = () => resolve({ text: 'x', uploadMs: 0, waitMs: 0 }); }) };
        const busy = build(slow, settings(), { maxConcurrent: 1 });
        const first = busy.hear('$a', clip);
        await new Promise((r) => setTimeout(r, 0));
        expect(await busy.hear('$b', clip)).toEqual({ ok: false, reason: 'busy' });
        release();
        await first;
    });

    it('cuts a transcript to one line of words', () => {
        expect(tidyTranscript('  a\n\n b   c ', 100)).toBe('a b c');
        expect(tidyTranscript('abcdefghij', 5)).toBe('abcd…');
    });
});
