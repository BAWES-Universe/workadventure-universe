/**
 * BotAccessGate: asks Orbit whether a person may chat with a bot nearby or summon it, before anything reaches the
 * bot's AI (game #1158). Orbit decides (roles, the bot's own rules, Private bot); this keeps the answer for a short
 * while so a chat does not wait on Orbit for every message, and says what to do when Orbit cannot answer:
 *
 * - a fresh answer (under 30 seconds old) is used as it is;
 * - when Orbit cannot be reached, the last answer for that person stands;
 * - with none, the person is told the bot cannot check right now, and nothing is let through. It never fails silently.
 */
import * as Sentry from '@sentry/node';
import type { AdminApiService, BotAccessAction, BotAccessAnswer, BotAccessPerson } from './AdminApiService';

/** An answer this young is used without asking Orbit again, so an owner's change reaches people within this time. */
export const ACCESS_CACHE_TTL_MS = 30_000;
/** More people than a bot server holds answers for at once; the oldest answers go first. */
const MAX_REMEMBERED_ANSWERS = 5_000;
/** Orbit being down is reported to Sentry at most this often, not once per message. */
const REPORT_EVERY_MS = 60_000;

export type BotAccessVerdict =
    | { allowed: true; kind: 'allowed' }
    /** Orbit said no. `line` is what the person hears: the owner's own line for a chat, Orbit's reason otherwise. */
    | { allowed: false; kind: 'refused'; code: BotAccessAnswer['code']; line: string }
    /** Orbit could not answer and there is no earlier answer for this person. Nothing is let through. */
    | { allowed: false; kind: 'cannot_check'; line: string };

type Checker = Pick<AdminApiService, 'isConfigured' | 'checkBotAccess'>;

/** What the bot says in chat when it cannot ask Orbit and has no earlier answer. */
export const CANNOT_CHECK_CHAT_LINE = "I can't check that right now, try again soon.";

function cannotCheckLine(action: BotAccessAction, botName: string | undefined): string {
    if (action === 'chat') return CANNOT_CHECK_CHAT_LINE;
    return `${botName || 'The bot'} can't check that right now. Try again soon.`;
}

function refusalLine(action: BotAccessAction, botName: string | undefined, answer: BotAccessAnswer): string {
    const owner = botName || 'The bot';
    if (action === 'chat') return answer.reply || answer.reason || `${owner}'s owner limits who can chat with it.`;
    if (action === 'summon') return answer.reason || `${owner}'s owner limits who can summon it.`;
    return answer.reason || `You can't message ${owner} now.`;
}

export class BotAccessGate {
    private readonly answers = new Map<string, { answer: BotAccessAnswer; at: number }>();
    private readonly asking = new Map<string, Promise<BotAccessAnswer>>();
    private lastReportAt = 0;

    constructor(
        private readonly orbit: Checker,
        private readonly now: () => number = Date.now
    ) {}

    /** Can this person do this with this bot? Never throws. */
    async check(
        botId: string,
        action: BotAccessAction,
        person: BotAccessPerson,
        botName?: string
    ): Promise<BotAccessVerdict> {
        // Without an Orbit to ask (a self-hosted bot server on its own) there is nothing to limit who uses a bot.
        if (!this.orbit.isConfigured()) return { allowed: true, kind: 'allowed' };

        const key = `${botId}|${action}|${person.signedIn && person.identifier ? `user:${person.identifier}` : 'guest'}`;
        const known = this.answers.get(key);
        let answer: BotAccessAnswer | undefined;
        if (known && this.now() - known.at < ACCESS_CACHE_TTL_MS) {
            answer = known.answer;
        } else {
            try {
                answer = await this.ask(key, botId, action, person);
            } catch (error) {
                this.report(error);
                // Orbit cannot answer: the last answer for this person stands, however old.
                answer = known?.answer;
            }
        }

        if (!answer) return { allowed: false, kind: 'cannot_check', line: cannotCheckLine(action, botName) };
        if (answer.allowed) return { allowed: true, kind: 'allowed' };
        return { allowed: false, kind: 'refused', code: answer.code, line: refusalLine(action, botName, answer) };
    }

    /** One question to Orbit at a time for the same person and bot: messages sent together share the answer. */
    private ask(key: string, botId: string, action: BotAccessAction, person: BotAccessPerson): Promise<BotAccessAnswer> {
        const pending = this.asking.get(key);
        if (pending) return pending;

        const question = this.orbit
            .checkBotAccess(botId, action, person)
            .then((answer) => {
                this.remember(key, answer);
                return answer;
            })
            .finally(() => {
                this.asking.delete(key);
            });
        this.asking.set(key, question);
        return question;
    }

    private remember(key: string, answer: BotAccessAnswer): void {
        // Re-inserting moves the key to the back, so the front of the map is always the oldest answer
        this.answers.delete(key);
        this.answers.set(key, { answer, at: this.now() });
        while (this.answers.size > MAX_REMEMBERED_ANSWERS) {
            const oldest = this.answers.keys().next().value;
            if (oldest === undefined) break;
            this.answers.delete(oldest);
        }
    }

    private report(error: unknown): void {
        console.error('[BotAccessGate] Could not ask Orbit who may use a bot:', error instanceof Error ? error.message : error);
        const now = this.now();
        if (now - this.lastReportAt < REPORT_EVERY_MS) return;
        this.lastReportAt = now;
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
            tags: { area: 'bot-access' },
        });
    }
}
