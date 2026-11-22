/**
 * "Try again" carries on (piece 8 of the computer controls). After a computer job that failed (ours, or the agent's own: Orbit's `agent`) or that we ended (`error`, `pool`, `unanswered`, `allowance`, `rule`), the person's
 * "try again" is a NEW job that carries on in the old job's conversation on the computer, so the agent knows what it already did instead of starting from zero. After the person's own Stop or
 * Cancel, a finished job, or a computer turned off or deleted, it is a fresh job, as before.
 *
 * Orbit decides which job that is, on every ask, from its own record (`retry` on the computer look, and again at the start). The game asks for it ONLY when the person's words ask to try again or
 * carry on (`asksToTryAgain`), or when this is the person's first message after Brick told them how that job ended (its report asks "Want me to try again?", and a plain "yes" answers it). Then
 * Brick is told, for this turn only, which job "try again" would carry on (`tryAgainNote`), and `use_computer` with `try_again: true` names it to Orbit. Nothing here is a setting: it is on for
 * every person with a computer.
 */

/** The job "try again" would carry on, as Orbit names it (GET computer-jobs?retry=1). */
export interface RetryJob {
    id: string;
    title: string;
    /** How it ended, in Orbit's words. */
    how: string;
    /** When Brick told the person how it ended (ms), or null while it has not. */
    toldAt: number | null;
}

/** Orbit's `retry`, kept only when it has what a hint needs. */
export function retryJobOf(raw: unknown): RetryJob | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const value = raw as { id?: unknown; title?: unknown; how?: unknown; toldAt?: unknown };
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value.id) || typeof value.title !== 'string' || !value.title.trim() || typeof value.how !== 'string') return null;
    const told = typeof value.toldAt === 'string' ? Date.parse(value.toldAt) : NaN;
    return { id: value.id, title: value.title.trim().slice(0, 200), how: value.how, toldAt: Number.isFinite(told) ? told : null };
}

/**
 * The words that ask to try a job again or carry on with it, in the languages Brick's owners write in most (English and Arabic, Gulf and standard). Matched on whole words after the text is
 * lowered and its punctuation and Arabic marks are taken out. A list here, not a model's guess: the model decides only whether the person means THAT job.
 */
const TRY_AGAIN_PHRASES: readonly string[] = [
    // English
    'try again',
    'try it again',
    'try that again',
    'try once more',
    'one more try',
    'another try',
    'another go',
    'have another go',
    'give it another go',
    'give it another try',
    'retry',
    're try',
    'redo it',
    'do it again',
    'again please',
    'please again',
    'carry on',
    'continue',
    'keep going',
    'go on',
    'pick it up',
    'pick up where',
    'where you left off',
    'where it stopped',
    'finish it',
    'finish the job',
    'resume',
    // Arabic (standard and Gulf)
    'حاول مرة ثانية',
    'حاول مرة اخرى',
    'حاول مره ثانيه',
    'حاول مره اخرى',
    'حاول مرة ثانيه',
    'حاول ثاني',
    'جرب مرة ثانية',
    'جرب مرة اخرى',
    'جرب مره ثانيه',
    'جرب مره اخرى',
    'جرب ثاني',
    'عيدها',
    'اعدها',
    'مرة ثانية',
    'مره ثانيه',
    'مرة اخرى',
    'مره اخرى',
    'كمل',
    'كملها',
    'اكمل',
    'اكملها',
    'استمر',
    'كمل من وين وقفت',
    'كمل الشغل',
];

/** Lowered, Arabic marks and letter forms made one (أ إ آ to ا, ة kept, ى to ي), punctuation to spaces, single spaces. */
export function plainWords(text: string): string {
    return ` ${text
        .toLowerCase()
        .replace(/[ً-ٰٟـ]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()} `;
}

const PLAIN_PHRASES = TRY_AGAIN_PHRASES.map((phrase) => plainWords(phrase));

/** Whether the person's words ask to try a job again or carry on with it. */
export function asksToTryAgain(text: string | undefined | null): boolean {
    if (!text) return false;
    const said = plainWords(text.slice(0, 2000));
    return PLAIN_PHRASES.some((phrase) => said.includes(phrase));
}

/**
 * Whether "try again" is offered to Brick in this turn: Orbit names a job, and either the person's words ask for it, or this is their first message since Brick told them how that job ended
 * (`previousAt`: when the person's message before this one was written, ms; undefined when this is their first).
 */
export function offersTryAgain(retry: RetryJob | null, text: string | undefined | null, previousAt: number | undefined): boolean {
    if (!retry) return false;
    if (asksToTryAgain(text)) return true;
    return retry.toldAt !== null && (previousAt === undefined || previousAt < retry.toldAt);
}

const HOW_WORDS: Record<string, string> = {
    error: 'could not finish because of a problem on our side',
    pool: 'was stopped because our computers were too busy',
    unanswered: 'stopped waiting for them at a step that needed them',
    allowance: "stopped when this month's computer time ran out",
    rule: 'stopped because of a spending limit they set',
    agent: 'stopped at a step it could not get past',
};

/** The line for the model in this turn: which job "try again" would carry on, and how to ask for it. No price, no number, nothing for the person to read. */
export function tryAgainNote(retry: RetryJob): string {
    const title = retry.title.replace(/["“”]/g, "'");
    const how = HOW_WORDS[retry.how] ?? 'ended before it was finished';
    return (
        `Try again: your computer job "${title}" ${how}. If the person asks you to try it again or carry on with it (a plain yes to your offer to try again counts), call use_computer with job "${title}" and try_again true: ` +
        'it carries on in the same conversation on your computer, from where it stopped, as a new job with its own receipt. If they ask for something else, leave try_again out.'
    );
}
