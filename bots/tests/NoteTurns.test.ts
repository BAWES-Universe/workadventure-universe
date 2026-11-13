/**
 * Every bot hears voice notes (plan v3): a note is measured for free, reserved at Orbit before anything is paid, heard once under
 * the hearing stage's lease, and what the provider still holds goes to the cleanup jobs. Orbit and the provider are stand-ins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HearingError, type ClipHearer } from '../voice/NoteHearing';
import { NoteTurns, clientTurnIdOf } from '../voice/NoteTurns';
import type { Lease, NoteHearingAnswer, Reservation, TurnEvent, VoiceNoteOrbit } from '../voice/VoiceNoteOrbit';

vi.mock('../ai/encryption', () => ({ decryptApiKey: (value: string) => (value ? `key-of-${value}` : null) }));

const UNIVERSE_AI: NoteHearingAnswer = {
    v: 1,
    route: 'universe-ai',
    reason: null,
    payer: 'universe-ai',
    provider: { id: 'ua-soniox', adapter: 'soniox', name: 'Soniox', endpoint: null, region: null, apiKeyEncrypted: 'enc' },
    model: 'stt-rt-v3',
    language: null,
};
const OWNER: NoteHearingAnswer = { ...UNIVERSE_AI, route: 'owner-key', payer: 'owner', provider: { ...UNIVERSE_AI.provider!, id: 'key-1', apiKeyEncrypted: 'own' } };
const CAPS = { v: 1, hearing: true, reservations: true, turns: true, receipts: false, carry: false };
const reserved = (state = 'reserved'): Reservation => ({ ok: true, replay: state !== 'reserved', turn: { id: 'turn-1', state: state as never, payer: 'universe-ai', seconds: 4 } });

let orbit: { [K in keyof VoiceNoteOrbit]: ReturnType<typeof vi.fn> };
let events: TurnEvent[];
let hearer: ClipHearer & { hear: ReturnType<typeof vi.fn>; reconcile: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
let measure: ReturnType<typeof vi.fn>;
let report: ReturnType<typeof vi.fn>;

const turns = () =>
    new NoteTurns({
        orbit: orbit as unknown as VoiceNoteOrbit,
        hearers: { soniox: hearer },
        length: { measure },
        fetchClip: async () => new Uint8Array([1, 2, 3]),
        longestSeconds: async () => 300,
        maxBytes: 1000,
        report,
    });
const SENDER = { userId: 'uuid-sara', isGuest: false, source: 'universe-ai' as const };

beforeEach(() => {
    events = [];
    orbit = {
        voiceNoteCapabilities: vi.fn(async () => CAPS),
        noteHearing: vi.fn(async () => UNIVERSE_AI),
        guestBrickHearing: vi.fn(async () => UNIVERSE_AI),
        reserveVoiceNote: vi.fn(async () => reserved()),
        leaseVoiceNote: vi.fn(async (): Promise<Lease> => ({ granted: true, generation: 1, leaseUntil: 'later', hearing: UNIVERSE_AI })),
        recordVoiceNote: vi.fn(async (_id: string, event: TurnEvent) => void events.push(event)),
        addVoiceNoteCleanup: vi.fn(async () => undefined),
        claimVoiceNoteCleanups: vi.fn(async () => []),
        settleVoiceNoteCleanup: vi.fn(async () => undefined),
    };
    hearer = {
        hear: vi.fn(async (_settings, _clip, hooks) => {
            await hooks?.onSubmitted?.({ file: 'f-1', transcription: 't-1' });
            await hooks?.cleanup?.({ file: 'f-1', transcription: 't-1' });
            return { text: 'where is the coffee', seconds: 3.9, uploadMs: 10, waitMs: 20 };
        }),
        reconcile: vi.fn(async () => ({ text: 'found again', seconds: 3.9, uploadMs: 0, waitMs: 5 })),
        remove: vi.fn(async () => 204),
    };
    measure = vi.fn(async () => ({ ok: true, seconds: 3.9, bytes: new Uint8Array([9]), filename: 'note.ogg' }));
    report = vi.fn();
});

describe('a note for a bot', () => {
    it('is measured, reserved, heard once with the key Orbit gave at the lease, and its ids and words are kept at Orbit', async () => {
        const onStart = vi.fn();
        const heard = await turns().hear('bot-1', 'event-1', { bytes: new Uint8Array([1, 2, 3]) }, SENDER, onStart);
        expect(heard).toMatchObject({ ok: true, text: 'where is the coffee', provider: 'soniox' });
        expect(orbit.reserveVoiceNote).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'bot', botId: 'bot-1', userId: 'uuid-sara', isGuest: false, clientTurnId: 'event-1', seconds: 4, adapters: ['soniox'], source: 'universe-ai' }),
            expect.any(Number)
        );
        // The provider got the normalized copy, with the key decrypted from the lease
        expect(hearer.hear).toHaveBeenCalledWith(expect.objectContaining({ adapter: 'soniox', model: 'stt-rt-v3', key: 'key-of-enc' }), { bytes: new Uint8Array([9]), filename: 'note.ogg' }, expect.anything());
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(events).toEqual([
            { event: 'submitted', generation: 1, refs: { file: 'f-1', transcription: 't-1' } },
            { event: 'heard', generation: 1, transcript: 'where is the coffee', seconds: 4 },
        ]);
        expect(orbit.addVoiceNoteCleanup).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'ua-soniox', kind: 'transcription', objectId: 't-1' }), expect.any(Number));
        expect(orbit.addVoiceNoteCleanup).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'ua-soniox', kind: 'file', objectId: 'f-1' }), expect.any(Number));
    });

    it('is the same answer when asked again on this server, never heard twice', async () => {
        const t = turns();
        await t.hear('bot-1', 'event-1', { bytes: new Uint8Array([1]) }, SENDER);
        await t.hear('bot-1', 'event-1', { bytes: new Uint8Array([1]) }, SENDER);
        expect(hearer.hear).toHaveBeenCalledTimes(1);
        expect(orbit.reserveVoiceNote).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['the person\'s replies are used up', { ok: false, reason: 'reply-limit', allowance: { allowed: false, limit: 'universe-ai', resetsAt: 'soon', who: 'member' } }, { ok: false, reason: 'reply-limit' }],
        ['the person\'s note minutes are used up', { ok: false, reason: 'note-minutes', limit: 'person', resetsAt: 'tomorrow' }, { ok: false, reason: 'allowance' }],
        ['the bot\'s day is used up', { ok: false, reason: 'note-minutes', limit: 'bot', resetsAt: 'tomorrow' }, { ok: false, reason: 'allowance' }],
        ['too many notes are being heard', { ok: false, reason: 'busy' }, { ok: false, reason: 'busy' }],
        ['it is longer than the longest note', { ok: false, reason: 'too-long', longestSeconds: 60 }, { ok: false, reason: 'too-long' }],
        ['nothing can hear it', { ok: false, reason: 'no-hearing' }, { ok: false, reason: 'none' }],
    ])('is never sent to a provider when %s, and "Listening…" never shows', async (_name, answer, expected) => {
        orbit.reserveVoiceNote.mockResolvedValue(answer);
        const onStart = vi.fn();
        expect(await turns().hear('bot-1', 'event-1', { bytes: new Uint8Array([1]) }, SENDER, onStart)).toMatchObject(expected);
        expect(hearer.hear).not.toHaveBeenCalled();
        expect(orbit.leaseVoiceNote).not.toHaveBeenCalled();
        expect(onStart).not.toHaveBeenCalled();
    });

    it('is measured before anything is asked: too long or broken audio never reaches Orbit or a provider', async () => {
        measure.mockResolvedValueOnce({ ok: false, reason: 'too-long' });
        expect(await turns().hear('bot-1', 'e-1', { bytes: new Uint8Array([1]) }, SENDER)).toEqual({ ok: false, reason: 'too-long' });
        measure.mockResolvedValueOnce({ ok: false, reason: 'broken' });
        expect(await turns().hear('bot-1', 'e-2', { bytes: new Uint8Array([1]) }, SENDER)).toEqual({ ok: false, reason: 'failed' });
        expect(orbit.reserveVoiceNote).not.toHaveBeenCalled();
        expect(measure).toHaveBeenCalledWith(new Uint8Array([1]), 300);
    });

    it('takes the words another server already heard, through the answer stage, and gives the stage straight back', async () => {
        orbit.reserveVoiceNote.mockResolvedValue(reserved('heard'));
        orbit.leaseVoiceNote.mockResolvedValue({ granted: true, generation: 2, leaseUntil: 'later', transcript: 'heard before' });
        expect(await turns().hear('bot-1', 'e-1', { bytes: new Uint8Array([1]) }, SENDER)).toMatchObject({ ok: true, text: 'heard before' });
        expect(orbit.leaseVoiceNote).toHaveBeenCalledWith('turn-1', { stage: 'answer' }, expect.any(Number));
        expect(events).toEqual([{ event: 'answer-failed', generation: 2 }]);
        expect(hearer.hear).not.toHaveBeenCalled();
    });

    it('looks a lost hearing up by its provider ids instead of sending the note again', async () => {
        orbit.leaseVoiceNote.mockResolvedValue({ granted: true, generation: 2, leaseUntil: 'later', hearing: UNIVERSE_AI, reconcile: { transcription: 't-9' } });
        expect(await turns().hear('bot-1', 'e-1', { bytes: new Uint8Array([1]) }, SENDER)).toMatchObject({ ok: true, text: 'found again' });
        expect(hearer.reconcile).toHaveBeenCalledWith(expect.objectContaining({ key: 'key-of-enc' }), { transcription: 't-9' }, expect.anything());
        expect(hearer.hear).not.toHaveBeenCalled();
    });

    it('is not heard while another server holds it, nor when its key is gone at the lease', async () => {
        orbit.leaseVoiceNote.mockResolvedValueOnce({ granted: false, reason: 'held' });
        expect(await turns().hear('bot-1', 'e-1', { bytes: new Uint8Array([1]) }, SENDER)).toEqual({ ok: false, reason: 'busy' });
        orbit.leaseVoiceNote.mockResolvedValueOnce({ granted: false, reason: 'no-hearing' });
        expect(await turns().hear('bot-1', 'e-2', { bytes: new Uint8Array([1]) }, SENDER)).toEqual({ ok: false, reason: 'none' });
        expect(hearer.hear).not.toHaveBeenCalled();
    });

    it('says whether a failed hearing may have been charged: refused before the provider took it, after, or cut off by the clock', async () => {
        hearer.hear.mockRejectedValueOnce(new HearingError('no', 401));
        expect(await turns().hear('bot-1', 'e-1', { bytes: new Uint8Array([1]) }, SENDER)).toMatchObject({ ok: false, reason: 'rejected' });
        hearer.hear.mockImplementationOnce(async (_s, _c, hooks) => {
            await hooks?.onSubmitted?.({ transcription: 't-2' });
            throw new HearingError('could not read', 422);
        });
        expect(await turns().hear('bot-1', 'e-2', { bytes: new Uint8Array([1]) }, SENDER)).toMatchObject({ ok: false, reason: 'failed' });
        hearer.hear.mockRejectedValueOnce(new HearingError('slow', 504));
        await turns().hear('bot-1', 'e-3', { bytes: new Uint8Array([1]) }, SENDER);
        expect(events.filter((event) => event.event === 'hearing-failed')).toEqual([
            { event: 'hearing-failed', generation: 1, charged: 'no' },
            { event: 'hearing-failed', generation: 1, charged: 'yes' },
            { event: 'hearing-failed', generation: 1, charged: 'unknown' },
        ]);
    });

    it('reports how a maker\'s own key did, and never Universe AI\'s', async () => {
        orbit.leaseVoiceNote.mockResolvedValue({ granted: true, generation: 1, leaseUntil: 'later', hearing: OWNER });
        await turns().hear('bot-1', 'e-1', { bytes: new Uint8Array([1]) }, SENDER);
        expect(report).toHaveBeenCalledWith('bot-1', 'key-1', { ok: true });
        report.mockClear();
        orbit.leaseVoiceNote.mockResolvedValue({ granted: true, generation: 1, leaseUntil: 'later', hearing: UNIVERSE_AI });
        await turns().hear('bot-1', 'e-2', { bytes: new Uint8Array([1]) }, SENDER);
        expect(report).not.toHaveBeenCalled();
    });

    it('keeps a long turn id the same, in what Orbit takes', () => {
        const long = `space|${'x'.repeat(300)}`;
        expect(clientTurnIdOf(long)).toBe(clientTurnIdOf(long));
        expect(clientTurnIdOf(long).length).toBeLessThanOrEqual(255);
        expect(clientTurnIdOf('event-1')).toBe('event-1');
    });
});

describe('whether a bot hears, for the mic', () => {
    it('follows Orbit\'s hearing answer, whatever the bot\'s Voice switch says, kept for a minute', async () => {
        const t = turns();
        expect(await t.canHear('bot-1')).toBe(true);
        expect(await t.canHear('bot-1')).toBe(true);
        expect(orbit.noteHearing).toHaveBeenCalledTimes(1);
        orbit.noteHearing.mockResolvedValue({ ...UNIVERSE_AI, route: 'none', provider: null });
        expect(await turns().canHear('bot-2')).toBe(false);
        orbit.noteHearing.mockRejectedValue(new Error('down'));
        expect(await turns().canHear('bot-3')).toBe(false);
    });
});

describe('what the provider still holds', () => {
    it('is deleted until the provider confirms, and Orbit is told each answer', async () => {
        orbit.claimVoiceNoteCleanups.mockResolvedValue([
            { id: 'c-1', kind: 'transcription', objectId: 't-1', provider: UNIVERSE_AI.provider },
            { id: 'c-2', kind: 'file', objectId: 'f-1', provider: UNIVERSE_AI.provider },
        ]);
        hearer.remove.mockResolvedValueOnce(409).mockRejectedValueOnce(new Error('network'));
        expect(await turns().cleanNow()).toBe(2);
        expect(hearer.remove).toHaveBeenCalledWith({ key: 'key-of-enc' }, 'transcription', 't-1');
        expect(orbit.settleVoiceNoteCleanup).toHaveBeenCalledWith('c-1', { status: 409 }, expect.any(Number));
        expect(orbit.settleVoiceNoteCleanup).toHaveBeenCalledWith('c-2', { failed: true }, expect.any(Number));
    });

    it('is left alone by an Orbit from before, which has no cleanup jobs', async () => {
        orbit.voiceNoteCapabilities.mockResolvedValue(null);
        expect(await turns().cleanNow()).toBe(0);
        expect(orbit.claimVoiceNoteCleanups).not.toHaveBeenCalled();
    });
});
