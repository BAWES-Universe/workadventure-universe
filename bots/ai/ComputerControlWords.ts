/**
 * Brick's words for controlling its computer jobs from the chat (pause, carry on, do this first, do this next, cancel one, stop everything, pass words on), in ONE file.
 *
 * Every sentence the person reads about a control is a fixed line built here from what Orbit really answered, appended under the reply in the same event as the job status lines
 * (`JobStatusLine`), so the model never has to say it and never says it differently. The tests read the strings from here, never as literals, so a change of wording is a change of this file.
 *
 * WORDING STATUS
 *  - MOCK: section 10 of the steering mock ("Steering a computer job while it works", artifact QpheiJANyQuSQKZNCwbAxp), APPROVED by Khalid on 23 Nov ("Steering mock looks good"), word for word.
 *  - FINAL: every other line, word for word from Fable's final strings of 23 Nov (computers-full-plan-23-nov/brick-control-words-final-23-nov.md), APPROVED by Khalid on 23 Nov.
 *  - FINAL: `toldAccepted` and `resumeAsked`, word for word from Fable's strings of 23 Nov (/mnt/project-files/brick-four-job-lines/strings.txt, mock https://claude.ai/artifact/E2TrF8Euu3AF5PP7rJck2b).
 * House rules: plain words, "Apps", never a price or how much of the month is left, no legal wording, the job's title in curly quotes (`quotedTitle`).
 */
import { quotedTitle } from './JobStatusLine';

/** One line in its two forms: with the job's title (already in its quotes), and with none. */
export interface ControlLine {
    titled: (title: string) => string;
    plain: string;
}

export const CONTROL_WORDS = {
    /** MOCK "Told the job something new": it reached the job that is working. */
    toldRunning: {
        titled: (title) => `I've passed that on to ${title}. It uses it from its next step.`,
        plain: "I've passed that on to your job. It uses it from its next step.",
    } as ControlLine,
    /** MOCK "Answered its question". */
    toldAnswer: {
        titled: (title) => `I've passed your answer to ${title}, and it's carrying on.`,
        plain: "I've passed your answer to your job, and it's carrying on.",
    } as ControlLine,
    /** FINAL: the person holds the job's screen; it gets the words when they hand it back. */
    toldAfterHandBack: {
        titled: (title) => `I'll pass that on to ${title} as soon as you hand the screen back.`,
        plain: "I'll pass that on to your job as soon as you hand the screen back.",
    } as ControlLine,
    /** FINAL: a job still waiting in line; it gets the words when it starts. */
    toldWhenItStarts: {
        titled: (title) => `I've added that to ${title}. It uses it when it starts.`,
        plain: "I've added that to your job. It uses it when it starts.",
    } as ControlLine,
    /** FINAL: a paused job; it gets the words when it carries on. */
    toldWhenItCarriesOn: {
        titled: (title) => `I've added that to ${title}. It uses it when it carries on.`,
        plain: "I've added that to your job. It uses it when it carries on.",
    } as ControlLine,
    /** FINAL (Fable, 23 Nov, brick-four-job-lines): Orbit took the words in a way of delivering this server does not know; nothing is said of when the job uses them. */
    toldAccepted: {
        titled: (title) => `I've added that to ${title}.`,
        plain: "I've added that to your job.",
    } as ControlLine,
    /** FINAL (Fable, 23 Nov, brick-four-job-lines): Orbit took the carry on but gave no view of where the job is, so nothing is claimed of it beyond where to look. */
    resumeAsked: {
        titled: (title) => `I've asked ${title} to carry on. The bar above this chat shows where it is.`,
        plain: "I've asked your job to carry on. The bar above this chat shows where it is.",
    } as ControlLine,
    /** MOCK "Paused". */
    paused: {
        titled: (title) => `I've paused ${title}. Its progress is kept, and it isn't using computer time.`,
        plain: "I've paused your job. Its progress is kept, and it isn't using computer time.",
    } as ControlLine,
    /** MOCK "Paused, sign-in could not be put away". */
    pausedSignInLost: {
        titled: (title) => `I've paused ${title}. Its progress is kept, and it isn't using computer time. You'll sign in to the site again when it carries on.`,
        plain: "I've paused your job. Its progress is kept, and it isn't using computer time. You'll sign in to the site again when it carries on.",
    } as ControlLine,
    /** MOCK "Resumed, starts now". */
    resumedNow: {
        titled: (title) => `${title} is carrying on from where it stopped.`,
        plain: 'Your job is carrying on from where it stopped.',
    } as ControlLine,
    /** MOCK "Resumed, another job is running". */
    resumedNext: {
        titled: (title) => `${title} carries on next, when the current job ends.`,
        plain: 'Your job carries on next, when the current job ends.',
    } as ControlLine,
    /** FINAL: resumed, and every computer is busy. */
    resumedWaiting: {
        titled: (title) => `${title} is back in line, waiting for a free computer. It carries on by itself.`,
        plain: 'Your job is back in line, waiting for a free computer. It carries on by itself.',
    } as ControlLine,
    /** FINAL: resumed while the month is still used up: it stays paused. */
    stillPausedAllowance: {
        titled: (title) => `${title} is still paused: this month's computer time is used up. Tap Ask for more in [Usage](#usage), and it carries on by itself once more is added.`,
        plain: "Your job is still paused: this month's computer time is used up. Tap Ask for more in [Usage](#usage), and it carries on by itself once more is added.",
    } as ControlLine,
    /** FINAL: resumed while the person's own spending limit still holds it. */
    stillPausedRule: {
        titled: (title) => `${title} is still paused: it reached the spending limit you set. Change the limit and it carries on by itself.`,
        plain: 'Your job is still paused: it reached the spending limit you set. Change the limit and it carries on by itself.',
    } as ControlLine,
    /** MOCK "Do this first", first line: the new job has the computer (the approved "Started" line). */
    firstStarted: {
        titled: (title) => `I've started ${title} on my computer.`,
        plain: "I've started your job on my computer.",
    } as ControlLine,
    /** MOCK "Do this first", second line: the job that was working is paused and carries on by itself right after. */
    firstPausedOther: {
        titled: (title) => `${title} is paused and carries on by itself right after it.`,
        plain: 'The job that was working is paused and carries on by itself right after it.',
    } as ControlLine,
    /** MOCK sentence (the last sentence of "Paused, sign-in could not be put away"), said after the second "Do this first" line when the paused job's sign-ins could not be kept. */
    signInAgain: "You'll sign in to the site again when it carries on.",
    /** FINAL: "Do this first" when the computer needs a moment: it is first in line (the second line above still follows). */
    firstNext: {
        titled: (title) => `${title} is first in line and starts by itself.`,
        plain: 'Your job is first in line and starts by itself.',
    } as ControlLine,
    /** MOCK "Do this next". */
    movedNext: {
        titled: (title) => `${title} is now next in line.`,
        plain: 'Your job is now next in line.',
    } as ControlLine,
    /** MOCK "Cancelled, had not started". */
    cancelledQueued: {
        titled: (title) => `I've cancelled ${title}. It hadn't started, so it used nothing.`,
        plain: "I've cancelled your job. It hadn't started, so it used nothing.",
    } as ControlLine,
    /** MOCK "Cancelled, had started or was paused". */
    cancelled: {
        titled: (title) => `I've cancelled ${title}. Its files are kept, and the time it used is on its receipt.`,
        plain: "I've cancelled your job. Its files are kept, and the time it used is on its receipt.",
    } as ControlLine,
    /** MOCK "Stopped everything (said in chat)". With one job, the cancelled line says it, naming the job. */
    stoppedAll: (count: number): string => `I've stopped all ${count} jobs on my computer. Their files are kept.`,
    /**
     * FINAL (Fable, 23 Nov, `/mnt/project-files/brick-three-job-lines/strings.txt`, GPT seventh note D2): a Stop all where jobs were LEFT (they began after the person was asked, so they are not in the set
     * they confirmed). Two lines joined by a newline: what was stopped, then what was left. The second is a statement, never a question: a plain yes after it confirms nothing.
     * `left` holds each job's title (null for one with none).
     */
    stoppedSome: (stopped: number, left: Array<string | null>): string => {
        const first = stopped >= 2 ? `I've stopped ${stopped} jobs on my computer. Their files are kept.` : stopped === 1 ? "I've stopped 1 job on my computer. Its files are kept." : 'Those jobs had already ended.';
        const titled = left.every((title) => !!title);
        const second =
            left.length === 1 && titled
                ? `${quotedTitle(left[0] as string)} was added after I asked, so I haven't stopped it. Tell me if you want it stopped too.`
                : left.length >= 2 && left.length <= 3 && titled
                  ? `${listed(left.map((title) => quotedTitle(title as string)), 'and')} were added after I asked, so I haven't stopped them. Tell me if you want them stopped too.`
                  : left.length === 1
                    ? "1 job was added after I asked, so I haven't stopped it. Tell me if you want it stopped too."
                    : `${left.length} jobs were added after I asked, so I haven't stopped them. Tell me if you want them stopped too.`;
        return `${first}\n${second}`;
    },
    /** FINAL: the question before cancelling a job that has started or is paused (by words; asked every time; only the person's next message can answer it). A job that never started is cancelled at once. */
    askCancel: {
        titled: (title) => `Cancel ${title}? Its files are kept, and the time it used is on its receipt. To come back to it later, I can pause it instead.`,
        plain: 'Cancel your job? Its files are kept, and the time it used is on its receipt. To come back to it later, I can pause it instead.',
    } as ControlLine,
    /** FINAL: the question before Stop, which ends every job on the computer, paused ones too (by words; asked every time). `titles` are already quoted. */
    askStop: (titles: string[]): string =>
        titles.length === 1
            ? `Stop ${titles[0]}? Its files are kept, and the time it used is on its receipt. To come back to it later, I can pause it instead.`
            : `Stop all ${titles.length} jobs on my computer: ${listed(titles)}? Their files are kept. To end or pause just one, tell me which.`,
} as const;

/** What Brick says when a control could not be done (FINAL unless marked). Nothing changed in any of these. */
export const CONTROL_REFUSALS = {
    /** `taken_over`: the person holds the screen. */
    takenOver: 'You have the screen right now. Hand it back first, or say stop.',
    /** `ending`: a finish is already kept, or Orbit decided to end it. */
    ending: {
        titled: (title) => `${title} is already ending, so nothing changed. I'll tell you here how it went.`,
        plain: "That job is already ending, so nothing changed. I'll tell you here how it went.",
    } as ControlLine,
    /** `over`: it has already ended. */
    over: {
        titled: (title) => `${title} has already ended, so nothing changed.`,
        plain: 'That job has already ended, so nothing changed.',
    } as ControlLine,
    /** Pause of a job that is already paused. */
    alreadyPaused: {
        titled: (title) => `${title} is already paused. Want me to resume it?`,
        plain: 'That job is already paused. Want me to resume it?',
    } as ControlLine,
    /** `not_paused`: carry on, for a job that is working or in line already. */
    notPaused: {
        titled: (title) => `${title} isn't paused, so there's nothing to resume.`,
        plain: "That job isn't paused, so there's nothing to resume.",
    } as ControlLine,
    /** `not_queued`: do this next, for the job that already has the computer. */
    alreadyRunning: {
        titled: (title) => `${title} is already the job I'm working on.`,
        plain: "That job is already the job I'm working on.",
    } as ControlLine,
    /** No job of that name: the jobs it does have are named (already quoted). */
    noSuchJob: (titles: string[]): string => (titles.length ? `I can't find that job. On my computer now: ${listed(titles)}.` : 'There are no jobs on my computer right now.'),
    /** More than one job fits: Brick asks which, naming them (already quoted). */
    whichJob: (titles: string[]): string => `Which one do you mean: ${listed(titles, 'or')}?`,
    noJobs: 'There are no jobs on my computer right now.',
    /** Orbit could not be reached, or said no for a reason this server does not know. */
    couldNot: "I couldn't do that just now, so nothing changed. You can also use the bar above this chat.",
    /** The answer did not come back whole: it may or may not have happened. Never told as done, never as failed. */
    unknown: "I couldn't check whether that went through. The bar above this chat shows where each job is.",
} as const;

/** "“A”", "“A” and “B”", "“A”, “B” and “C”" (or "or" for a question). */
export function listed(titles: string[], word: 'and' | 'or' = 'and'): string {
    if (titles.length <= 1) return titles[0] ?? '';
    return `${titles.slice(0, -1).join(', ')} ${word} ${titles[titles.length - 1]}`;
}

/** One line, with the job's title quoted, or its plain form when there is none. */
export function lineOf(line: ControlLine, title?: string | null): string {
    return title ? line.titled(quotedTitle(title)) : line.plain;
}

/** The titles of jobs, each in its quotes (a job with no title reads "your job"). */
export const quotedTitles = (titles: Array<string | null | undefined>): string[] => titles.map((title) => (title ? quotedTitle(title) : 'your job'));
