/**
 * The card a bot shows in a direct message before it changes, deletes or sends something (game #1657, mock 3 approved
 * 4 Nov 2026), as the notice that carries it. Pure: it builds the words and the notice's `universe.ask` field, and reads
 * a tap. Orbit keeps the action; the game draws the card and sends taps back with only the card's id and revision.
 *
 * The field is the one the game reads (`BotAsk.ts`, game #1792). A card ends or changes by editing the same notice with
 * a new revision, so the game redraws it in place. The notice's body says the same in plain words for chat apps that
 * can't draw it.
 */
import type { RememberScope, SavedAction } from './OrbitActions';
import type { ToolHeading } from './ToolCatalog';

export const ASK_KEY = 'universe.ask';
/** The event a tap sends to the room. */
export const ANSWER_EVENT = 'universe.ask.answer';

export type AskDecision = 'approve' | 'approveAndRemember' | 'decline';

export interface AskLine {
    label?: string;
    text: string;
}

/** How a card ended, as the game reads it. A card still waiting has none. */
export interface AskAnswer {
    option?: AskDecision;
    allowedMore?: string;
    result?: string;
    unknown?: boolean;
    typed?: boolean;
    closed?: boolean;
    expired?: boolean;
}

export interface AskField {
    v: 1;
    kind: 'approval';
    id: string;
    revision: number;
    title: string;
    actsAs?: string;
    lines: AskLine[];
    options: Array<{ id: AskDecision; label: string }>;
    everyTime?: boolean;
    notReviewed?: boolean;
    checkAt?: { label: string; url: string };
    /** When the card closes and the time it was written, both on this server's clock: the game counts from when it got it. */
    expiresAt: number;
    now: number;
    waitMinutes: number;
    answer?: AskAnswer;
}

/** The game shows at most this many lines, labels and texts of these lengths; more is cut there too. */
const LINES_MAX = 20;
const TEXT_MAX = 2000;
const LABEL_MAX = 80;
const TITLE_MAX = 200;
const RESULT_MAX = 300;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value);

/** "linear_create_issue" reads "Linear create issue". */
export function tidyName(name: string): string {
    const words = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Use a tool';
}

/** The action in the tool's own words: its title when it gave one, else its name tidied. */
export function cardTitle(toolName: string, toolTitle?: string): string {
    return clip((toolTitle?.trim() || tidyName(toolName)).replace(/\s+/g, ' '), TITLE_MAX);
}

/* ------------------------------------ lines ------------------------------------ */

const isPlain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function valueText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value) ?? '';
}

/** The arguments in the order the tool names its inputs, then any others, each as a labelled line, exactly as they will run. */
export function argumentLines(args: Record<string, unknown>, inputSchema?: unknown): AskLine[] {
    const declared = isPlain(inputSchema) && isPlain(inputSchema.properties) ? Object.keys(inputSchema.properties) : [];
    const keys = [...declared.filter((key) => key in args), ...Object.keys(args).filter((key) => !declared.includes(key))];
    const lines: AskLine[] = [];
    for (const key of keys) {
        const value = args[key];
        if (value === undefined || value === null) continue;
        const text = valueText(value).trim();
        if (!text) continue;
        lines.push({ label: clip(tidyName(key), LABEL_MAX), text: clip(text, TEXT_MAX) });
    }
    if (lines.length > LINES_MAX) {
        const more = lines.length - (LINES_MAX - 1);
        lines.length = LINES_MAX - 1;
        lines.push({ text: `…and ${more} more details` });
    }
    return lines;
}

/* ------------------------------ what "allow more" keeps ------------------------------ */

/** Fields that are the content of an action (what it says), as opposed to where it goes. */
const CONTENT_FIELD = /^(title|name|subject|summary|description|body|content|text|message|comment|note|notes|details|prompt|query)$/i;
const SECRET_FIELD = /key|token|secret|password|passwd|auth|cookie|session/i;

export interface RememberOffer {
    scope: RememberScope;
    /** The fixed values, in words ("WEB"), for the button. */
    phrase: string;
}

/**
 * What "allow more like this" could remember for this call, or null when it can't be enforced (so the button is not
 * shown). The words (title, description, text…) may be different next time; every other field stays exactly as approved,
 * and must include a place or choice to stay fixed on, so it is never a wildcard. Deleting or sending is never offered,
 * and neither is a tool nobody confirmed.
 */
export function rememberOffer(args: Record<string, unknown>, heading: ToolHeading, notReviewed: boolean): RememberOffer | null {
    if (heading === 'deletesOrSends' || notReviewed) return null;
    const fixed: Record<string, unknown> = {};
    const varies: string[] = [];
    const places: string[] = [];
    for (const [key, value] of Object.entries(args)) {
        if (value === undefined) continue;
        if (SECRET_FIELD.test(key)) return null;
        if (CONTENT_FIELD.test(key) && typeof value === 'string') {
            varies.push(key);
            continue;
        }
        fixed[key] = value;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') places.push(String(value));
    }
    if (varies.length === 0 || places.length === 0) return null;
    return { scope: { fixed, varies }, phrase: clip(places.join(' · '), 30) };
}

/* ----------------------------------- options ----------------------------------- */

/** "Don't create" from "Create issue"; a title that doesn't start with a verb says "Don't do it". */
function declineLabel(title: string): string {
    const first = title.split(/\s+/)[0] ?? '';
    return /^[A-Za-z]{3,}$/.test(first) && title.split(/\s+/).length > 1 ? `Don't ${first.toLowerCase()}` : "Don't do it";
}

export function cardOptions(title: string, offer: RememberOffer | null): Array<{ id: AskDecision; label: string }> {
    const approve = clip(title, LABEL_MAX);
    const options: Array<{ id: AskDecision; label: string }> = [{ id: 'approve', label: approve }];
    if (offer) {
        const withPhrase = offer.phrase ? `${approve}, and allow more with ${offer.phrase} in this chat` : `${approve}, and allow more like this in this chat`;
        options.push({ id: 'approveAndRemember', label: withPhrase.length <= LABEL_MAX ? withPhrase : clip(`${approve}, and allow more like this in this chat`, LABEL_MAX) });
    }
    options.push({ id: 'decline', label: declineLabel(title) });
    return options;
}

/* ------------------------------------ the card ------------------------------------ */

export interface CardFacts {
    action: SavedAction;
    title: string;
    actsAs?: string;
    lines: AskLine[];
    offer: RememberOffer | null;
    notReviewed: boolean;
    waitMinutes: number;
    checkAt?: { label: string; url: string };
}

/** The `universe.ask` field for an action as it stands. `answer` is set once the card has ended. */
export function buildAsk(facts: CardFacts, now: number, answer?: AskAnswer): AskField {
    const everyTime = facts.action.heading === 'deletesOrSends' || facts.notReviewed;
    return {
        v: 1,
        kind: 'approval',
        id: facts.action.id,
        revision: facts.action.revision,
        title: facts.title,
        ...(facts.actsAs ? { actsAs: clip(facts.actsAs, 120) } : {}),
        lines: facts.lines,
        options: cardOptions(facts.title, everyTime ? null : facts.offer),
        ...(everyTime ? { everyTime: true } : {}),
        ...(facts.notReviewed ? { notReviewed: true } : {}),
        ...(facts.checkAt ? { checkAt: facts.checkAt } : {}),
        expiresAt: Date.parse(facts.action.reviewExpiresAt),
        now,
        waitMinutes: facts.waitMinutes,
        ...(answer ? { answer } : {}),
    };
}

/** The notice's body: the same card in plain words, for chat apps that can't draw it. */
export function askBody(ask: AskField): string {
    const head = ask.answer ? ask.title : `${ask.title}: waiting for your OK`;
    const details = ask.lines.map((line) => (line.label ? `${line.label}: ${line.text}` : line.text));
    const end = ask.answer ? [endingLine(ask.answer, ask.options)] : [];
    return [head, ...details, ...end].join('\n');
}

function endingLine(answer: AskAnswer, options: AskField['options']): string {
    if (answer.typed) return 'You typed something else, so nothing was done.';
    if (answer.closed) return 'You closed this card, so nothing was done.';
    if (answer.expired) return 'No answer in time, so nothing was done.';
    const picked = options.find((option) => option.id === answer.option)?.label;
    if (answer.unknown) return `${picked ?? 'Approved'}. No answer came back, so it may or may not have worked. Check before trying again.`;
    if (answer.option === 'decline') return `${picked ?? "You said don't"}. Nothing was done.`;
    return [picked ? `You picked ${picked}.` : 'Approved.', answer.result, answer.allowedMore].filter(Boolean).join(' ');
}

/** The notice that carries the card, new. */
export function askNotice(ask: AskField): Record<string, unknown> {
    return { msgtype: 'm.notice', body: askBody(ask), [ASK_KEY]: ask };
}

/** The same notice edited: the card at its new revision, in place. */
export function askEdit(eventId: string, ask: AskField): Record<string, unknown> {
    const content = askNotice(ask);
    return {
        msgtype: 'm.notice',
        body: `* ${askBody(ask)}`,
        'm.new_content': content,
        'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
    };
}

/* ------------------------------------- results ------------------------------------- */

/** How an MCP tool's answer ended, for Orbit: a result is success, and an error carries what the connector proved. */
export function outcomeOf(result: unknown): 'succeeded' | 'failed' | 'notSent' | 'uncertain' {
    if (isPlain(result) && typeof result.error === 'string') {
        if (result.outcome === 'not_sent') return 'notSent';
        if (result.outcome === 'failed') return 'failed';
        // No proof that it did not run: it may have
        return 'uncertain';
    }
    return 'succeeded';
}

/** What the tool gave back, on one short line for the card: its first text, or nothing. */
export function resultLine(result: unknown): string | undefined {
    const items = Array.isArray(result) ? result : [result];
    for (const item of items) {
        const text = typeof item === 'string' ? item : isPlain(item) && item.type === 'text' && typeof item.text === 'string' ? item.text : undefined;
        const line = text?.replace(/\s+/g, ' ').trim();
        if (line) return clip(line, RESULT_MAX);
    }
    return undefined;
}

/* --------------------------------------- taps --------------------------------------- */

export type Tap =
    | { action: 'decide'; option: AskDecision }
    | { action: 'close' }
    | { action: 'moreTime' }
    | { action: 'reviewAgain' }
    | { action: 'askAgain' };

export interface ParsedTap {
    ask: string;
    revision: number;
    tap: Tap;
}

const DECISIONS: AskDecision[] = ['approve', 'approveAndRemember', 'decline'];

/** A `universe.ask.answer` event's content, or null when it isn't one. Only the card's id and revision come in: never content. */
export function parseTap(content: unknown): ParsedTap | null {
    if (!isPlain(content) || content.v !== 1) return null;
    if (typeof content.ask !== 'string' || !content.ask || content.ask.length > 200) return null;
    if (typeof content.revision !== 'number' || !Number.isInteger(content.revision) || content.revision < 0) return null;
    switch (content.action) {
        case 'decide':
            return DECISIONS.includes(content.option as AskDecision)
                ? { ask: content.ask, revision: content.revision, tap: { action: 'decide', option: content.option as AskDecision } }
                : null;
        case 'close':
        case 'moreTime':
        case 'reviewAgain':
        case 'askAgain':
            return { ask: content.ask, revision: content.revision, tap: { action: content.action } };
        default:
            return null;
    }
}
