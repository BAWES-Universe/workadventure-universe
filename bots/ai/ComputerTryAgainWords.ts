/**
 * What the person reads when Orbit refuses to carry a job on ("try again"), GPT's sixth answer, finding 6.
 *
 * Orbit answers `{ ok: false, reason: 'cannot_continue', why }` and MAKES NOTHING: the game says why in these words and starts nothing. Where a new job would be a sensible next
 * step, the reply carries a separate "Start a new job" button; its tap is an ordinary new start, with its own key and the usual status line.
 *
 * WORDING STATUS
 *  - FINAL: every line below, word for word from Fable's approved strings of 23 Nov (`/mnt/project-files/brick-try-again-ineligible/strings.txt`, mock
 *    https://claude.ai/artifact/MejYUBSJcRYw5VENisiHar). They are never reworded here and never handed to the model to word.
 *  - DRAFT: `cannotCarryOn` only, for a `not_continuable` that Orbit sends with neither `endedBy` nor `status`: the approved set has no line for a reason nobody named. It is
 *    flagged to the release desk for Fable, and nothing of it is guessed (it names no reason at all).
 */
import { quotedTitle } from './JobStatusLine';
import type { ControlLine } from './ComputerControlWords';

/** Why Orbit will not carry a job on, as it names it. */
export type CannotContinueWhy = 'not_found' | 'not_theirs' | 'live' | 'not_continuable' | 'no_conversation';
/** What more Orbit says about a job it will not carry on: who or what ended it, and whether it had finished. */
export interface CannotContinueMore {
    endedBy?: 'person' | 'off';
    status?: string;
}

export const TRY_AGAIN_WORDS = {
    /** FINAL: they ended it themselves (Cancel, Stop). */
    endedByPerson: {
        titled: (title) => `${title} can't carry on, because you ended it. Its files are kept. I can start it again as a new job, from the beginning.`,
        plain: "That job can't carry on, because you ended it. Its files are kept. I can start it again as a new job, from the beginning.",
    } as ControlLine,
    /** FINAL: it ended because the computer was turned off (or deleted). */
    endedByOff: {
        titled: (title) => `${title} can't carry on, because it ended when my computer was turned off. I can start it again as a new job, from the beginning.`,
        plain: "That job can't carry on, because it ended when my computer was turned off. I can start it again as a new job, from the beginning.",
    } as ControlLine,
    /** FINAL: it finished, so there is nothing to carry on. */
    alreadyFinished: {
        titled: (title) => `${title} has already finished, so there's nothing to carry on. Its result and receipt are in this chat and in [Usage](#usage). I can do it again as a new job, from the beginning.`,
        plain: "That job has already finished, so there's nothing to carry on. Its result and receipt are in this chat and in [Usage](#usage). I can do it again as a new job, from the beginning.",
    } as ControlLine,
    /** FINAL: it ended before the computer had a conversation to carry on from. */
    noConversation: {
        titled: (title) => `${title} ended before my computer began working on it, so there's nothing to carry on from. I can start it as a new job.`,
        plain: "That job ended before my computer began working on it, so there's nothing to carry on from. I can start it as a new job.",
    } as ControlLine,
    /** FINAL: it has not ended at all (in line, working, or waiting for them). */
    stillLive: {
        titled: (title) => `${title} hasn't ended, so there's nothing to try again. The bar above this chat shows where it is.`,
        plain: "That job hasn't ended, so there's nothing to try again. The bar above this chat shows where it is.",
    } as ControlLine,
    /** FINAL: no job of theirs to carry on (not found, or not theirs: the same words for both, so nothing is learned from which it was). */
    noSuchJob: {
        titled: () => "I can't find a job of yours to carry on. Tell me what you'd like done, and I'll start it as a new job.",
        plain: "I can't find a job of yours to carry on. Tell me what you'd like done, and I'll start it as a new job.",
    } as ControlLine,
    /** DRAFT (not in the approved set, to be confirmed): `not_continuable` with no reason named by Orbit. It names none either. */
    cannotCarryOn: {
        titled: (title) => `${title} can't carry on, so there's nothing to continue. I can start it again as a new job, from the beginning.`,
        plain: "That job can't carry on, so there's nothing to continue. I can start it again as a new job, from the beginning.",
    } as ControlLine,
} as const;

/** The label of the button the reply carries where a new job is a sensible next step. Fable's approved label. */
export const START_NEW_JOB_LABEL = 'Start a new job';

/** The line and whether a "Start a new job" button goes with it, for one refusal of Orbit's. */
export function cannotContinue(why: CannotContinueWhy, title: string | undefined, more: CannotContinueMore = {}): { line: string; startNewJob: boolean } {
    const words = lineFor(why, more);
    const name = title?.trim() ? quotedTitle(title.trim()) : '';
    return { line: name ? words.line.titled(name) : words.line.plain, startNewJob: words.startNewJob };
}

function lineFor(why: CannotContinueWhy, more: CannotContinueMore): { line: ControlLine; startNewJob: boolean } {
    switch (why) {
        case 'live':
            // It has not ended: nothing to try again, and starting a second one beside it is not offered
            return { line: TRY_AGAIN_WORDS.stillLive, startNewJob: false };
        case 'not_found':
        case 'not_theirs':
            // There is no job to name, so there is nothing for a button to start again: they say what they want and that is an ordinary new ask
            return { line: TRY_AGAIN_WORDS.noSuchJob, startNewJob: false };
        case 'no_conversation':
            return { line: TRY_AGAIN_WORDS.noConversation, startNewJob: true };
        case 'not_continuable':
            if (more.status === 'done') return { line: TRY_AGAIN_WORDS.alreadyFinished, startNewJob: true };
            if (more.endedBy === 'person') return { line: TRY_AGAIN_WORDS.endedByPerson, startNewJob: true };
            if (more.endedBy === 'off') return { line: TRY_AGAIN_WORDS.endedByOff, startNewJob: true };
            // Orbit named no reason: none is guessed, and the line says only what is certain
            return { line: TRY_AGAIN_WORDS.cannotCarryOn, startNewJob: true };
    }
}

/** What the model is told when the line is under its reply already: it must not say it again, and it must not start anything. */
export const CANNOT_CONTINUE_NOTE =
    'That job cannot be carried on, and NOTHING was started. A fixed line under your reply already tells them why, in its own words: do not say it again and do not reword it. ' +
    'Do not call use_computer again for it in this turn. Say only what else they asked, in a word or two, or nothing.';

/** The same where there is no fixed line (not a direct chat): the model says these exact words and nothing more about it. */
export const cannotContinueSaid = (line: string): string =>
    `That job cannot be carried on, and NOTHING was started. Say this to them in their language, in these words, and nothing more about it: "${line}" Do not call use_computer again for it in this turn.`;
