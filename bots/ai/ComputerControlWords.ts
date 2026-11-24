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
     * FINAL (Fable, 23 Nov, `/mnt/project-files/release-0-5-0/brick-stop-all-final/strings.txt`): every reply to a confirmed Stop all that left NOTHING, by `stopped` (S: the length of Orbit's list, or null when it
     * sent none) and `asked` (A: the jobs the question named, used only to choose singular or plural and to know that some of them were not stopped). Any number said is Orbit's, and "all" only when S
     * equals A. A = S = 1 is the approved cancelled line (said by the caller, which names the job). `title`: the one job's title when A = 1, when it has one.
     */
    stoppedNothingLeft: (stopped: number | null, asked: number, title?: string | null): string => {
        if (stopped === null) return asked >= 2 ? 'The jobs I asked you about have all ended now. Their files are kept.' : 'The job I asked you about has ended now. Its files are kept.';
        if (stopped === 0) return asked >= 2 ? 'Those jobs had already ended.' : title ? `${quotedTitle(title)} had already ended.` : 'That job had already ended.';
        // "all" only when Orbit's number equals the number asked about; more than that (an Orbit that counts differently) is said as Orbit's number alone
        if (stopped === asked) return `I've stopped all ${stopped} jobs on my computer. Their files are kept.`;
        if (stopped > asked) return `I've stopped ${stopped} jobs on my computer. Their files are kept.`;
        return stopped === 1 ? "I've stopped 1 job on my computer. The rest had already ended. Their files are kept." : `I've stopped ${stopped} jobs on my computer. The rest had already ended. Their files are kept.`;
    },
    /**
     * FINAL (Fable, 23 Nov, `/mnt/project-files/brick-three-job-lines/strings.txt`, GPT seventh note D2): a Stop all where jobs were LEFT (they began after the person was asked, so they are not in the set
     * they confirmed). Two lines joined by a newline: what was stopped, then what was left. The second is a statement, never a question: a plain yes after it confirms nothing.
     * `left` holds each job's title (null for one with none).
     */
    stoppedSome: (stopped: number | null, asked: number, left: Array<string | null>): string => {
        // FINAL (Fable, 23 Nov, `/mnt/project-files/release-0-5-0/brick-stop-no-count/strings.txt`): when Orbit gave NO list of what it stopped (`stopped` is null), no number is said, and no number Orbit did not give
        // is ever used: "have all ended now" is true whether the Stop ended each job or it was already over. `asked` (the jobs the question named) is only for the grammar
        const first =
            stopped === null
                ? asked >= 2
                    ? 'The jobs I asked you about have all ended now. Their files are kept.'
                    : 'The job I asked you about has ended now. Its files are kept.'
                : stopped >= 2 ? `I've stopped ${stopped} jobs on my computer. Their files are kept.` : stopped === 1 ? "I've stopped 1 job on my computer. Its files are kept." : 'Those jobs had already ended.';
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
    /**
     * FINAL (24 Nov, `/mnt/project-files/brick-same-title-and-narrow-stop/strings.txt`): the person's yes to a Stop named only SOME of the jobs. Nothing is stopped yet: the statement comes FIRST
     * ("Just “Visa form”, then. I won't stop “Taxi booking”."), then the question about exactly those jobs; their next plain yes acts on them only. `named` are already quoted; `others` is
     * `othersOf(...)`.
     */
    narrowedStatement: (named: string[], others: string): string => `Just ${listed(named, 'and')}, then. I won't stop ${others}.`,
    /** FINAL (same file): the question about two or more of them (one job has the approved `askCancel`). `titles` are already quoted. */
    askCancelMany: (titles: string[]): string => `Cancel ${listed(titles, 'and')}? Their files are kept, and the time they used is on their receipts. To come back to them later, I can pause them instead.`,
    /** FINAL (same file): said last, after the cancelled lines of the jobs they named. Only what Brick did, never where the other jobs are now. */
    notStopped: (others: string): string => `I haven't stopped ${others}.`,
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

/**
 * FINAL (24 Nov, `/mnt/project-files/brick-same-title-and-narrow-stop/strings.txt`): how long ago something was, in words. Never a clock time (Brick often has no time zone for the person).
 * Under a minute "just now"; "a minute ago", "{n} minutes ago"; "an hour ago", "{n} hours ago" (whole hours, rounded down); "a day ago", "{n} days ago"; 30 days or more "over a month ago".
 */
export function ageOf(then: number, now: number): string {
    const minutes = Math.max(0, Math.floor((now - then) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes === 1) return 'a minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return 'an hour ago';
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'a day ago';
    if (days < 30) return `${days} days ago`;
    return 'over a month ago';
}

/** A job named in a question that tells jobs of one title apart: its title, and when it ended (an ended job) or when the person asked for it (a live one). */
export interface DatedJob {
    title: string;
    /** Milliseconds: the end time of an ended job, the time a live job was asked for. Absent when Orbit did not say. */
    at?: number;
}

/**
 * FINAL (24 Nov, same file): "which one do you mean?" when two or more of the jobs named share a title. They are given newest first (at most three).
 *  - Every job has one title: `Which “T” do you mean: the one that ended 25 minutes ago, or the one that ended 3 days ago?` (three: the later ones are bare ages); live: "the one you asked for ...".
 *  - Mixed: only a title shown more than once gets its age, in brackets: `Which job do you mean: “T” (ended 25 minutes ago), “T” (ended 3 days ago) or “Taxi booking”?`.
 *  - When two of a title would read the same, or a time is missing, they are told apart by their order: "the newer one, or the older one" / "(newer)", "(older)".
 * No title shown twice: the plain question (`plain`). `same` says whether two titles are one title.
 */
export function whichDated(kind: 'ended' | 'live', jobs: DatedJob[], now: number, same: (a: string, b: string) => boolean, plain: (quoted: string[]) => string): string {
    const quoted = quotedTitles(jobs.map((job) => job.title));
    const groups = jobs.map((job) => jobs.filter((other) => same(other.title, job.title)));
    if (groups.every((group) => group.length === 1)) return plain(quoted);
    // The age phrases of a title's jobs, or null when two read the same or one has no time
    const phrases = (group: DatedJob[]): string[] | null => {
        if (group.some((one) => one.at === undefined)) return null;
        const ages = group.map((one) => ageOf(one.at as number, now));
        return new Set(ages).size === ages.length ? ages : null;
    };
    const order3 = ['the newest one', 'the one before it', 'the oldest one'];
    if (groups.every((group) => group.length === jobs.length)) {
        const ages = phrases(jobs);
        const title = quoted[0];
        const mine = (age: string): string => (kind === 'ended' ? (age === 'just now' ? 'the one that just ended' : `the one that ended ${age}`) : `the one you asked for ${age}`);
        if (!ages) {
            const words = jobs.length === 2 ? ['the newer one', 'the older one'] : order3;
            return `Which ${title} do you mean: ${words.slice(0, -1).join(', ')}, or ${words[words.length - 1]}?`;
        }
        // Two: each says the whole of it. Three: the first says it, the others are bare ages
        const parts = jobs.length === 2 ? ages.map(mine) : [mine(ages[0]), ...ages.slice(1)];
        return `Which ${title} do you mean: ${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1]}?`;
    }
    const items = jobs.map((job, index) => {
        const group = groups[index];
        if (group.length === 1) return quoted[index];
        const ages = phrases(group);
        const place = group.indexOf(job);
        // Told apart by order, every one by its own word: two are the newer and the older; three the newest, the middle and the oldest; more are numbered (CodeRabbit on the round 10 head)
        if (!ages) return `${quoted[index]} (${group.length === 2 ? ['newer', 'older'][place] : group.length === 3 ? ['newest', 'middle', 'oldest'][place] : `no. ${place + 1}`})`;
        const age = ages[place];
        return `${quoted[index]} (${kind === 'ended' ? `ended ${age}` : `asked for ${age}`})`;
    });
    return `${kind === 'ended' ? 'Which job do you mean' : 'Which one do you mean'}: ${listed(items, 'or')}?`;
}

/**
 * FINAL (24 Nov, same file): the jobs left alone, as "I won't stop ..." and "I haven't stopped ..." name them. One titled: “Taxi booking”; two or three titled: “A” and “B” / “A”, “B” and “C”;
 * more than three, or any untitled: "the other job" / "the other {n} jobs". Never "still running": Brick says only what it did.
 */
export function othersOf(titles: Array<string | null | undefined>): string {
    if (titles.length >= 1 && titles.length <= 3 && titles.every((title) => typeof title === 'string' && title.trim() !== '')) return listed(titles.map((title) => quotedTitle(title as string)), 'and');
    return titles.length === 1 ? 'the other job' : `the other ${titles.length} jobs`;
}

/** One line, with the job's title quoted, or its plain form when there is none. */
export function lineOf(line: ControlLine, title?: string | null): string {
    return title ? line.titled(quotedTitle(title)) : line.plain;
}

/** The titles of jobs, each in its quotes (a job with no title reads "your job"). */
export const quotedTitles = (titles: Array<string | null | undefined>): string[] => titles.map((title) => (title ? quotedTitle(title) : 'your job'));
