/**
 * Brick's words for controlling its computer jobs from the chat (pause, carry on, do this first, do this next, cancel one, stop everything, pass words on), in ONE file.
 *
 * Every sentence the person reads about a control is a fixed line built here from what Orbit really answered, appended under the reply in the same event as the job status lines
 * (`JobStatusLine`), so the model never has to say it and never says it differently. The tests read the strings from here, never as literals, so a change of wording is a change of this file.
 *
 * WORDING STATUS
 *  - MOCK: section 10 of the steering mock ("Steering a computer job while it works", artifact QpheiJANyQuSQKZNCwbAxp), APPROVED by Khalid on 23 Nov ("Steering mock looks good"), word for word.
 *  - DECIDED: not drawn in the mock; word for word from Fable's decisions file of 23 Nov (computers-full-plan-23-nov/decisions-pause-stop-23-nov.md).
 *  - DRAFT: in neither; written in their style. To be confirmed.
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
    /** DRAFT: the person holds the job's screen; it gets the words when they hand it back (decisions 3e). */
    toldAfterHandBack: {
        titled: (title) => `I'll pass that on to ${title} when you hand it back.`,
        plain: "I'll pass that on to your job when you hand it back.",
    } as ControlLine,
    /** DRAFT: a job in line or paused; it gets the words when it starts or carries on (decisions 3e). */
    toldWhenItStarts: {
        titled: (title) => `I'll pass that on to ${title} when it starts.`,
        plain: "I'll pass that on to your job when it starts.",
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
    /** DRAFT: resumed, back in line waiting for a free computer (the approved status line's "other" words). */
    resumedWaiting: {
        titled: (title) => `${title} is back in line, waiting for a free computer. It carries on by itself.`,
        plain: 'Your job is back in line, waiting for a free computer. It carries on by itself.',
    } as ControlLine,
    /** DECIDED 1 ("Resume pressed while still out: it stays paused and says why, with Ask for more"), in the words of its pause line. */
    stillPausedAllowance: {
        titled: (title) => `${title} is still paused: this month's computer time is used up. Nothing is lost. Tap Ask for more in [Usage](#usage) and I'll carry on by itself.`,
        plain: "Your job is still paused: this month's computer time is used up. Nothing is lost. Tap Ask for more in [Usage](#usage) and I'll carry on by itself.",
    } as ControlLine,
    /** DECIDED 1, the same for a spending limit the person set. */
    stillPausedRule: {
        titled: (title) => `${title} is still paused: it reached the spending limit you set. Nothing is lost. Raise the limit or say resume.`,
        plain: 'Your job is still paused: it reached the spending limit you set. Nothing is lost. Raise the limit or say resume.',
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
    /** DRAFT: "Do this first" when the computer could not take the new job this second: it is first in line (the second line above still follows). */
    firstNext: {
        titled: (title) => `${title} is next and starts by itself.`,
        plain: 'Your job is next and starts by itself.',
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
     * DECIDED 2 "Cancel, before acting", then the offer of Pause in the words of the decided one-job Stop question ("Stop and Cancel always ask first ... and offer Pause").
     * Asked every time; only the person's next message can answer it.
     */
    askCancelStarted: {
        titled: (title) => `Cancel ${title}? It ends here, and you're charged only for the time it used. To come back to it later, pause it instead.`,
        plain: "Cancel this job? It ends here, and you're charged only for the time it used. To come back to it later, pause it instead.",
    } as ControlLine,
    /** DRAFT: the same question for a job that never started (it used nothing). */
    askCancelQueued: {
        titled: (title) => `Cancel ${title}? It hasn't started, so it has used nothing. To keep it for later, pause it instead.`,
        plain: "Cancel this job? It hasn't started, so it has used nothing. To keep it for later, pause it instead.",
    } as ControlLine,
    /**
     * The question before Stop, which ends every job on the computer, paused ones too. One job: DECIDED 2 word for word. Several: DECIDED 2's panel question in Brick's own voice ("my computer"),
     * naming the jobs, with the offer of Pause (DRAFT). `titles` are already quoted.
     */
    askStop: (titles: string[]): string =>
        titles.length === 1
            ? `Stop ${titles[0]}? It ends here and its files are kept. To come back to it later, pause it instead.`
            : `Stop everything on my computer? That ends ${titles.length} jobs: ${listed(titles)}. To come back to one later, I can pause it instead.`,
} as const;

/** What Brick says when a control could not be done (DRAFT unless marked). Nothing changed in any of these. */
export const CONTROL_REFUSALS = {
    /** DECIDED 3a, `taken_over`: the person holds the screen. */
    takenOver: 'You have the screen right now. Hand it back first, or say stop.',
    /** `ending`: a finish is already kept, or Orbit decided to end it. */
    ending: {
        titled: (title) => `${title} is already ending, so there's nothing to change. Its result comes to this chat.`,
        plain: "That job is already ending, so there's nothing to change. Its result comes to this chat.",
    } as ControlLine,
    /** `over`: it has already ended. */
    over: {
        titled: (title) => `${title} has already ended, so there's nothing to change.`,
        plain: "That job has already ended, so there's nothing to change.",
    } as ControlLine,
    /** Pause of a job that is already paused (DECIDED 3h's question). */
    alreadyPaused: {
        titled: (title) => `${title} is already paused. Want me to resume it?`,
        plain: 'That one is already paused. Want me to resume it?',
    } as ControlLine,
    /** `not_paused`: carry on, for a job that is working or in line already. */
    notPaused: {
        titled: (title) => `${title} isn't paused, so it's already on its way.`,
        plain: "That job isn't paused, so it's already on its way.",
    } as ControlLine,
    /** `not_queued`: do this next, for the job that already has the computer. */
    alreadyRunning: {
        titled: (title) => `${title} is the job on my computer right now.`,
        plain: 'That job is the one on my computer right now.',
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
