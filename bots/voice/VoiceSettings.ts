/**
 * What a voice bot hears and speaks with (#1746). The bot's maker picks the provider, model and voice in Orbit; this
 * reads that choice, fetches the key of each provider it names, and tells Orbit how the provider calls went.
 *
 * Any trouble ends the same way: the bot does not speak and answers in text. Nothing here throws to its caller.
 * A key is decrypted here and handed on in the one object that goes to the voice worker. It is not kept, not
 * logged and not put in an error: everything that is logged or remembered is built from the parts without it.
 */
import { decryptApiKey } from '../ai/encryption';
import type { ProviderPart, RecognitionConfig, SpeechConfig, VoiceExpression } from './protocol';
import { DEFAULT_VOICE_ORBIT_SETTINGS, type ReplyLimits, type VoiceOrbitSettings } from './settings';

/** A bot's voice profile as Orbit serves it (docs/bots/VOICE_BOT_API.md). Every part may be missing. */
export interface VoiceProfile {
    recognition?: { providerId?: string; model?: string } | null;
    speech?: { providerId?: string; model?: string; voiceId?: string; voiceName?: string } | null;
    expression?: string;
    language?: { mode?: string; code?: string } | null;
}

/** The server's voice limits, or a bot's own when its voice runs on a person's key. */
export interface VoiceLimits {
    turnSeconds: number;
    replyCharacters: number;
    replySeconds: number;
    listenMinutesPerDay: number;
    followUpSeconds: number;
    textReserveShare: number;
    guestVoiceReplies: number;
}

/** GET /api/bots/:id/voice/active. */
export interface VoiceActiveAnswer {
    speaks: boolean;
    reason: string | null;
    parts?: { recognition?: string; speech?: string } | null;
    revision?: number | null;
    profile?: VoiceProfile | null;
    /** Orbit PR 787. An Orbit from before does not send it. */
    limits?: Partial<VoiceLimits> | null;
}

/** GET /api/voice/providers/:id/credentials?botId=. The key is still encrypted. */
export interface VoiceCredentialsAnswer {
    id: string;
    adapter: string;
    name?: string;
    recognition?: boolean;
    speech?: boolean;
    endpoint?: string | null;
    region?: string | null;
    apiKeyEncrypted: string | null;
}

/** POST /api/voice/providers/:id/health. */
export type VoiceHealthReport =
    | { part: ProviderPart; ok: true; botId: string }
    | { part: ProviderPart; ok: false; botId: string; status?: number; rejected?: boolean };

/** What the bot server asks of Orbit. `AdminApiService` is the real one; tests give a fake. */
export interface VoiceOrbit {
    /** Null when Orbit does not know the bot. Throws when Orbit cannot be asked. */
    getVoiceActive(botId: string, timeoutMs: number): Promise<VoiceActiveAnswer | null>;
    /** Null when the provider is not usable by this bot (Orbit answers 404 or 400). Throws when Orbit cannot be asked. */
    getVoiceCredentials(providerId: string, botId: string, timeoutMs: number): Promise<VoiceCredentialsAnswer | null>;
    /** The server's voice limits, or null. Throws when Orbit cannot be asked. */
    getVoiceLimits(timeoutMs: number): Promise<Partial<VoiceLimits> | null>;
    /** Throws on a failure. A provider Orbit does not track (a server's own) answers 404, which is not a failure. */
    reportVoiceHealth(providerId: string, report: VoiceHealthReport, timeoutMs: number): Promise<void>;
}

/** The provider a part runs on, and whether a person's key (not the server's own) pays for it. */
export interface PartProvider {
    providerId: string;
    owner: boolean;
}

/** Orbit's answer for a bot that speaks now, without any key. */
export interface SpeakingNow {
    speaks: true;
    /** What the settings of a bubble are made of, without the keys. A different value means a session must be opened again. */
    signature: string;
    providers: Record<ProviderPart, PartProvider>;
    profile: { recognitionModel: string; speechModel: string; voiceId: string; expression: VoiceExpression; language?: string };
    /** The reply limits for this bot, when Orbit (or the server's limits) gave any. */
    replyLimits?: Partial<Pick<ReplyLimits, 'maxChars' | 'maxSeconds'>>;
}

export type ActiveVoice = { speaks: false; reason: string } | SpeakingNow;

/** What goes into `session.open`. It holds keys: pass it on, never store or log it. */
export interface SessionSettings {
    recognition: RecognitionConfig;
    speech: SpeechConfig;
    expression: VoiceExpression;
}

/** How one provider call went, as the worker said it. */
export type VoiceOutcome = { ok: true } | { ok: false; status?: number; rejected?: boolean };

/** What the relay needs from this module. */
export interface VoiceSettings {
    active(): Promise<ActiveVoice>;
    sessionSettings(active: SpeakingNow): Promise<SessionSettings | null>;
    report(providerId: string, part: ProviderPart, outcome: VoiceOutcome): void;
}

const EXPRESSIONS: readonly VoiceExpression[] = ['restrained', 'natural', 'expressive'];
const DEFAULT_EXPRESSION: VoiceExpression = 'natural';

export class BotVoiceSettings implements VoiceSettings {
    private cached?: { value: ActiveVoice; at: number };
    private inflight?: Promise<ActiveVoice>;
    private limitsCache?: { value: Partial<VoiceLimits> | null; at: number };

    constructor(
        private readonly botId: string,
        private readonly orbit: VoiceOrbit,
        private readonly options: VoiceOrbitSettings = DEFAULT_VOICE_ORBIT_SETTINGS,
        private readonly log: (message: string) => void = () => undefined,
        private readonly now: () => number = () => Date.now()
    ) {}

    /**
     * Whether the bot speaks now, and with what. Orbit decides it, and is asked again for every spoken turn; an answer
     * is reused only for a moment (a setting), so a bubble that has just started does not ask twice.
     */
    active(): Promise<ActiveVoice> {
        if (this.cached && this.now() - this.cached.at < this.options.activeCacheMs) return Promise.resolve(this.cached.value);
        if (this.inflight) return this.inflight;
        const asking = this.read()
            .then(({ value, keep }) => {
                this.cached = keep ? { value, at: this.now() } : undefined;
                return value;
            })
            .finally(() => {
                this.inflight = undefined;
            });
        this.inflight = asking;
        return asking;
    }

    private async read(): Promise<{ value: ActiveVoice; keep: boolean }> {
        let answer: VoiceActiveAnswer | null;
        try {
            answer = await this.orbit.getVoiceActive(this.botId, this.options.timeoutMs);
        } catch (error) {
            // Not kept: the next turn asks again, it should not wait out the cache for an Orbit that was only busy
            this.log(`voice: could not ask Orbit if the bot speaks (${describe(error)})`);
            return { value: { speaks: false, reason: 'orbit' }, keep: false };
        }
        if (!answer) return { value: { speaks: false, reason: 'unknown-bot' }, keep: true };
        if (answer.speaks !== true) return { value: { speaks: false, reason: typeof answer.reason === 'string' && answer.reason ? answer.reason : 'off' }, keep: true };
        const profile = answer.profile;
        const recognition = profile?.recognition;
        const speech = profile?.speech;
        if (!recognition?.providerId || !recognition.model || !speech?.providerId || !speech.model || !speech.voiceId) {
            return { value: { speaks: false, reason: 'no-profile' }, keep: true };
        }
        const expression = EXPRESSIONS.find((e) => e === profile?.expression) ?? DEFAULT_EXPRESSION;
        const language = profile?.language?.mode === 'fixed' && profile.language.code ? profile.language.code : undefined;
        // A part that Orbit says Universe AI pays for has no health to report; when Orbit does not say, the report is sent and ignored
        const paidBy = (part: ProviderPart): boolean => answer!.parts?.[part] !== 'universe-ai';
        const replyLimits = (await this.limitsFor(answer.limits)) ?? undefined;
        return {
            keep: true,
            value: {
                speaks: true,
                signature: JSON.stringify([recognition.providerId, recognition.model, speech.providerId, speech.model, speech.voiceId, expression, language ?? null]),
                providers: {
                    recognition: { providerId: recognition.providerId, owner: paidBy('recognition') },
                    speech: { providerId: speech.providerId, owner: paidBy('speech') },
                },
                profile: { recognitionModel: recognition.model, speechModel: speech.model, voiceId: speech.voiceId, expression, language },
                replyLimits,
            },
        };
    }

    /** The reply limits: the bot's own from Orbit when it sent them, else the server's, else none (the settings from the environment apply). */
    private async limitsFor(fromBot: Partial<VoiceLimits> | null | undefined): Promise<SpeakingNow['replyLimits'] | null> {
        const own = replyLimitsOf(fromBot);
        if (own) return own;
        if (this.limitsCache && this.now() - this.limitsCache.at < this.options.limitsCacheMs) return replyLimitsOf(this.limitsCache.value);
        try {
            const server = await this.orbit.getVoiceLimits(this.options.timeoutMs);
            this.limitsCache = { value: server, at: this.now() };
            return replyLimitsOf(server);
        } catch (error) {
            this.log(`voice: could not read the server's voice limits (${describe(error)})`);
            return replyLimitsOf(this.limitsCache?.value);
        }
    }

    /**
     * The key of each provider the profile names, ready for `session.open`. Null when any of them cannot be used by
     * this bot now (Orbit says no, the key cannot be read): the bot then answers in text.
     */
    async sessionSettings(active: SpeakingNow): Promise<SessionSettings | null> {
        const { recognition, speech } = active.providers;
        const ids = [...new Set([recognition.providerId, speech.providerId])];
        const found = new Map<string, Credentials | null>();
        await Promise.all(ids.map(async (id) => found.set(id, await this.credentialsOf(id))));
        const forEars = found.get(recognition.providerId);
        const forVoice = found.get(speech.providerId);
        if (!forEars || !forVoice || forEars.recognition === false || forVoice.speech === false) return null;
        const { profile } = active;
        return {
            recognition: { adapter: forEars.adapter, model: profile.recognitionModel, key: forEars.key, ...connection(forEars), ...(profile.language ? { language: profile.language } : {}) },
            speech: { adapter: forVoice.adapter, model: profile.speechModel, voiceId: profile.voiceId, key: forVoice.key, ...connection(forVoice), ...(profile.language ? { language: profile.language } : {}) },
            expression: profile.expression,
        };
    }

    private async credentialsOf(providerId: string): Promise<Credentials | null> {
        let answer: VoiceCredentialsAnswer | null;
        try {
            answer = await this.orbit.getVoiceCredentials(providerId, this.botId, this.options.timeoutMs);
        } catch (error) {
            this.log(`voice: could not ask Orbit for provider ${providerId} (${describe(error)})`);
            return null;
        }
        if (!answer || typeof answer.adapter !== 'string' || !answer.adapter) {
            this.log(`voice: provider ${providerId} cannot be used by this bot now`);
            return null;
        }
        let key: string | null;
        try {
            key = decryptApiKey(answer.apiKeyEncrypted);
        } catch {
            // The reason is left out on purpose: it is about the key
            this.log(`voice: the key of provider ${providerId} could not be read`);
            return null;
        }
        if (!key) {
            this.log(`voice: provider ${providerId} has no key`);
            return null;
        }
        return { adapter: answer.adapter, key, recognition: answer.recognition, speech: answer.speech, endpoint: answer.endpoint || undefined, region: answer.region || undefined };
    }

    /** Tells Orbit how a provider call went. Never waits, never throws, and a failure to tell is only logged. */
    report(providerId: string, part: ProviderPart, outcome: VoiceOutcome): void {
        const report: VoiceHealthReport =
            outcome.ok === true
                ? { part, ok: true, botId: this.botId }
                : { part, ok: false, botId: this.botId, ...(outcome.status !== undefined ? { status: outcome.status } : {}), ...(outcome.rejected ? { rejected: true } : {}) };
        try {
            this.orbit.reportVoiceHealth(providerId, report, this.options.timeoutMs).catch((error) => this.log(`voice: could not tell Orbit how provider ${providerId} did (${describe(error)})`));
        } catch (error) {
            this.log(`voice: could not tell Orbit how provider ${providerId} did (${describe(error)})`);
        }
    }
}

interface Credentials {
    adapter: string;
    key: string;
    recognition?: boolean;
    speech?: boolean;
    endpoint?: string;
    region?: string;
}

/** The endpoint and region of a provider, only when it has them. */
function connection(credentials: Credentials): { endpoint?: string; region?: string } {
    return { ...(credentials.endpoint ? { endpoint: credentials.endpoint } : {}), ...(credentials.region ? { region: credentials.region } : {}) };
}

function replyLimitsOf(limits: Partial<VoiceLimits> | null | undefined): SpeakingNow['replyLimits'] | undefined {
    const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined);
    const maxChars = whole(limits?.replyCharacters);
    const maxSeconds = whole(limits?.replySeconds);
    if (maxChars === undefined && maxSeconds === undefined) return undefined;
    return { ...(maxChars !== undefined ? { maxChars } : {}), ...(maxSeconds !== undefined ? { maxSeconds } : {}) };
}

/** A line about a failed call that cannot carry a key: the status or the error's code, never its request or answer. */
function describe(error: unknown): string {
    const e = error as { response?: { status?: number }; code?: string; message?: string } | undefined;
    if (e?.response?.status) return `status ${e.response.status}`;
    if (typeof e?.code === 'string') return e.code;
    return error instanceof Error ? error.constructor.name : 'error';
}
