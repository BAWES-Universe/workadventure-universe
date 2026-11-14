/**
 * Which way a bot hears voice notes, by what Orbit has (plan v3, section 10): with every part of voice notes, every bot hears through
 * Orbit's hearing answer, whatever its Voice switch says; with an Orbit from before (no bundle), only while the bot talks live, as
 * before; with an Orbit that can't be asked or has only some of the parts, nothing is heard. Never broader than Orbit says.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNoteHearing } from '../voice/NoteHearingWiring';
import type { AdminApiService } from '../server/AdminApiService';

const UNIVERSE_AI = {
    v: 1,
    route: 'universe-ai',
    reason: null,
    payer: 'universe-ai',
    provider: { id: 'ua', adapter: 'soniox', name: 'Soniox', endpoint: null, region: null, apiKeyEncrypted: 'enc' },
    model: 'stt-rt-v3',
    language: null,
};
const ALL = { v: 1, hearing: true, reservations: true, turns: true, receipts: false, carry: false };

let admin: Record<string, ReturnType<typeof vi.fn>>;
const build = () => buildNoteHearing(admin as unknown as AdminApiService, { BOT_SERVICE_TOKEN: 'secret' } as NodeJS.ProcessEnv)!;

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    admin = {
        isConfigured: vi.fn(() => true),
        voiceNoteCapabilities: vi.fn(async () => ALL),
        noteHearing: vi.fn(async () => UNIVERSE_AI),
        // The bot's live voice is off
        getVoiceActive: vi.fn(async () => ({ speaks: false, reason: 'off' })),
        getVoiceLimits: vi.fn(async () => ({ longestNoteSeconds: 300 })),
        reserveVoiceNote: vi.fn(async () => ({ ok: false, reason: 'busy' })),
        claimVoiceNoteCleanups: vi.fn(async () => []),
    };
});

describe('every bot hears voice notes', () => {
    it('with an Orbit that has every part: a bot whose voice is off hears notes', async () => {
        expect(await build().canHear('bot-1')).toBe(true);
        expect(admin.getVoiceActive).not.toHaveBeenCalled();
    });

    it('with an Orbit from before: only while the bot talks live, as before', async () => {
        admin.voiceNoteCapabilities.mockResolvedValue(null);
        expect(await build().canHear('bot-1')).toBe(false);
        expect(admin.getVoiceActive).toHaveBeenCalled();
        expect(admin.noteHearing).not.toHaveBeenCalled();
    });

    it('never falls back to anything broader when Orbit can\'t be asked or has only some of the parts', async () => {
        admin.voiceNoteCapabilities.mockRejectedValue(new Error('down'));
        expect(await build().canHear('bot-1')).toBe(false);
        admin.voiceNoteCapabilities.mockResolvedValue({ ...ALL, reservations: false });
        const hearing = build();
        expect(await hearing.canHear('bot-1')).toBe(false);
        expect(await hearing.hear('bot-1', 'e-1', { bytes: new Uint8Array([1]), filename: 'a.m4a' }, { userId: 'u' })).toEqual({ ok: false, reason: 'failed' });
        expect(admin.reserveVoiceNote).not.toHaveBeenCalled();
        expect(admin.getVoiceActive).not.toHaveBeenCalled();
    });

    it('hears nothing for a sender it can\'t name: there is nobody to count it on', async () => {
        expect(await build().hear('bot-1', 'e-1', { bytes: new Uint8Array([1]), filename: 'a.m4a' }, {})).toEqual({ ok: false, reason: 'failed' });
        expect(admin.reserveVoiceNote).not.toHaveBeenCalled();
    });

    it('asks what the bot\'s reply would run on, so a note to a bot on Universe AI is checked against the person\'s replies', async () => {
        const hearing = build();
        const source = vi.fn(async () => 'own-key' as const);
        hearing.useReplySource(source);
        // A real clip, so the measurement passes when ffmpeg is here; either way the reservation is what is checked
        await hearing.hear('bot-1', 'e-1', { bytes: new Uint8Array([1, 2, 3]), filename: 'a.m4a' }, { userId: 'u', isGuest: true });
        expect(source).toHaveBeenCalledWith('bot-1');
    });
});
