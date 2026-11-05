/**
 * What may leave the bot server for PostHog (#1841). Every event goes through one allowlist that this file owns:
 * a property that is not listed is dropped, and a listed one is kept only when its value has the shape of what it
 * is meant to hold (a count, an id, a model name, a tool name, an error class). Words never fit those shapes, so a
 * mistake elsewhere in the code, a new field, or a tool server that names a tool after what it was asked, cannot
 * put a message, an email, a file name or a provider's error text into an event.
 *
 * Pure functions, no I/O.
 */

/** Returns the value to send, or undefined to leave the property out. */
export type Check = (value: unknown) => unknown;
export type Schema = Record<string, Check>;

const ID = /^[A-Za-z0-9!][A-Za-z0-9_.:!#~/=-]{0,199}$/;
const KEY = /^[$A-Za-z][A-Za-z0-9_.$-]{0,99}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,99}$/;
const TOOL = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const URL_SEGMENT = /^[A-Za-z0-9_.~@-]{1,100}$/;

/** Most tool names listed on one event; the count still says how many there were. */
export const MAX_TOOL_NAMES = 25;

/** An id the system made (bot, conversation, trace, room): no spaces, no @, no query string. A number counts as its digits. */
export const id: Check = (value) => {
    const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    return typeof text === 'string' && ID.test(text) ? text : undefined;
};

const SPACE = /^[A-Za-z0-9!@][A-Za-z0-9_.:!#~/=@-]{0,199}$/;

/**
 * The name of a space (a room, a bubble, a direct-message room). Universe rooms have an "@" in them as a path part
 * ("@/universe/world"), so an "@" is kept when it stands on its own between "/", "." or ":" or the ends of the name,
 * and a name with an "@" inside a word (an email address) is left out.
 */
export const spaceName: Check = (value) => {
    if (typeof value !== 'string' || !SPACE.test(value)) return undefined;
    for (const match of value.matchAll(/@/g)) {
        const before = value[match.index - 1];
        const after = value[match.index + 1];
        if ((before !== undefined && !'/.:'.includes(before)) || (after !== undefined && !'/.:'.includes(after))) return undefined;
    }
    return value;
};

/** A model, provider or universe name: letters, digits and a few joiners, no spaces. */
export const label: Check = (value) => (typeof value === 'string' && LABEL.test(value) ? value : undefined);

export const bool: Check = (value) => (typeof value === 'boolean' ? value : undefined);

function numberWithin(max: number, whole: boolean): Check {
    return (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) return undefined;
        return whole ? Math.round(value) : value;
    };
}
export const count = numberWithin(1e9, true);
export const seconds = numberWithin(1e5, false);
export const dollars = numberWithin(1e5, false);
export const percent = numberWithin(1000, false);
export const megabytes = numberWithin(1e7, false);

/** One of a fixed list. */
export function oneOf(...allowed: string[]): Check {
    return (value) => (typeof value === 'string' && allowed.includes(value) ? value : undefined);
}

/**
 * Tool names, in order. A name must look like a function name; one that does not (a tool server can name a tool after
 * anything) is listed as "other". Names are the ones the bot's tools were set up with, never what they were given or
 * answered.
 */
export const toolNames: Check = (value) => {
    if (!Array.isArray(value)) return undefined;
    return value.slice(0, MAX_TOOL_NAMES).map((name) => (typeof name === 'string' && TOOL.test(name) ? name : 'other'));
};

/**
 * An address without its query, fragment or login, kept only when every part of its path is made of plain id
 * characters. Anything else is left out whole rather than trimmed.
 */
export const address: Check = (value) => {
    if (typeof value !== 'string') return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
        let path: string;
        try {
            path = decodeURIComponent(url.pathname);
        } catch {
            return undefined;
        }
        const segments = path.split('/').filter(Boolean);
        if (!segments.every((segment) => URL_SEGMENT.test(segment))) return undefined;
        const clean = `${url.protocol}//${url.host}/${segments.join('/')}`;
        return clean.length <= 300 ? clean : undefined;
    } catch {
        return undefined;
    }
};

/**
 * What kind of failure a reply's problem line (replyProblem) describes. The line itself is never sent: only the class
 * from this fixed list. Anything the table does not know is "other".
 */
export function errorClassOf(problem: unknown): string | undefined {
    if (typeof problem !== 'string' || !problem) return undefined;
    if (/^the provider failed(?: \(\d{3}\))?$/.test(problem)) return 'provider_failed';
    if (/^no words and no tool call: it reached the longest reply/.test(problem)) return 'no_answer_reached_limit';
    if (/^no words and no tool call/.test(problem)) return 'no_answer';
    return 'other';
}

/** The provider's status out of a problem line like "the provider failed (429)", when it has one. */
export function errorStatusOf(problem: unknown): number | undefined {
    if (typeof problem !== 'string') return undefined;
    const match = /^the provider failed \((\d{3})\)$/.exec(problem);
    return match ? Number(match[1]) : undefined;
}

export const errorClass: Check = (value) => errorClassOf(value);
export const httpStatus: Check = (value) => (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined);

// The properties of the events this server sends. A new event or property is added here, in code review, or it is not sent.

/** $ai_generation and $ai_trace. */
export const AI_EVENT: Schema = {
    $ai_session_id: id,
    $ai_trace_id: id,
    $ai_model: label,
    $ai_provider: label,
    $ai_input_tokens: count,
    $ai_output_tokens: count,
    $ai_cache_read_input_tokens: count,
    $ai_cache_creation_input_tokens: count,
    $ai_cache_reporting_exclusive: bool,
    $ai_latency: seconds,
    $ai_cost: dollars,
    $ai_is_error: bool,
    $ai_error: errorClass,
    error_status: httpStatus,
    bot_id: id,
    player_id: id,
    space: spaceName,
    tool_names: toolNames,
    tool_call_count: count,
};

/** Plain events about the server rather than a person: the voice worker's load and the people it turned away (#1751). */
export const SERVER_EVENTS: Record<string, Schema> = {
    voice_worker_stats: {
        bot_server: id,
        bot_connections: count,
        sessions: count,
        audio_connections: count,
        peak_audio_connections: count,
        max_audio_connections: count,
        capacity_used_percent: percent,
        turned_away: count,
        turned_away_total: count,
        cpu_percent: percent,
        memory_mb: megabytes,
    },
    voice_paused_at_capacity: {
        bot_id: id,
        universe: label,
        room_url: address,
        turned_away: oneOf('connection', 'room', 'bubble'),
    },
};

const reported = new Set<string>();

/**
 * The properties of an event that the schema lists and whose values have the right shape. Left-out property names are
 * logged once each (names only, never values) so a mistake shows up in the logs without carrying what it was.
 */
export function allowed(event: string, schema: Schema, raw: Record<string, unknown>): Record<string, unknown> {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (value === undefined || value === null) continue;
        const check = Object.prototype.hasOwnProperty.call(schema, key) ? schema[key] : undefined;
        const clean = check ? check(value) : undefined;
        if (clean === undefined) {
            const note = `${KEY.test(event) ? event : '(unsafe event)'}.${KEY.test(key) ? key : '(unsafe name)'}`;
            if (!reported.has(note)) {
                reported.add(note);
                console.warn(`[PostHog] Left out a property that is not allowed or has the wrong shape: ${note}`);
            }
            continue;
        }
        kept[key] = clean;
    }
    return kept;
}
