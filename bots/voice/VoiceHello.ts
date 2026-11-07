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

/** The line for a language code such as "ar-KW", or a game locale such as "fr-FR"; English where there is none (or no language). */
export function helloLine(...languages: Array<string | undefined>): string {
    for (const language of languages) {
        if (!language || !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(language)) continue;
        const line = HELLO_LINES[language.split(/[-_]/)[0].toLowerCase()];
        if (line) return line;
    }
    return HELLO_LINES.en;
}

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
    speech: { adapter: string; model: string; voiceId: string; key: string; endpoint?: string; region?: string; language?: string };
    text: string;
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
    /** The voice company refused or failed: `status` is its HTTP status, `rejected` that it refused the key itself. */
    | { status: 502; error: 'provider'; providerStatus?: number; rejected: boolean };

/** `cached`: it was made earlier and is played again: nothing was counted and nothing was asked of the voice company. */
export type HelloResult = { ok: true; text: string; wav: Buffer; ms: number; cached?: true } | ({ ok: false } & HelloFailure);

const fail = (failure: HelloFailure): HelloResult => ({ ok: false, ...failure });

export class VoiceHello {
    /** Hellos being made, by bot and person: one at a time each. */
    private readonly making = new Set<string>();

    constructor(private readonly ports: HelloPorts) {}

    async say(input: { botId: string; personId: string; locale?: string }): Promise<HelloResult> {
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
            const active = await settings.active();
            if ('reason' in active) {
                if (active.reason === 'orbit') return fail({ status: 503, error: 'unavailable' });
                if (active.reason === 'unknown-bot') return fail({ status: 404, error: 'unknown_bot' });
                return fail({ status: 409, error: 'voice_off', reason: active.reason });
            }
            const session = await settings.sessionSettings(active);
            if (!session) return fail({ status: 503, error: 'unavailable' });

            // The language the voice is set to speak, else the one the game is read in
            const text = helloLine(active.profile.language, input.locale);
            const cacheKey = this.ports.cache ? helloCacheKey({ speechProviderId: active.providers.speech.providerId, speech: session.speech, expression: session.expression, text }) : null;
            const heard = cacheKey ? this.ports.cache?.get(cacheKey) : undefined;
            // Heard already, with this very voice: played again, free, and no allowance is touched
            if (heard) return { ok: true, text: heard.text, wav: heard.wav, ms: heard.ms, cached: true };

            // Universe AI pays for the voice: this hello is one of the maker's own voice replies, counted under its own id
            if (!active.providers.speech.owner) {
                const verdict = await this.ports.allowance.checkVoiceAllowance(botId, { userId: personId, isGuest: false, turnId });
                if (!verdict) {
                    this.ports.log?.('voice hello: could not settle the allowance, nothing is said');
                    return fail({ status: 503, error: 'unavailable' });
                }
                if (verdict.allowed === false) return fail({ status: 429, error: 'used_up', resetsAt: verdict.resetsAt });
                counted = true;
            }

            const answer = await this.ports.preview({ speech: session.speech, text, expression: session.expression, maxSeconds: HELLO_MAX_SECONDS }, HELLO_SPEAK_TIMEOUT_MS);
            if (answer.ok === false) {
                if (answer.kind === 'provider') {
                    // The maker's own key tells Orbit how the call went, as it does for a bubble
                    if (active.providers.speech.owner) {
                        settings.report(active.providers.speech.providerId, 'speech', {
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
            if (active.providers.speech.owner) settings.report(active.providers.speech.providerId, 'speech', { ok: true });
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
