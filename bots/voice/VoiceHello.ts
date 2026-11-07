/**
 * "Hear this voice say hello" (#1852): the bot page's way to let a maker hear the voice a bot speaks with. The voice worker says one
 * short, fixed line (the same for every bot, in the language of the voice or of the game) with the provider, model, voice and style
 * a bubble would use. The audio goes back to the maker's browser; nothing is said in any bubble and nothing is saved.
 *
 * A line that never changes can be kept: the audio is reused, for the same voice, model, style and language, for a while (see
 * HelloCache), so a maker trying a voice again and again pays for it once. What the first one costs is what a spoken reply costs: on
 * Universe AI it is one of the maker's own voice replies (counted by Orbit under one id, and given back when no audio came of it);
 * on a lent key it is that key's characters, and no allowance is touched. A voice that is off, a key that can't be read or an
 * Orbit that can't be asked says so and says nothing out loud. Nothing here puts a key or a provider's own words in an answer or a
 * log line.
 */
import { createHash } from 'crypto';
import type { AllowanceOrbit } from './VoiceAllowance';
import type { VoiceSettings } from './VoiceSettings';

/** The speech adapter of a person's own OpenAI-compatible speech server (Speaches, Kokoro-FastAPI, a Whisper of their own). */
export const OWN_SERVER_ADAPTER = 'openai-compatible';
/** The longest voice name a bot keeps (Orbit saves up to this many characters). */
export const VOICE_NAME_MAX = 255;

/** A typed voice name as sent: one line of text of at most `VOICE_NAME_MAX` characters, trimmed, or nothing when it is not that. */
export function typedVoiceName(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const name = value.trim();
    // eslint-disable-next-line no-control-regex
    return name.length > 0 && name.length <= VOICE_NAME_MAX && !/[\u0000-\u001f\u007f]/.test(name) ? name : undefined;
}

/** How long the worker may take to speak it, in milliseconds. */
export const HELLO_SPEAK_TIMEOUT_MS = 30_000;
/** The longest the hello plays, in seconds. */
export const HELLO_MAX_SECONDS = 20;

/**
 * The line, by language: a greeting to the universe and a few words on what is being heard. It names no bot, says nothing a bot
 * would say about itself and has no gender. "Universe" stays as it is, being the product's name.
 */
export const HELLO_LINES: Readonly<Record<string, string>> = {
    en: 'Hello, Universe. This is how I sound.',
    ar: 'مرحبًا يا Universe. هذا هو صوتي.',
    ca: 'Hola, Universe. Així sona la meva veu.',
    de: 'Hallo, Universe. So klinge ich.',
    es: 'Hola, Universe. Así suena mi voz.',
    fr: 'Bonjour, Universe. Voilà à quoi ressemble ma voix.',
    it: 'Ciao, Universe. Ecco come suona la mia voce.',
    ja: 'こんにちは、Universe。これが私の声です。',
    ko: '안녕하세요, Universe. 제 목소리는 이렇습니다.',
    nl: 'Hallo, Universe. Zo klink ik.',
    pt: 'Olá, Universe. É assim que a minha voz soa.',
    zh: '你好，Universe。这就是我的声音。',
};

/**
 * The line for a language code such as "ar-KW", or a game locale such as "fr-FR", and the code of the language it is in: the first
 * one there is a line for, else English. The code goes to the voice company with the line, so a voice that follows the person's
 * language says it in that language and not with an English model.
 */
export function helloIn(...languages: Array<string | undefined>): { lang: string; text: string } {
    for (const language of languages) {
        if (!language || !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(language)) continue;
        const lang = language.split(/[-_]/)[0].toLowerCase();
        const text = HELLO_LINES[lang];
        if (text) return { lang, text };
    }
    return { lang: 'en', text: HELLO_LINES.en };
}

export const helloLine = (...languages: Array<string | undefined>): string => helloIn(...languages).text;

/** How long a hello is kept and how much of it, so a maker testing the same voice again and again is not paying for it each time. */
export interface HelloCacheSettings {
    /** How long one hello is reused, in milliseconds. 0 keeps nothing. */
    ttlMs: number;
    /** The most audio kept at once, in bytes. The oldest goes first. */
    maxBytes: number;
}

interface HelloHeard {
    text: string;
    wav: Buffer;
    ms: number;
}

/**
 * The hello that was just made, kept in memory for a while under everything that changes what is heard (see `helloCacheKey`): a
 * changed voice, model, style or language is a new hello, and only the first one is paid for. It is the same for every bot with
 * that voice, since the line names none. It lives in this process and is gone when the bot server restarts.
 */
export class HelloCache {
    private readonly entries = new Map<string, HelloHeard & { at: number }>();
    private bytes = 0;

    constructor(
        readonly settings: HelloCacheSettings,
        private readonly now: () => number = Date.now
    ) {}

    get(key: string): HelloHeard | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (this.now() - entry.at >= this.settings.ttlMs) {
            this.drop(key);
            return undefined;
        }
        // Used again: it is the last to go
        this.entries.delete(key);
        this.entries.set(key, entry);
        return { text: entry.text, wav: entry.wav, ms: entry.ms };
    }

    set(key: string, heard: HelloHeard): void {
        if (this.settings.ttlMs <= 0 || heard.wav.length > this.settings.maxBytes) return;
        this.drop(key);
        this.entries.set(key, { ...heard, at: this.now() });
        this.bytes += heard.wav.length;
        for (const oldest of this.entries.keys()) {
            if (this.bytes <= this.settings.maxBytes) break;
            this.drop(oldest);
        }
    }

    private drop(key: string): void {
        const entry = this.entries.get(key);
        if (!entry) return;
        this.entries.delete(key);
        this.bytes -= entry.wav.length;
    }
}

/**
 * What makes one hello different from another: who speaks it (the provider the voice comes from), the model, voice and style, the
 * language it is said in and the words. Hashed. The key is not in it: a voice company's key changing does not change what is heard.
 */
export function helloCacheKey(input: { speechProviderId: string; speech: HelloPreviewRequest['speech']; expression: string; text: string }): string {
    const { speech } = input;
    return createHash('sha256')
        .update(
            JSON.stringify([
                input.speechProviderId,
                speech.adapter,
                speech.model,
                speech.voiceId,
                speech.endpoint ?? '',
                speech.region ?? '',
                speech.language ?? '',
                input.expression,
                input.text,
            ])
        )
        .digest('hex');
}

/** What the worker is asked (its /preview): the speech settings of a bubble, with the words. */
export interface HelloPreviewRequest {
    speech: { adapter: string; model: string; voiceId: string; key?: string; endpoint?: string; region?: string; language?: string };
    text: string;
    /** The language the text is in, for a voice that follows the person's language. */
    lang?: string;
    expression: string;
    maxSeconds: number;
}

/** How the worker answered. `busy`: it is making its limit of these already. `down`: it could not be reached. */
export type HelloPreviewAnswer =
    | { ok: true; wav: Buffer; ms: number }
    | { ok: false; kind: 'provider'; status?: number; rejected: boolean }
    | { ok: false; kind: 'busy' | 'down' | 'refused' };

export interface HelloPorts {
    /** A fresh view of the bot's voice, so a change made a moment ago is heard. */
    voice(botId: string): VoiceSettings;
    allowance: Pick<AllowanceOrbit, 'checkVoiceAllowance' | 'releaseVoiceReply'>;
    preview(request: HelloPreviewRequest, timeoutMs: number): Promise<HelloPreviewAnswer>;
    newId(): string;
    log?(message: string): void;
    /** A hello made a moment ago with the same voice and language is played again instead of being paid for again. */
    cache?: HelloCache;
}

export type HelloFailure =
    /** The bot does not speak now (off, or not allowed here). `reason` is Orbit's. */
    | { status: 409; error: 'voice_off'; reason: string }
    | { status: 404; error: 'unknown_bot' }
    /** Orbit, the key or the voice worker could not be reached or used: nothing was said and nothing was counted. */
    | { status: 503; error: 'unavailable' }
    /** The maker's voice replies are used up until `resetsAt`. */
    | { status: 429; error: 'used_up'; resetsAt: string }
    /** A hello is already being made for this person and bot. */
    | { status: 429; error: 'busy' }
    /** A voice name was typed for a speech source that is not the person's own server: only a voice that source lists can be heard. */
    | { status: 409; error: 'voice_name_not_typed' }
    /** The voice company refused or failed: `status` is its HTTP status, `rejected` that it refused the key itself. */
    | { status: 502; error: 'provider'; providerStatus?: number; rejected: boolean };

/** `cached`: it was made earlier and is played again: nothing was counted and nothing was asked of the voice company. */
export type HelloResult = { ok: true; text: string; wav: Buffer; ms: number; cached?: true } | ({ ok: false } & HelloFailure);

const fail = (failure: HelloFailure): HelloResult => ({ ok: false, ...failure });

/** Where a typed voice name is heard from when the bot does not speak yet: the speech server (a provider of the person's own) and the model. */
export interface HelloSource {
    providerId: string;
    model: string;
}

/** The source a request names: two short texts, or nothing when it is not that. */
export function helloSourceOf(value: unknown): HelloSource | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const { providerId, model } = value as Record<string, unknown>;
    const fit = (text: unknown): text is string => typeof text === 'string' && text.length > 0 && text.length <= 200;
    return fit(providerId) && fit(model) ? { providerId, model } : undefined;
}

export class VoiceHello {
    /** Hellos being made, by bot and person: one at a time each. */
    private readonly making = new Set<string>();

    constructor(private readonly ports: HelloPorts) {}

    async say(input: { botId: string; personId: string; locale?: string; voiceId?: string; source?: HelloSource }): Promise<HelloResult> {
        const { botId, personId } = input;
        const mine = `${botId}\u0000${personId}`;
        if (this.making.has(mine)) return fail({ status: 429, error: 'busy' });
        this.making.add(mine);
        const turnId = `hello-${this.ports.newId()}`;
        // Set once Orbit has counted this hello against the person's voice replies; given back unless it was heard
        let counted = false;
        let delivered = false;
        try {
            const settings = this.ports.voice(botId);
            // Who speaks it: the bot's own voice, or (voice off, #1874) the speech server the person is setting up
            let speech: HelloPreviewRequest['speech'];
            let expression: string;
            let speechProviderId: string;
            let owner: boolean;
            let language: string | undefined;
            if (input.source) {
                // A voice name typed for a speech server of the person's own, heard before voice is on: the server and the name only
                if (input.voiceId === undefined || !settings.ownSpeech) return fail({ status: 503, error: 'unavailable' });
                const own = await settings.ownSpeech(input.source.providerId, input.source.model, input.voiceId);
                if (!own) return fail({ status: 503, error: 'unavailable' });
                if (own.adapter !== OWN_SERVER_ADAPTER) return fail({ status: 409, error: 'voice_name_not_typed' });
                speech = own;
                expression = 'natural';
                speechProviderId = input.source.providerId;
                // A key someone lent pays for it (a speech server of their own pays nobody), never Universe AI
                owner = true;
            } else {
                const active = await settings.active();
                if ('reason' in active) {
                    if (active.reason === 'orbit') return fail({ status: 503, error: 'unavailable' });
                    if (active.reason === 'unknown-bot') return fail({ status: 404, error: 'unknown_bot' });
                    return fail({ status: 409, error: 'voice_off', reason: active.reason });
                }
                const session = await settings.sessionSettings(active);
                if (!session) return fail({ status: 503, error: 'unavailable' });
                // A voice name typed a moment ago and not saved yet (#1874): heard only from the person's own speech server, where a name
                // is whatever that server calls a voice. Any other source has voices of its own to pick from, and keeps them.
                if (input.voiceId !== undefined && session.speech.adapter !== OWN_SERVER_ADAPTER) return fail({ status: 409, error: 'voice_name_not_typed' });
                speech = input.voiceId !== undefined ? { ...session.speech, voiceId: input.voiceId } : session.speech;
                expression = session.expression;
                speechProviderId = active.providers.speech.providerId;
                owner = active.providers.speech.owner;
                language = active.profile.language;
            }

            // The language the voice is set to speak, else the one the game is read in
            const { text, lang } = helloIn(language, input.locale);
            const cacheKey = this.ports.cache ? helloCacheKey({ speechProviderId, speech, expression, text }) : null;
            const heard = cacheKey ? this.ports.cache?.get(cacheKey) : undefined;
            // Heard already, with this very voice: played again, free, and no allowance is touched
            if (heard) return { ok: true, text: heard.text, wav: heard.wav, ms: heard.ms, cached: true };

            // Universe AI pays for the voice: this hello is one of the maker's own voice replies, counted under its own id
            if (!owner) {
                const verdict = await this.ports.allowance.checkVoiceAllowance(botId, { userId: personId, isGuest: false, turnId });
                if (!verdict) {
                    this.ports.log?.('voice hello: could not settle the allowance, nothing is said');
                    return fail({ status: 503, error: 'unavailable' });
                }
                if (verdict.allowed === false) return fail({ status: 429, error: 'used_up', resetsAt: verdict.resetsAt });
                counted = true;
            }

            const answer = await this.ports.preview({ speech, text, lang, expression, maxSeconds: HELLO_MAX_SECONDS }, HELLO_SPEAK_TIMEOUT_MS);
            if (answer.ok === false) {
                if (answer.kind === 'provider') {
                    // The maker's own key tells Orbit how the call went, as it does for a bubble. A typed name the server did not take
                    // says nothing of the key, so only a refusal of the key itself is told
                    if (owner && (input.voiceId === undefined || answer.rejected)) {
                        settings.report(speechProviderId, 'speech', {
                            ok: false,
                            ...(answer.status !== undefined ? { status: answer.status } : {}),
                            ...(answer.rejected ? { rejected: true } : {}),
                        });
                    }
                    return fail({ status: 502, error: 'provider', ...(answer.status !== undefined ? { providerStatus: answer.status } : {}), rejected: answer.rejected });
                }
                this.ports.log?.(`voice hello: the voice worker could not speak it (${answer.kind})`);
                return fail({ status: 503, error: 'unavailable' });
            }
            if (owner) settings.report(speechProviderId, 'speech', { ok: true });
            delivered = true;
            if (cacheKey) this.ports.cache?.set(cacheKey, { text, wav: answer.wav, ms: answer.ms });
            return { ok: true, text, wav: answer.wav, ms: answer.ms };
        } finally {
            this.making.delete(mine);
            if (counted && !delivered) {
                // Never spoken: the reply that was counted is given back (it gives back at most once, and never throws)
                void this.ports.allowance.releaseVoiceReply(botId, { turnId }).catch(() => undefined);
            }
        }
    }
}

/** The worker's /preview address, next to the bridge address the bot server already has. */
export function workerPreviewUrl(bridgeUrl: string): string {
    const url = new URL('preview', bridgeUrl.endsWith('/') ? bridgeUrl : `${bridgeUrl}/`);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.search = '';
    return url.toString();
}

/** Asks the worker to speak a line once. Never throws: a worker that can't be reached is `down`. Never puts the key in what it returns. */
export async function previewAtWorker(
    previewUrl: string,
    secret: string | undefined,
    request: HelloPreviewRequest,
    timeoutMs: number,
    fetcher: typeof fetch = fetch
): Promise<HelloPreviewAnswer> {
    try {
        const response = await fetcher(previewUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) {
            const wav = Buffer.from(await response.arrayBuffer());
            const ms = Number(response.headers.get('x-audio-ms'));
            return { ok: true, wav, ms: Number.isFinite(ms) && ms > 0 ? ms : 0 };
        }
        if (response.status === 429) return { ok: false, kind: 'busy' };
        if (response.status === 502) {
            const body = (await response.json().catch(() => ({}))) as { status?: unknown; rejected?: unknown };
            const status = typeof body.status === 'number' && Number.isInteger(body.status) ? body.status : undefined;
            return { ok: false, kind: 'provider', ...(status !== undefined ? { status } : {}), rejected: body.rejected === true };
        }
        // 400 (a request the worker doesn't take, an adapter it doesn't have), 401 (the secret), 5xx
        return { ok: false, kind: 'refused' };
    } catch {
        return { ok: false, kind: 'down' };
    }
}
