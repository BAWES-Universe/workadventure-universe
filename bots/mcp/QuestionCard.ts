/**
 * The question card (game #1661, mock 5 approved 4 Nov 2026): a bot asks one question with 2 to 4 choices before a big
 * job, as the notice that carries it (the same `universe.ask` field as the approval card, `kind: "question"`). Pure: it
 * builds the card, the words that go with it and reads a tap.
 *
 * A choice only picks a direction: nothing is changed, deleted or sent by it. That is why a typed or spoken answer counts
 * here, unlike on an approval card. The card never runs a tool; the pick goes back to the bot as what the person said.
 */
import { ASK_KEY } from './ApprovalCard';

export interface QuestionChoice {
    /** "c1".."c4": what a tap names, never the words. */
    id: string;
    label: string;
    /** One short line under the label ("3 tracks, about 3 minutes each"). */
    line?: string;
}

/** How a question card ended, as the game reads it. A card still waiting has none. */
export interface QuestionAnswer {
    /** The ids tapped; always at least one when it was picked. */
    picked?: string[];
    /** The person answered by typing in the chat. */
    typed?: boolean;
    /** The person answered out loud to a voice bot. */
    spoken?: boolean;
    closed?: boolean;
    expired?: boolean;
}

export interface QuestionField {
    v: 1;
    kind: 'question';
    id: string;
    revision: number;
    /** The question itself. */
    title: string;
    choices: QuestionChoice[];
    /** Choices tick and "Continue with N" sends them. */
    multiple?: boolean;
    /** When the card closes and the time it was written, both on this server's clock: the game counts from when it got it. */
    expiresAt: number;
    now: number;
    waitMinutes: number;
    answer?: QuestionAnswer;
}

export const QUESTION_MIN_CHOICES = 2;
export const QUESTION_MAX_CHOICES = 4;
const QUESTION_MAX = 200;
const LABEL_MAX = 60;
const LINE_MAX = 100;
/** What "before I ..." may hold in the line everyone reads. */
const BEFORE_MAX = 60;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value);
const tidy = (value: unknown, max: number): string => (typeof value === 'string' ? clip(value.replace(/\s+/g, ' ').trim(), max) : '');

export interface QuestionAsked {
    question: string;
    choices: QuestionChoice[];
    multiple: boolean;
    /** A few words for the line everyone reads in a bubble: "make the music". Never anything from the choices. */
    before?: string;
}

/**
 * What the model asked, as a card, or the reason it can't be one (the model is told, and asks in words instead). Labels
 * must differ, so a pick means one thing.
 */
export function readQuestion(args: Record<string, unknown>): { ok: true; asked: QuestionAsked } | { ok: false; why: string } {
    const question = tidy(args.question, QUESTION_MAX);
    if (!question) return { ok: false, why: 'A question card needs a question.' };
    const raw = Array.isArray(args.choices) ? args.choices : [];
    if (raw.length < QUESTION_MIN_CHOICES || raw.length > QUESTION_MAX_CHOICES) {
        return { ok: false, why: `A question card has ${QUESTION_MIN_CHOICES} to ${QUESTION_MAX_CHOICES} choices. Ask in words instead.` };
    }
    const choices: QuestionChoice[] = [];
    for (const item of raw) {
        const object: Record<string, unknown> = item && typeof item === 'object' ? (item as Record<string, unknown>) : { label: item };
        const label = tidy(object.label, LABEL_MAX);
        if (!label) return { ok: false, why: 'Every choice needs a short name.' };
        const line = tidy(object.line, LINE_MAX);
        choices.push({ id: `c${choices.length + 1}`, label, ...(line ? { line } : {}) });
    }
    if (new Set(choices.map((choice) => choice.label.toLowerCase())).size !== choices.length) {
        return { ok: false, why: 'Every choice needs its own name.' };
    }
    const before = tidy(args.before, BEFORE_MAX);
    const safeBefore = before && !/https?:\/\/|www\.|[<>{}[\]@\d]/i.test(before) ? before.replace(/[.!?]+$/, '') : '';
    return {
        ok: true,
        asked: { question, choices, multiple: args.multiple === true, ...(safeBefore ? { before: safeBefore } : {}) },
    };
}

export interface QuestionFacts extends QuestionAsked {
    id: string;
    revision: number;
    expiresAt: number;
    waitMinutes: number;
}

export function buildQuestion(facts: QuestionFacts, now: number, answer?: QuestionAnswer): QuestionField {
    return {
        v: 1,
        kind: 'question',
        id: facts.id,
        revision: facts.revision,
        title: facts.question,
        choices: facts.choices,
        ...(facts.multiple ? { multiple: true } : {}),
        expiresAt: facts.expiresAt,
        now,
        waitMinutes: facts.waitMinutes,
        ...(answer ? { answer } : {}),
    };
}

/** "Full song" / "Full song and Instrumental" / "A, B and C". */
export function joinLabels(labels: readonly string[]): string {
    if (labels.length <= 1) return labels[0] ?? '';
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export function pickedChoices(field: Pick<QuestionField, 'choices'>, ids: readonly string[] | undefined): QuestionChoice[] {
    return field.choices.filter((choice) => ids?.includes(choice.id));
}

/** The notice's body: the same card in plain words, for chat apps that can't draw it. */
export function questionBody(field: QuestionField): string {
    const answer = field.answer;
    const lines = [field.title];
    if (!answer) {
        for (const choice of field.choices) lines.push(choice.line ? `- ${choice.label}: ${choice.line}` : `- ${choice.label}`);
        lines.push('Tap a choice, or type your own answer.');
    } else if (answer.picked) lines.push(`You picked ${joinLabels(pickedChoices(field, answer.picked).map((choice) => choice.label))}.`);
    else if (answer.typed) lines.push('You answered by typing.');
    else if (answer.spoken) lines.push('You answered out loud.');
    else if (answer.closed) lines.push('You closed this card, so nothing was done.');
    else lines.push('No answer in time, so nothing was done.');
    return lines.join('\n');
}

export function questionNotice(field: QuestionField): Record<string, unknown> {
    return { msgtype: 'm.notice', body: questionBody(field), [ASK_KEY]: field };
}

export function questionEdit(eventId: string, field: QuestionField): Record<string, unknown> {
    return {
        msgtype: 'm.notice',
        body: `* ${questionBody(field)}`,
        'm.new_content': questionNotice(field),
        'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
    };
}

/**
 * What the bot is told the person answered, as they would say it: the question, their pick and the short line of each
 * choice, so the bot goes on without asking again.
 */
export function answerText(field: Pick<QuestionField, 'title' | 'choices'>, ids: readonly string[]): string {
    const picked = pickedChoices(field, ids);
    const names = picked.map((choice) => (choice.line ? `${choice.label} (${choice.line})` : choice.label));
    return `My answer to your question "${field.title}": ${joinLabels(names)}. Go ahead with that.`;
}

/* ------------------------------------- the line everyone reads ------------------------------------- */

/** "Khalid, I need your pick before I make the music." Made only from the person's name and what the bot said it will do next. */
export function askLine(name: string | null, before?: string): string {
    const lead = name ? `${name}, ` : '';
    const text = `${lead}I need your pick before I ${before || 'go on'}.`;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/* -------------------------------------- the tool the model asks with -------------------------------------- */

/** The tool the model calls to show a question card. */
export const ASK_PERSON_TOOL = 'ask_person';

/** What the model is told when the setting is Never: it says its pick and starts. */
export const NEVER_ASK_RULE =
    'Do not ask the person which way to go. When a job has real choices, pick the best one, say your pick in one short line and start. ' +
    'Unclear facts (who, which one, a missing detail) are still asked in words.';

/** The tool as the model sees it. `never` offers nothing, so it has no definition. */
export function askPersonDefinition(way: 'rarely' | 'beforeBiggerJobs'): { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } } {
    const when =
        way === 'beforeBiggerJobs'
            ? 'Use it before a bigger job (one that takes a while or costs something) when there are real choices that lead to different results.'
            : 'Use it rarely, only when all three hold: the job is big (a song, a video, a long document), there are real choices that lead to different results, and a wrong guess would waste the work.';
    return {
        type: 'function',
        function: {
            name: ASK_PERSON_TOOL,
            description:
                `Ask the person which way to go, on a card with ${QUESTION_MIN_CHOICES} to ${QUESTION_MAX_CHOICES} choices. ${when} ` +
                'Otherwise say in one short line what you will do, and start. Never use it for unclear facts such as which person, which file or a missing detail: ask those in words. ' +
                'At most one question in a reply, and never again right after the person answered one. ' +
                'After the card is shown, write one short line saying you need their pick and stop: do not start the job. Their pick, or what they type instead, comes back as their next message.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question, in one short sentence, e.g. "What should the launch party sound like?"' },
                    choices: {
                        type: 'array',
                        minItems: QUESTION_MIN_CHOICES,
                        maxItems: QUESTION_MAX_CHOICES,
                        description: 'Equal choices, none suggested over the others.',
                        items: {
                            type: 'object',
                            properties: {
                                label: { type: 'string', description: 'A short name, e.g. "Upbeat pop".' },
                                line: { type: 'string', description: 'One short line about it, e.g. "3 tracks, about 3 minutes each".' },
                            },
                            required: ['label'],
                        },
                    },
                    multiple: { type: 'boolean', description: 'True when more than one choice may be wanted: the person ticks them and taps Continue.' },
                    before: {
                        type: 'string',
                        description:
                            'A few words for what you will do once they answer, to finish "I need your pick before I ...", e.g. "make the music". Others nearby read it, so it holds nothing from the choices.',
                    },
                },
                required: ['question', 'choices'],
            },
        },
    };
}
