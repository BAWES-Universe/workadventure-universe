/**
 * What a goal's, watch's or briefing's run reads of an App's answer or a web page, made to fit the room a chat reply has (the same
 * 80,000 characters, "Room for tool results in one reply") without losing what the Brick needs and without ever cutting silently.
 *
 * An App's answer can carry far more than anyone reads: a mail answer holds each message's whole encoded body, its raw HTML and a
 * dozen routing headers beside the sender, the subject, the date and the snippet. Cutting such an answer at a fixed length left the
 * Brick a few messages and half of one (game #2002 follow-up). So, in this order:
 *
 *  1. What nobody reads is taken out: encoded bodies (base64), raw HTML (kept as its text), routing headers. Sender, subject, date,
 *     snippet and the plain text of a body stay.
 *  2. If the answer is still too long, whole items are left out of the longest list, never half of one, and the answer says so
 *     ("Showing 20 of 50 ...").
 *  3. Only when there is no list to shorten is the text cut, and then with the same notice a chat reply gives.
 *
 * Pure: no model, no chat, no Orbit.
 */
import { clipped, cutNote } from '../ai/replySteps';
import { BOT_LIMIT_DEFAULTS } from '../ai/types';

/**
 * What an answer can be at most, as text for the model: the room a chat reply has by default, less a tenth that is left for what goes
 * beside it in the run's room (what the model said and called, the lines older results were set aside to). An answer made to fit the whole
 * room would be cut a second time there, in the middle of an item.
 */
export const RUN_ANSWER_MAX = Math.floor(BOT_LIMIT_DEFAULTS.roomChars * 0.9);

/** A text, cut to `max` characters when it is longer, and saying so. As it was when it fits. */
export function cutWithNote(text: string, max: number = RUN_ANSWER_MAX): string {
    if (text.length <= max) return text;
    const kept = clipped(text, max);
    return `${kept}${cutNote(kept.length, text.length)}`;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Long enough that a run of base64 characters is a body or an attachment and not a word, a token or an id. */
const ENCODED_MIN = 1000;
const BASE64_TEXT = /^[A-Za-z0-9+/_-]+={0,2}$/;
const HEX_ONLY = /^[0-9a-fA-F-]+$/;
const DATA_URI = /^data:[^;,]{1,100};base64,/i;
const HTML_TAG = /<\/?(?:html|head|body|div|span|table|tbody|tr|td|p|a|br|img|ul|ol|li|h[1-6]|style|script|center|font|b|i|strong|em)\b[^>]*>/gi;
const HTML_DOCUMENT = /<(?:!doctype|html|body)\b/i;
/** Headers that say how a message travelled, not what it says. */
const ROUTING_HEADER = /^(?:received(?:-spf)?|dkim-signature|domainkey-signature|arc-[a-z-]+|authentication-results|x-[a-z0-9-]+|return-path|mime-version|content-transfer-encoding|list-unsubscribe-post|feedback-id|precedence)$/i;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Base64 or base64url text, line breaks and all, long enough to be a body or a file. */
function isEncoded(text: string): boolean {
    if (DATA_URI.test(text)) return text.length >= ENCODED_MIN;
    if (text.length < ENCODED_MIN) return false;
    const spaces = (text.match(/\s/g) ?? []).length;
    // Prose has a space every few characters; mail's base64 only has its line breaks
    if (spaces > text.length * 0.04) return false;
    const lines = text.trim().split(/\s+/);
    // A list of identifiers (commit SHAs, UUIDs) is short runs, one to a line; base64 is one run, or lines wrapped at 64 or 76 columns
    if (lines.slice(0, -1).some((line) => line.length < 60)) return false;
    const joined = lines.join('');
    // Hex digits and dashes alone are hashes and ids; base64 of a body or a file has other letters in it
    if (HEX_ONLY.test(joined)) return false;
    return BASE64_TEXT.test(joined);
}

/** The text of a mail or page written in HTML: no tags, styles or scripts, one blank line between blocks. */
function htmlAsText(html: string): string {
    return html
        .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(#?\w+);/g, (whole, name: string) => {
            const numeric = /^#(\d+)$/.exec(name);
            if (numeric) {
                const code = Number(numeric[1]);
                return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
            }
            return ENTITIES[name.toLowerCase()] ?? whole;
        })
        .replace(/[ \t\f\v ]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function looksLikeHtml(text: string): boolean {
    if (text.length < 200) return false;
    if (HTML_DOCUMENT.test(text)) return true;
    return (text.match(HTML_TAG) ?? []).length >= 10;
}

// Headers only a mail has (an HTTP response shares From, Date and Content-Type with it, so those alone do not say it is a mail)
const MAIL_HEADER = /^(?:subject|message-id|received|mime-version|delivered-to)$/i;

/** The headers of a mail: under a key `headers` in a message part (the object has a `mimeType`, as a mail's payload does), as name and value pairs, with at least one header only a mail has. Any other list of names and values is data. */
function isMailHeaders(value: unknown[]): value is { name: string; value: string }[] {
    const pairs = value.every((one) => isObject(one) && typeof one.name === 'string' && typeof one.value === 'string' && Object.keys(one).length === 2);
    return pairs && value.some((one) => MAIL_HEADER.test((one as { name: string }).name));
}

const MAIL_TOOL = /(?:^|[^a-z])(?:gmail|googlemail|outlook|imap)(?:[^a-z]|$)/i;

/** Whether a tool is a mail App's, by its own name or its App's (GMAIL_FETCH_EMAILS, "Outlook"): the real names, not a loose word that chat or Slack tools share. */
export function isMailTool(toolName: string, serverName?: string): boolean {
    return MAIL_TOOL.test(toolName) || (serverName !== undefined && MAIL_TOOL.test(serverName));
}

/** A message part of a mail: a `mimeType` with the body or the parts of the message beside it, or the ids a mail service gives its messages. A `mimeType` alone is any App's field. */
function isMailPart(value: Record<string, unknown>): boolean {
    if (typeof value.mimeType !== 'string') return false;
    return isObject(value.body) || Array.isArray(value.parts) || Array.isArray(value.labelIds) || typeof value.threadId === 'string';
}

/** What was taken out, so an answer that lost nothing can be given exactly as it came. */
interface Taken {
    count: number;
}

const leftOut = (text: string) => `[encoded content left out, ${text.length.toLocaleString('en-US')} characters]`;

/** Strings, and numbers (a number is the whole token, so a digit inside a longer one is never taken for a number of its own). */
const JSON_TOKEN = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/**
 * JSON text with each whole number too big for a number to hold exactly (a 64-bit id) written as a string, so reading it does not round it:
 * the model must get back the id it was given.
 */
function keepBigNumbers(text: string): string {
    return text.replace(JSON_TOKEN, (token) => (token.startsWith('"') || /[.eE]/.test(token) || Number.isSafeInteger(Number(token)) ? token : `"${token}"`));
}

/** A text from an App: JSON written as text (an App's answer is often a text block holding JSON) is read as JSON, so what is in it can be left out. */
function readJson(text: string): { ok: true; value: unknown } | { ok: false } {
    const start = text.trimStart()[0];
    if (start !== '{' && start !== '[') return { ok: false };
    try {
        return { ok: true, value: JSON.parse(keepBigNumbers(text)) };
    } catch {
        return { ok: false };
    }
}

/** A file an App gives as base64 with its encoding named beside it (a repository's file is one): the text it holds, when it is text. */
function decodedFile(value: Record<string, unknown>): string | null {
    if (typeof value.content !== 'string' || typeof value.encoding !== 'string' || value.encoding.toLowerCase() !== 'base64') return null;
    const text = Buffer.from(value.content, 'base64').toString('utf8');
    return text.includes('\ufffd') ? null : text;
}

/**
 * The answer rebuilt without what nobody reads. Always new objects and lists, so what is built can be changed in place. `html` also turns
 * raw HTML into its text: it is only asked for when the answer does not fit otherwise, because markup can be what an App was asked for
 * (a page's source, a component) and what fits is never changed.
 */
function tidy(value: unknown, taken: Taken, html: boolean, mail: boolean): unknown {
    if (typeof value === 'string') {
        if (isEncoded(value)) {
            taken.count++;
            return leftOut(value);
        }
        const json = readJson(value);
        if (json.ok) return tidy(json.value, taken, html, mail);
        if (html && looksLikeHtml(value)) {
            taken.count++;
            return htmlAsText(value);
        }
        return value;
    }
    if (Array.isArray(value)) return value.map((one) => tidy(one, taken, html, mail));
    if (isObject(value)) {
        // A file is its text, not its base64
        const file = decodedFile(value);
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            if (file !== null && key === 'content') {
                // The file's own text, as it is: source code is never read as a mail
                taken.count++;
                out[key] = file;
            } else if (file !== null && key === 'encoding') {
                out[key] = 'utf-8';
            } else if (mail && key.toLowerCase() === 'headers' && Array.isArray(inner) && isMailPart(value) && isMailHeaders(inner)) {
                const kept = inner.filter((header) => !ROUTING_HEADER.test(header.name));
                if (kept.length < inner.length) taken.count++;
                out[key] = kept;
            } else {
                out[key] = tidy(inner, taken, html, mail);
            }
        }
        return out;
    }
    return value;
}

interface Place {
    /** Where the list is: its parent and the key or index in it. Null for a list that is the whole answer. */
    parent: Record<string, unknown> | unknown[] | null;
    key: string | number;
    items: Record<string, unknown>[];
}

/** The longest list of things (objects) in the answer, which is where its length is. */
function longestList(root: unknown): Place | null {
    let best: (Place & { size: number }) | null = null;
    const walk = (value: unknown, parent: Place['parent'], key: string | number) => {
        if (Array.isArray(value)) {
            if (value.length >= 2 && value.every(isObject)) {
                const size = JSON.stringify(value).length;
                if (!best || size > best.size) best = { parent, key, items: value as Record<string, unknown>[], size };
            }
            value.forEach((one, index) => walk(one, value, index));
        } else if (isObject(value)) {
            for (const [name, inner] of Object.entries(value)) walk(inner, value, name);
        }
    };
    walk(root, null, '');
    return best;
}

const listNote = (shown: number, whole: number) =>
    `Showing ${shown} of ${whole}: the other ${whole - shown} were left out because the whole answer was too long. Search again with narrower words or a smaller page to see them.`;

/** Sets the list to its first `shown` items, with the note that says so beside it. Gives the answer (a new one when the list was all of it). */
function showFirst(root: unknown, place: Place, shown: number): unknown {
    const kept = place.items.slice(0, shown);
    const note = listNote(shown, place.items.length);
    if (place.parent === null) return { note, items: kept };
    if (Array.isArray(place.parent)) place.parent[place.key as number] = { note, items: kept };
    else {
        place.parent[place.key as string] = kept;
        place.parent[`${String(place.key)}_note`] = note;
    }
    return root;
}

/**
 * An App's answer as the text the model reads in a run, in at most `max` characters (and a notice when it was cut). `mail`: the answer is
 * from a mail App (see isMailTool), the only answers whose routing headers are taken out. Throws only for
 * a value JSON cannot write; the caller turns that into a plain error.
 */
export function fitAppAnswer(value: unknown, max: number = RUN_ANSWER_MAX, mail = false): string {
    const asText = (answer: unknown) => (typeof answer === 'string' ? answer : JSON.stringify(answer ?? null));
    const asIs = asText(value);
    const taken: Taken = { count: 0 };
    let answer = tidy(value, taken, false, mail);
    // Nothing to take out and it fits: exactly as it came
    if (taken.count === 0 && asIs.length <= max) return asIs;
    // Still too long: raw HTML is read as its text too
    if (asText(answer).length > max) answer = tidy(value, { count: 0 }, true, mail);
    // Whole items out of the longest list, then of the next longest, until it fits or no list can be shortened
    for (let round = 0; round < 12 && asText(answer).length > max; round++) {
        const place = longestList(answer);
        if (!place) break;
        // The most items that fit (the note counted), at least one
        let low = 1;
        let high = place.items.length - 1;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (asText(showFirst(answer, place, middle)).length <= max) low = middle;
            else high = middle - 1;
        }
        answer = showFirst(answer, place, low);
    }
    return cutWithNote(asText(answer), max);
}
