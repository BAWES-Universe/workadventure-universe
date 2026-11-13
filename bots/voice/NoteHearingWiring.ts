/**
 * Puts hearing for voice notes together out of the bot server's own parts: Orbit for what the bot hears with (the same profile
 * and key its calls use) and for its listening time; the provider's file API for the words. Kept apart from NoteHearing so that
 * file can be tested with plain stand-ins.
 */
import type { AdminApiService } from '../server/AdminApiService';
import { FileParser } from '../services/FileParser';
import { NoteHearing, type Clip, type HearingSettings, type NoteAllowance } from './NoteHearing';
import { NoteLength } from './NoteLength';
import { NoteTurns, needsAll, type NoteSender, type TurnHeard } from './NoteTurns';
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

/** What the bot's reply would run on, for the person's reply allowance: Universe AI, a server provider or the maker's own key. */
export type ReplySourceOf = (botId: string) => Promise<'universe-ai' | 'provider' | 'own-key' | null>;

/** What a chat needs of hearing: hear a note for a bot, and know whether the bot can hear at all. */
export interface NoteHearingService {
    /**
     * Hears one note. `sender` is who sent it (needed to count it on their allowances). `onStart` is called just before the note goes
     * to the provider ("Listening…"), never for a note refused before that. A `reply-limit` failure means the person's replies are
     * used up: nothing was heard, and the usual limit card is for the reply path to show.
     */
    hear(botId: string, messageId: string, clip: Clip, sender?: { userId?: string; isGuest?: boolean }, onStart?: () => void): Promise<TurnHeard>;
    /**
     * Whether this bot hears voice notes now. With an Orbit that has voice notes for every bot: whenever Orbit's hearing answer has a
     * provider this server can send a file to, whatever the bot's Voice switch says. With an Orbit from before: only while the bot's
     * voice is on, as before. Never throws.
     */
    canHear(botId: string): Promise<boolean>;
    /** Tells hearing what a bot's reply would run on (the bot server's AI service knows). */
    useReplySource(source: ReplySourceOf): void;
    /** Keeps deleting what the hearing provider still holds, until it confirms. */
    startCleaning(): void;
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

    // Before: hearing only while the bot talks live, on its live voice's provider
    const before = {
        hear: (botId: string, messageId: string, clip: Clip) => forBot(botId).hearing.hear(`${botId}:${messageId}`, clip),
        canHear: async (botId: string) => {
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

    // Now: every bot hears, apart from talking live, reserved at Orbit before anything is paid (NoteTurns)
    let replySource: ReplySourceOf = async () => null;
    let longest: { at: number; value: number | undefined } | undefined;
    const turns = new NoteTurns({
        orbit: admin,
        hearers,
        length: new NoteLength({ maxSeconds: limits.maxSeconds, maxBytes: limits.maxBytes }),
        fetchClip: async (url, maxBytes) => new Uint8Array(await FileParser.fetchBytes(url, maxBytes)),
        longestSeconds: async () => {
            if (longest && Date.now() - longest.at < orbit.limitsCacheMs) return longest.value;
            try {
                const value = (await admin.getVoiceLimits(orbit.timeoutMs))?.longestNoteSeconds;
                longest = { at: Date.now(), value: typeof value === 'number' && value > 0 ? value : undefined };
            } catch {
                longest = { at: Date.now(), value: longest?.value };
            }
            return longest.value;
        },
        maxBytes: limits.maxBytes,
        report: (botId, providerId, outcome) => forBot(botId).settings.report(providerId, 'recognition', outcome),
        timeoutMs: orbit.timeoutMs,
        log,
    });

    /** "now" with an Orbit that has every part, "before" with one from before (no bundle), "none" when Orbit can't be asked. */
    const way = async (): Promise<'now' | 'before' | 'none'> => {
        try {
            const caps = await turns.capabilities();
            if (caps === null) return 'before';
            // An Orbit with only some of the parts is never read as one from before: nothing broader than it says
            return needsAll(caps) ? 'now' : 'none';
        } catch {
            return 'none';
        }
    };

    return {
        limits,
        hear: async (botId, messageId, clip, sender, onStart) => {
            const which = await way();
            if (which === 'before') {
                onStart?.();
                return before.hear(botId, messageId, clip);
            }
            if (which === 'none' || !sender?.userId) return { ok: false, reason: 'failed' };
            let source: NoteSender['source'];
            try {
                source = (await replySource(botId)) ?? undefined;
            } catch {
                source = undefined;
            }
            const who: NoteSender = { userId: sender.userId, ...(sender.isGuest !== undefined ? { isGuest: sender.isGuest } : {}), ...(source ? { source } : {}) };
            return turns.hear(botId, messageId, clip, who, onStart);
        },
        canHear: async (botId) => {
            const which = await way();
            if (which === 'before') return before.canHear(botId);
            return which === 'now' && turns.canHear(botId);
        },
        useReplySource: (source) => {
            replySource = source;
        },
        startCleaning: () => turns.startCleaning(),
    };
}

let shared: NoteHearingService | null | undefined;

/** One hearing for the whole bot server, so a note is heard once whether it came by direct message or in nearby chat. */
export function sharedNoteHearing(admin: AdminApiService, env: NodeJS.ProcessEnv = process.env): NoteHearingService | null {
    if (shared === undefined) shared = buildNoteHearing(admin, env);
    return shared;
}
