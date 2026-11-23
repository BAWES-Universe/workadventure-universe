/**
 * The fixed status line of a computer job, and where it goes in the reply: the wording and the placement APPROVED in the mock (Khalid, 22 Nov), in ONE file.
 *
 * The line is built from the state Orbit really gave for the job (started, queued and why, found again and still going, done, ended), appended to the reply in the SAME `m.text` event, and the
 * job is confirmed only after Matrix returned that event's id. The tests read the strings from here (`jobLine`, `withJobLines`), never as literals, so a change of wording is a change of this file.
 */

/**
 * Which job a reply names to the person and what became of it: started now, waiting its turn (`queuedFor` is Orbit's reason: `allowance`, `turn`, `busy`, `pool`), found again (`recovered`: Orbit
 * does not say whether a job it finds is running or waiting), finished, or ended. `earlier` when it is the job of an earlier ask.
 */
export interface JobNote {
    state: 'started' | 'queued' | 'recovered' | 'done' | 'ended';
    title?: string;
    earlier?: boolean;
    queuedFor?: string | null;
}

/** One line in its two forms: with the job's title (already in its quotes), and with none. */
interface Line {
    titled: (title: string) => string;
    plain: string;
}

/** The approved wording, by state (curly quotes around a title; the apostrophes are straight). */
export const JOB_STATUS_WORDS = {
    started: {
        titled: (title) => `I've started ${title} on my computer.`,
        plain: "I've started your job on my computer.",
    } as Line,
    queued: {
        allowance: {
            titled: (title) => `${title} is waiting and hasn't started yet: this month's computer time is used up. Tap Ask for more in [Usage](#usage) and it starts by itself once more is added.`,
            plain: "Your job is waiting and hasn't started yet: this month's computer time is used up. Tap Ask for more in [Usage](#usage) and it starts by itself once more is added.",
        } as Line,
        turn: {
            titled: (title) => `${title} is next in line and hasn't started yet. It starts by itself when the current job ends.`,
            plain: "Your job is next in line and hasn't started yet. It starts by itself when the current job ends.",
        } as Line,
        /** A job that was paused (by the person, or because the month ran out mid-job): asking for it again never starts a second one (Brick's final control words, 23 Nov, word for word). */
        paused: {
            titled: (title) => `${title} is paused. Want me to resume it?`,
            plain: 'Your job is paused. Want me to resume it?',
        } as Line,
        other: {
            titled: (title) => `${title} is waiting for a free computer and hasn't started yet. It starts by itself.`,
            plain: "Your job is waiting for a free computer and hasn't started yet. It starts by itself.",
        } as Line,
    },
    recovered: {
        now: {
            titled: (title) => `I already have ${title}. The bar above this chat shows where it is.`,
            plain: 'I already have your job. The bar above this chat shows where it is.',
        } as Line,
        earlier: {
            titled: (title) => `I already have ${title} from your earlier ask. The bar above this chat shows where it is.`,
            plain: 'I already have the job you asked for earlier. The bar above this chat shows where it is.',
        } as Line,
    },
    done: {
        now: {
            titled: (title) => `${title} has finished. Its result and receipt are in this chat and in [Usage](#usage).`,
            plain: 'Your job has finished. Its result and receipt are in this chat and in [Usage](#usage).',
        } as Line,
        earlier: {
            titled: (title) => `${title} from your earlier ask has finished. Its result and receipt are in this chat and in [Usage](#usage).`,
            plain: 'The job you asked for earlier has finished. Its result and receipt are in this chat and in [Usage](#usage).',
        } as Line,
    },
    ended: {
        now: {
            titled: (title) => `${title} has already ended. Ask me if you want to try it again.`,
            plain: 'Your job has already ended. Ask me if you want to try it again.',
        } as Line,
        earlier: {
            titled: (title) => `${title} from your earlier ask has already ended. Ask me if you want to try it again.`,
            plain: 'The job you asked for earlier has already ended. Ask me if you want to try it again.',
        } as Line,
    },
};

/** The placement: the lines are the END of the reply, after ONE blank line; several jobs are joined by a newline; a reply with no words of its own is the lines alone. */
export const JOB_STATUS_PLACEMENT = { afterWords: '\n\n', betweenJobs: '\n' } as const;

/** A job's title as it is quoted in a line: in curly quotes, with no quote of any kind inside it. */
export const quotedTitle = (title: string): string => `\u201c${title.replace(/[\u201c\u201d"]/g, "'")}\u201d`;

/** The fixed line of one job, from the state Orbit really gave for it. */
export function jobLine(note: JobNote): string {
    const pick = (line: Line): string => (note.title ? line.titled(quotedTitle(note.title)) : line.plain);
    switch (note.state) {
        case 'done':
            return pick(note.earlier ? JOB_STATUS_WORDS.done.earlier : JOB_STATUS_WORDS.done.now);
        case 'ended':
            return pick(note.earlier ? JOB_STATUS_WORDS.ended.earlier : JOB_STATUS_WORDS.ended.now);
        case 'queued':
            return pick(note.queuedFor === 'paused' ? JOB_STATUS_WORDS.queued.paused : note.queuedFor === 'allowance' ? JOB_STATUS_WORDS.queued.allowance : note.queuedFor === 'turn' ? JOB_STATUS_WORDS.queued.turn : JOB_STATUS_WORDS.queued.other);
        case 'recovered':
            return pick(note.earlier ? JOB_STATUS_WORDS.recovered.earlier : JOB_STATUS_WORDS.recovered.now);
        default:
            return pick(JOB_STATUS_WORDS.started);
    }
}

/** The reply as it is sent: its own words, then the lines of the jobs it names (nothing is added when there are none, and a reply with no words of its own is the lines alone). */
export function withJobLines(words: string, lines: string[]): string {
    if (lines.length === 0) return words;
    const own = words.trim();
    const told = lines.join(JOB_STATUS_PLACEMENT.betweenJobs);
    return own ? `${own}${JOB_STATUS_PLACEMENT.afterWords}${told}` : told;
}
