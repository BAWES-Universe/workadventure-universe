/**
 * "Hear <bot> say hello" (#1852): the bot page's way to let a maker hear their bot's real voice. The bot writes a short hello
 * with its own brain (its own instructions, on its own AI), and the voice worker speaks it once with the voice and style the
 * bot speaks with, exactly as a bubble would (same provider, model and key). The audio goes back to the maker's browser; nothing is
 * said in any bubble and nothing is saved.
 *
 * What it costs is what a spoken reply costs: when Universe AI pays for the voice it is one of the maker's own voice replies
 * (counted by Orbit under one id, and given back when no audio came of it); when a lent key pays it is that key's characters, and
 * no allowance is touched. A voice that is off, a key that can't be read or an Orbit that can't be asked says so and says nothing
 * out loud. Nothing here puts a key, the bot's instructions or a provider's own words in an answer or a log line.
 */
import { parseEmotionsFromResponse } from '../ai/EmotionParser';
import type { AllowanceOrbit } from './VoiceAllowance';
import { SPOKEN_PHRASES, spokenVersion } from './SpokenText';
import type { VoiceSettings } from './VoiceSettings';

/** How long the bot may take to write its hello, in milliseconds. */
export const HELLO_WRITE_TIMEOUT_MS = 15_000;
/** How long the worker may take to speak it, in milliseconds. */
export const HELLO_SPEAK_TIMEOUT_MS = 30_000;
/** The most of the hello that is spoken, in characters. It is asked to be two short sentences. */
export const HELLO_MAX_CHARS = 400;
/** The longest the hello plays, in seconds. */
export const HELLO_MAX_SECONDS = 20;

const DEFAULT_INSTRUCTIONS = 'You are a helpful bot.';

/** The person who set up the voice is about to hear the bot for the first time: this is what the bot is asked. */
function helloPrompts(bot: { name: string; chatInstructions?: string }, language: { pinned?: string; reading?: string }): { system: string; user: string } {
    const where = language.pinned
        ? `Say it in the language with the code "${language.pinned}".`
        : language.reading
          ? `The person is using the game in ${language.reading}. Say it in that language, unless your instructions say you speak another.`
          : 'Say it in the language your instructions use.';
    return {
        system: `${bot.chatInstructions || DEFAULT_INSTRUCTIONS}\n\nYour name is ${bot.name}.`,
        user: [
            'Someone who looks after you has just given you a voice, and is listening to hear you for the first time.',
            'Say hello to them, in your own words, the way you greet a person who walks up to you. One or two short sentences.',
            where,
            'Spoken words only: no emoji, no markdown, no stage directions, no quotation marks. Do not say this is a test.',
        ].join('\n'),
    };
}

/** What the bot wrote as words to say: no emotion block, no quotation marks around it, and no "rest is in the chat" tail. */
export function helloWords(written: string): string {
    let text = parseEmotionsFromResponse(written).cleanedResponse.trim();
    const quoted = /^["“«'‘](.+)["”»'’]$/s.exec(text);
    if (quoted) text = quoted[1].trim();
    const spoken = spokenVersion(text, HELLO_MAX_CHARS);
    const tail = ` ${SPOKEN_PHRASES.rest}`;
    return spoken.endsWith(tail) ? spoken.slice(0, -tail.length).trim() : spoken;
}

/** The bot as it is saved in Orbit, as far as a hello needs it. */
export interface HelloBot {
    name: string;
    chatInstructions?: string;
    aiProviderRef?: string;
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
    bot(botId: string): Promise<HelloBot | null>;
    /** One short piece of text from the bot's own AI; empty when it can't be had. */
    write(aiProviderRef: string, system: string, user: string, botId: string, timeoutMs: number): Promise<string>;
    preview(request: HelloPreviewRequest, timeoutMs: number): Promise<HelloPreviewAnswer>;
    newId(): string;
    log?(message: string): void;
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
    /** The bot wrote nothing to say. */
    | { status: 502; error: 'no_words' }
    /** The voice company refused or failed: `status` is its HTTP status, `rejected` that it refused the key itself. */
    | { status: 502; error: 'provider'; providerStatus?: number; rejected: boolean };

export type HelloResult = { ok: true; text: string; wav: Buffer; ms: number } | ({ ok: false } & HelloFailure);

const fail = (failure: HelloFailure): HelloResult => ({ ok: false, ...failure });

/** The language name to put in the bot's prompt for a game locale such as "ar-SA", or undefined when it is not one. */
function readingLanguage(locale: string | undefined): string | undefined {
    if (!locale || !/^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(locale)) return undefined;
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale.split(/[-_]/)[0]) ?? undefined;
    } catch {
        return undefined;
    }
}

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
            const bot = await this.ports.bot(botId);
            if (!bot) return fail({ status: 404, error: 'unknown_bot' });
            if (!bot.aiProviderRef) return fail({ status: 502, error: 'no_words' });

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

            const prompts = helloPrompts(bot, { pinned: active.profile.language, reading: readingLanguage(input.locale) });
            let written = '';
            try {
                written = await this.ports.write(bot.aiProviderRef, prompts.system, prompts.user, botId, HELLO_WRITE_TIMEOUT_MS);
            } catch {
                written = '';
            }
            const text = helloWords(written);
            if (!text) return fail({ status: 502, error: 'no_words' });

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
