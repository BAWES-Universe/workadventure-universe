/**
 * Puts hearing for voice notes together out of the bot server's own parts: Orbit for what the bot hears with (the same profile
 * and key its calls use) and for its listening time; the provider's file API for the words. Kept apart from NoteHearing so that
 * file can be tested with plain stand-ins.
 */
import type { AdminApiService } from '../server/AdminApiService';
import { FileParser } from '../services/FileParser';
import { NoteHearing, type Clip, type HeardNote, type HearingSettings, type NoteAllowance } from './NoteHearing';
import { SonioxNotes } from './SonioxNotes';
import { ListeningBudget } from './VoiceListening';
import { BotVoiceSettings } from './VoiceSettings';
import { voiceOrbitSettings } from './settings';

/** The limits on one note. Ordinary settings; Orbit supplies them per bot later. */
export interface NoteLimits {
    /** The longest note heard, in seconds. */
    maxSeconds: number;
    /** The most bytes read for one note. */
    maxBytes: number;
    /** The most words kept of one transcript, in characters. */
    maxChars: number;
}

export const DEFAULT_NOTE_LIMITS: NoteLimits = { maxSeconds: 300, maxBytes: 15 * 1024 * 1024, maxChars: 4000 };

export function noteLimits(env: NodeJS.ProcessEnv = process.env): NoteLimits {
    const positive = (value: string | undefined, fallback: number): number => {
        const parsed = Number.parseInt(value ?? '', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    return {
        maxSeconds: positive(env.VOICE_NOTE_HEAR_MAX_SECONDS, DEFAULT_NOTE_LIMITS.maxSeconds),
        maxBytes: positive(env.VOICE_NOTE_HEAR_MAX_MB, DEFAULT_NOTE_LIMITS.maxBytes / (1024 * 1024)) * 1024 * 1024,
        maxChars: positive(env.VOICE_NOTE_TRANSCRIPT_MAX_CHARS, DEFAULT_NOTE_LIMITS.maxChars),
    };
}

/** What a chat needs of hearing: hear a note for a bot, and know whether the bot can hear at all. */
export interface NoteHearingService {
    hear(botId: string, messageId: string, clip: Clip): Promise<HeardNote>;
    /** Whether this bot hears voice notes now (its voice is on, with a hearing provider that reads a file). Never throws. */
    canHear(botId: string): Promise<boolean>;
    readonly limits: NoteLimits;
}

/** Null where hearing can't work: no Orbit set up for voice. */
export function buildNoteHearing(admin: AdminApiService, env: NodeJS.ProcessEnv = process.env): NoteHearingService | null {
    if (!admin.isConfigured() || !env.BOT_SERVICE_TOKEN) return null;
    const limits = noteLimits(env);
    const hearers = { soniox: new SonioxNotes() };
    const orbit = voiceOrbitSettings(env);
    const perBot = new Map<string, { hearing: NoteHearing; settings: BotVoiceSettings }>();
    const log = (message: string) => console.warn(`[NoteHearing] ${message}`);

    const forBot = (botId: string) => {
        let entry = perBot.get(botId);
        if (entry) return entry;
        const settings = new BotVoiceSettings(botId, admin, orbit, log);
        const budget = new ListeningBudget(botId, admin, () => undefined, log);
        const allowance: NoteAllowance = {
            allowed: async () => {
                await budget.check(true).catch(() => undefined);
                return !budget.isSpent();
            },
            spend: (seconds) => budget.add(seconds * 1000),
        };
        const hearingSettings: HearingSettings = {
            recognition: async () => {
                const active = await settings.active();
                if (!active.speaks) return null;
                const session = await settings.sessionSettings(active);
                if (!session) return null;
                return { recognition: session.recognition, providerId: active.providers.recognition.providerId, owner: active.providers.recognition.owner };
            },
            report: (providerId, part, outcome) => settings.report(providerId, part, outcome),
        };
        const hearing = new NoteHearing({
            fetchClip: async (url, maxBytes) => new Uint8Array(await FileParser.fetchBytes(url, maxBytes)),
            hearers,
            settings: hearingSettings,
            allowance,
            limits,
            log,
        });
        entry = { hearing, settings };
        perBot.set(botId, entry);
        return entry;
    };

    return {
        limits,
        hear: (botId, messageId, clip) => forBot(botId).hearing.hear(`${botId}:${messageId}`, clip),
        canHear: async (botId) => {
            try {
                const active = await forBot(botId).settings.active();
                if (!active.speaks) return false;
                const session = await forBot(botId).settings.sessionSettings(active);
                return !!session && session.recognition.adapter in hearers;
            } catch {
                return false;
            }
        },
    };
}

let shared: NoteHearingService | null | undefined;

/** One hearing for the whole bot server, so a note is heard once whether it came by direct message or in nearby chat. */
export function sharedNoteHearing(admin: AdminApiService, env: NodeJS.ProcessEnv = process.env): NoteHearingService | null {
    if (shared === undefined) shared = buildNoteHearing(admin, env);
    return shared;
}
