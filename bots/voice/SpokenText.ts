/**
 * What a voice bot says out loud for a reply it has written (#1665). The chat always has the reply in full; this is
 * the same words as speech: no markup to read out, tables, code and links left to the chat with a short line saying
 * so, and nothing past the limit. A plain reply is returned as it is.
 */

/** What is said where something stays in the chat, and where the rest of a long reply does. */
export const SPOKEN_PHRASES = {
    table: 'The table is in the chat.',
    code: 'The code is in the chat.',
    link: 'The link is in the chat.',
    /** A web address in the middle of a sentence: the sentence goes on around it. */
    linkInSentence: 'the link in the chat',
    rest: 'The rest is in the chat.',
};

const FENCE = /```[\s\S]*?(?:```|$)/g;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Replaces each markdown table (a header, a rule, rows) with a marker. */
function withoutTables(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (TABLE_ROW.test(lines[i]) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
            i += 1;
            while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1])) i += 1;
            out.push('\u0001table\u0001');
        } else {
            out.push(lines[i]);
        }
    }
    return out.join('\n');
}

function plain(text: string): string {
    return text
        .replace(FENCE, '\u0001code\u0001')
        .replace(/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, '$1')
        .replace(/https?:\/\/\S*[^\s.,!?;:'")\]]/g, '\u0001link\u0001')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?;:]|$)/g, '$1$2')
        .replace(/`([^`\n]*)`/g, '$1');
}

const MARKERS: Record<string, string> = { table: SPOKEN_PHRASES.table, code: SPOKEN_PHRASES.code, link: SPOKEN_PHRASES.link };

/** The reply as speech, at most `maxChars` characters; empty when there is nothing to say. */
export function spokenVersion(reply: string, maxChars: number): string {
    let text = plain(withoutTables(reply.replace(/\r\n?/g, '\n')));
    // Lines run on as one thought; a marker that stands alone is a sentence of its own, and the same one twice in a row is said once
    text = text
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\u0001(table|code|link)\u0001(?:\s*\u0001\1\u0001)+/g, '\u0001$1\u0001')
        // A web address inside a sentence ("The board is at https://…") becomes part of it, not a sentence of its own
        .replace(/([\p{L}\p{N},;]\s*)\u0001link\u0001/gu, `$1${SPOKEN_PHRASES.linkInSentence}`)
        .replace(/\s*\u0001(table|code|link)\u0001[.!?]?/g, (_all, kind: string) => ` ${MARKERS[kind]}`)
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (!/[\p{L}\p{N}]/u.test(text)) return '';
    if (text.length <= maxChars) return text;
    // Too long to say: whole sentences up to the limit, then where the rest is
    const room = Math.max(0, maxChars - SPOKEN_PHRASES.rest.length - 1);
    const head = text.slice(0, room + 1);
    const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('。'));
    let cut = sentenceEnd > 0 ? head.slice(0, sentenceEnd + 1) : head.slice(0, Math.max(head.lastIndexOf(' '), 0)).replace(/[,;:\s]+$/, '');
    cut = cut.trim();
    return cut ? `${cut} ${SPOKEN_PHRASES.rest}` : SPOKEN_PHRASES.rest;
}
