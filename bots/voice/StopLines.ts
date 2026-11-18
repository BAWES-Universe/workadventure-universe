/**
 * The words a person is told when something Universe pays for pauses (billing consensus v2, P3; the Budget page mock, "What people see in the game").
 *
 * Five reasons are kept apart because each one needs different words: the person's own allowance (theirs to know, with the date it comes back and a way to
 * ask for more), the platform's budget or a provider's money (nobody's fault, no date, no number, nothing to do), a temporary hold (waiting helps, nothing
 * is said), and capacity (busy for a moment). A visitor and a member get the same neutral line unless it is their own allowance. Never a price, never a
 * balance, never a name of a company, never the Universe team's money.
 *
 * Pure: this builds the line. Where it is said (the chat, a card under it) is decided by whoever asks.
 */
import type { QuestionAction, QuestionAsked } from '../mcp/QuestionCard';
import { STOPPED_BY, type StoppedBy } from './VoiceAllowance';

/** What stopped: a spoken reply, live hearing of a person, a voice note, or a step of an App. */
export type StopWhat = 'reply' | 'hearing' | 'note' | 'app';

export interface StopNotice {
    by: StoppedBy;
    what: StopWhat;
    /** When it comes back, as an ISO time: only for the person's own allowance. Never for a budget or a provider. */
    resetsAt?: string;
    /** A voice note: whether its words were already read before it was turned down. */
    transcribed?: boolean;
    /** An App step: what the person asked for in a few words ("add it to Notion"), when the model said. */
    doing?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** "1 Dec": the day it comes back, in UTC (the month turns at one moment for everyone). */
export function dayWords(iso: string): string {
    const at = new Date(iso);
    return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/**
 * When the person's own allowance is back, in plain words: a date when it is more than a day away (a month's time), "in about N hours" when it is
 * nearer (a window of hours), and nothing when no time was given.
 */
export function backWhen(resetsAt: string | undefined, now: number = Date.now()): string | null {
    if (!resetsAt) return null;
    const at = Date.parse(resetsAt);
    if (Number.isNaN(at)) return null;
    const left = at - now;
    if (left <= 0) return 'in a moment';
    if (left >= DAY_MS * 1.5) return `on ${dayWords(resetsAt)}`;
    const hours = Math.max(1, Math.round(left / 3_600_000));
    return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
}

/** Whether the person's own allowance is a month's (the date is far away): "this month's voice time" is only said then. */
const isMonth = (resetsAt: string | undefined, now: number): boolean => !!resetsAt && Date.parse(resetsAt) - now >= DAY_MS * 1.5;

/**
 * The line for one stop, or null when nothing is said (a hold: it passes by itself). `now` is for tests.
 */
export function stopLine(notice: StopNotice, now: number = Date.now()): string | null {
    const when = notice.by === 'person' ? backWhen(notice.resetsAt, now) : null;
    const used = isMonth(notice.resetsAt, now) ? "this month's voice time" : 'your voice time for now';
    switch (notice.what) {
        case 'reply':
        case 'hearing':
            switch (notice.by) {
                case 'person':
                    return when ? `I'll answer in text: you've used ${used}. It comes back ${when}.` : `I'll answer in text: you've used ${used}.`;
                case 'budget':
                case 'provider':
                    return "Voice replies are paused for now, so I'll answer in text.";
                case 'capacity':
                    return "Voice is busy for a moment, so I'll answer in text this time.";
                case 'hold':
                    return null;
            }
            return null;
        case 'note': {
            // A note turned down says plainly whether it was read: a person must never wonder whether their words were lost
            const heard = notice.transcribed === true;
            const lead = heard ? 'I read your voice message but I can\'t answer it' : "I couldn't listen to your voice message";
            switch (notice.by) {
                case 'person':
                    return `${lead}: you've used ${used}.${when ? ` It comes back ${when}.` : ''} Could you type it? Everything else works as usual.`;
                case 'budget':
                case 'provider':
                    return `${lead}: voice is paused for now. Could you type it? Everything else works as usual.`;
                case 'capacity':
                    return `${lead} right now: voice is busy. Could you send it again in a moment, or type it?`;
                case 'hold':
                    return `${lead} just now. Could you send it again in a moment, or type it?`;
            }
            return null;
        }
        case 'app': {
            const what = notice.doing ? notice.doing : 'do that';
            switch (notice.by) {
                case 'person':
                    return `I can't ${what} right now: this month's App use is used up.${when ? ` It comes back ${when}.` : ''} I can ask the Universe team for more.`;
                case 'budget':
                case 'provider':
                    return `Apps are paused for now, so I can't ${what} right now. Nothing you need to do.`;
                case 'capacity':
                    return `Apps are busy for a moment, so I can't ${what} just yet. Try again in a moment.`;
                case 'hold':
                    return null;
            }
            return null;
        }
    }
}

/** What Orbit says about an App step it held back (`result._meta["universe/stop"]` of the step's answer), read with care: nothing else is trusted. */
export interface AppStop {
    by: StoppedBy;
    resetsAt?: string;
    canAskForMore: boolean;
}

export function readAppStop(meta: unknown): AppStop | null {
    if (!meta || typeof meta !== 'object') return null;
    const raw = (meta as Record<string, unknown>)['universe/stop'];
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const by = STOPPED_BY.find((reason) => reason === o.by);
    if (!by) return null;
    // A date is only ever the person's own allowance coming back: a budget or a provider has none to say
    const resetsAt = by === 'person' && typeof o.resetsAt === 'string' && !Number.isNaN(Date.parse(o.resetsAt)) ? o.resetsAt : undefined;
    return { by, ...(resetsAt ? { resetsAt } : {}), canAskForMore: by === 'person' && o.canAskForMore === true };
}

/**
 * What the model reads when an App step was held back: nothing was done, and the one line to say (or, for a hold that passes, nothing to say). `stopped`
 * is for the game: it shows the Ask for more card for the person's own allowance. Never a price, a company or a balance.
 */
export function appStopResult(stop: AppStop, now: number = Date.now()): Record<string, unknown> {
    const line = stopLine({ by: stop.by, what: 'app', ...(stop.resetsAt ? { resetsAt: stop.resetsAt } : {}) }, now);
    const stopped = { by: stop.by, ...(stop.resetsAt ? { resetsAt: stop.resetsAt } : {}), canAskForMore: stop.canAskForMore };
    if (!line) {
        return {
            error: 'That step is held for a moment and was not done.',
            outcome: 'not_sent',
            stopped,
            hint: 'Nothing was done. It passes by itself: say nothing about it, wait a moment and try the same step once more. If it is held again, carry on without it.',
        };
    }
    return {
        error: line,
        outcome: 'not_sent',
        stopped,
        hint: `Nothing was done. Say it in one plain sentence in their language, in these words: "${line}". Never say a price, an amount, a balance or the name of a company.${
            stop.canAskForMore ? ' A card under it lets them ask for more: do not list its choices.' : ' It is nothing they can fix: never suggest asking for more.'
        } Carry on without it if you can.`,
    };
}

/** Whether the person can do something about this stop: only their own allowance has a way to ask for more. */
export const canAskForMore = (by: StoppedBy): boolean => by === 'person';

/** The question card under a person's own stop (mock: "Voice time is used up" with "Ask for more" and "Text is fine"). Nothing for any other stop. */
export function askMoreCard(notice: Pick<StopNotice, 'by' | 'what' | 'resetsAt'>, now: number = Date.now()): StopCard | null {
    if (notice.by !== 'person') return null;
    if (notice.what === 'app') return appAskMoreCard(notice.resetsAt, now);
    const when = backWhen(notice.resetsAt, now);
    return {
        question: 'Voice time is used up',
        choices: [
            { label: 'Ask for more', line: "The Universe team gets your request. I talk again once it's added", action: { kind: 'ask-for-more', category: 'speech' } },
            {
                label: 'Text is fine',
                line: when ? `I keep answering in text until it comes back ${when}` : 'I keep answering in text',
                action: { kind: 'dismiss', line: when ? `Okay, I'll keep answering in text until it comes back ${when}.` : "Okay, I'll keep answering in text." },
            },
        ],
    };
}

function appAskMoreCard(resetsAt: string | undefined, now: number): StopCard {
    const when = backWhen(resetsAt, now);
    return {
        question: 'App use is used up',
        choices: [
            { label: 'Ask for more', line: "The Universe team gets your request. I go on once it's added", action: { kind: 'ask-for-more', category: 'apps' } },
            {
                label: when ? 'Wait until it comes back' : 'Leave it for now',
                line: when ? `I'll leave it until it comes back ${when}` : "I'll leave it for now",
                action: { kind: 'dismiss', line: when ? `Okay, I'll leave it until it comes back ${when}.` : "Okay, I'll leave it for now." },
            },
        ],
    };
}

export interface StopCard {
    question: string;
    choices: Array<{ label: string; line: string; action: QuestionAction }>;
}

/** The question card of a stop as the question-card machinery takes it (ids c1, c2: what a tap names, never the words). */
export function stopQuestion(card: StopCard): QuestionAsked {
    return {
        question: card.question,
        choices: card.choices.map((choice, index) => ({ id: `c${index + 1}`, label: choice.label, line: choice.line, action: choice.action })),
        multiple: false,
    };
}

/** What is said once the person's ask went to Orbit. */
export const ASKED_LINE = "Asked. I'll tell you the moment it's added.";
/** What is said when the person's own allowance grew after they asked. */
export const GIVEN_LINE = 'Good news: the Universe team gave you more voice time. I can talk again.';
