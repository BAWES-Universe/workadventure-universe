/**
 * The link's own lookups (its search, its schemas) on a Brick with several Apps. Pure: no tool server, no chat.
 *
 * Every ready-made App's link offers the same tools under the same names, and a search or a schemas request only knows the actions
 * of the App whose link answers it. With Gmail and Calendar on one Brick, asking Gmail's link about calendar actions finds nothing,
 * so these two lookups are asked of every App that allows them and the answers are joined into one. What each App's answer holds
 * is kept; an App that did not answer is named, never left out in silence.
 */
import { SCRUBBED_LOOKUPS, SHOWS_ACTIONS_RAN, ownerOfAction } from './AppActions';
import type { ToolServerEntry } from './MCPConnector';
import type { ServerPolicy } from './ToolPolicy';

/** The link tool that reads the details of named actions: its `tool_slugs` say which. */
const SCHEMAS_TOOL = 'COMPOSIO_GET_TOOL_SCHEMAS';

/** Whether this tool is one of the link's lookups that is asked of every App (its search, its schemas). */
export const isJoinedLookup = (name: string): boolean => SCRUBBED_LOOKUPS.has(name.trim().toUpperCase());

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What each App is asked. A schemas request that names actions goes, for each action, to the App that owns it (by its action list, else
 * by its name); an action no App clearly owns goes to every App, so it is never lost. An App with none of the named actions is not
 * asked at all. Any other request, or one whose names can't be read, goes to every App as it is.
 */
export function lookupRequests(name: string, args: Record<string, unknown>, apps: readonly ToolServerEntry[], policies: readonly (ServerPolicy | null)[]): Array<{ app: ToolServerEntry; args: Record<string, unknown> }> {
    const slugs = args?.tool_slugs;
    if (name.trim().toUpperCase() !== SCHEMAS_TOOL || !Array.isArray(slugs) || slugs.length === 0 || !slugs.every((slug) => typeof slug === 'string')) {
        return apps.map((app) => ({ app, args }));
    }
    const ownedBy = new Map<string, string[]>();
    for (const slug of slugs as string[]) {
        const owner = ownerOfAction(slug, apps, policies);
        for (const app of owner === 'none' || owner === 'unclear' ? apps : [owner]) ownedBy.set(app.serverId, [...(ownedBy.get(app.serverId) ?? []), slug]);
    }
    return apps.filter((app) => ownedBy.has(app.serverId)).map((app) => ({ app, args: { ...args, tool_slugs: ownedBy.get(app.serverId) } }));
}

/**
 * Why an answer is a failure, or undefined when it is not: the tool server's own error, or an answer that says so itself (the link's
 * `{ successful: false, error }`, as an object, as JSON text or as the one text part of an MCP answer), not something the App found.
 */
export function failureOf(answer: unknown): string | undefined {
    // A tool that answered nothing at all did not find anything: it is named, not read as an empty answer
    if (answer === null || answer === undefined) return 'it gave no answer.';
    const data = dataOf(answer);
    if (!isObject(data)) return undefined;
    if (typeof data.error === 'string' && data.error.trim() !== '') return data.error;
    return data.successful === false ? 'it reported a failure.' : undefined;
}

/** The JSON an answer holds: the object, the JSON text of one, or the one text part of an MCP answer that carries it. */
function dataOf(answer: unknown): unknown {
    if (typeof answer === 'string') {
        const text = answer.trim();
        if (!text.startsWith('{')) return undefined;
        try {
            const value: unknown = JSON.parse(text);
            return isObject(value) ? value : undefined;
        } catch {
            return undefined;
        }
    }
    if (Array.isArray(answer)) {
        const texts = answer.filter((part) => isObject(part) && part.type === 'text' && typeof part.text === 'string');
        // Only an answer that is one text part of JSON is read as data: anything else is passed on as it came
        return texts.length === 1 && texts.length === answer.length ? dataOf((texts[0] as { text: string }).text) : undefined;
    }
    return isObject(answer) ? answer : undefined;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const indexOf = (item: unknown): number | undefined => (isObject(item) && typeof item.index === 'number' ? item.index : undefined);

/** Two lists joined: items that carry the same `index` (one per question asked) are joined into one, anything else is added once. */
function joinLists(first: unknown[], second: unknown[], depth: number): unknown[] {
    const joined = [...first];
    for (const item of second) {
        const at = indexOf(item);
        const same = at === undefined ? joined.findIndex((one) => sameJson(one, item)) : joined.findIndex((one) => indexOf(one) === at);
        if (same < 0) joined.push(item);
        else if (at !== undefined) joined[same] = joinData(joined[same], item, depth + 1);
    }
    return joined;
}

/**
 * Two answers' data joined: lists add up (no item twice), objects keep every key of both, and where both hold a different single value
 * the first App's stays (the oldest App's), except a `successful` that either one holds.
 */
function joinData(first: unknown, second: unknown, depth = 0): unknown {
    if (depth > 16) return first;
    if (Array.isArray(first) && Array.isArray(second)) return joinLists(first, second, depth);
    if (isObject(first) && isObject(second)) {
        const joined: Record<string, unknown> = { ...first };
        for (const [key, value] of Object.entries(second)) {
            if (!(key in joined)) joined[key] = value;
            else if (key === 'successful') joined[key] = joined[key] === true || value === true;
            else joined[key] = joinData(joined[key], value, depth + 1);
        }
        return joined;
    }
    return first;
}

/** The answer made again in the shape the first one came in, so what reads it never sees another shape. */
function asShapeOf(shape: unknown, data: unknown): unknown {
    if (Array.isArray(shape)) return [{ type: 'text', text: JSON.stringify(data) }];
    if (typeof shape === 'string') return JSON.stringify(data);
    return data;
}

/** One App's words for what did not answer, in plain words. */
const noAnswerLine = (app: string, error: string): string => `${app || 'An App'} did not answer: ${error}`;

/**
 * One answer from the answers of each App asked, in the order the Apps are held (oldest first). An answer from one App, with none
 * that failed, is returned exactly as it came. Answers that are data are joined; any others are put one after another under the
 * App's name. An App that failed is named in the answer, and when every App failed the first failure is the answer.
 */
export function joinLookupAnswers(answers: ReadonlyArray<{ app: string; answer: unknown }>): unknown {
    const failed = answers.filter(({ answer }) => failureOf(answer) !== undefined);
    const good = answers.filter(({ answer }) => failureOf(answer) === undefined);
    if (good.length === 0) return answers[0]?.answer;
    if (good.length === 1 && failed.length === 0) return good[0].answer;
    const notes = failed.map(({ app, answer }) => noAnswerLine(app, failureOf(answer)!));
    const data = good.map(({ answer }) => dataOf(answer));
    if (data.every((one) => one !== undefined)) {
        const joined = data.slice(1).reduce((all, next) => joinData(all, next), data[0]);
        // The App that did not answer is named inside the answer the Brick reads, where it can't be missed
        const withNotes = notes.length > 0 && isObject(joined) ? { ...joined, apps_that_did_not_answer: notes } : joined;
        return asShapeOf(good[0].answer, withNotes);
    }
    // Not data: each App's own words, one after another
    const textOf = (answer: unknown): string =>
        typeof answer === 'string'
            ? answer
            : Array.isArray(answer)
              ? answer.map((part) => (isObject(part) && typeof part.text === 'string' ? part.text : JSON.stringify(part))).join('\n')
              : JSON.stringify(answer);
    return [...good.map(({ app, answer }) => ({ type: 'text', text: `${app ? `${app}:\n` : ''}${textOf(answer)}` })), ...notes.map((text) => ({ type: 'text', text }))];
}

/**
 * The link's own tools that are tried again without a session id its link refused: the lookups only (search, schemas), which change nothing
 * and are safe to repeat. Never the batch that runs actions: nothing proves the link refuses a session before it runs anything, and a repeated
 * write (a second calendar event) is worse than a refused one, which only asks the model to start a new session.
 */
const SESSION_TOOLS: ReadonlySet<string> = new Set(['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_GET_TOOL_SCHEMAS']);

/** The session id the inputs carry: `session_id`, else the `id` of `session`. */
export const sessionIdOf = (args: Record<string, unknown>): string | undefined => {
    if (typeof args?.session_id === 'string' && args.session_id !== '') return args.session_id;
    return isObject(args?.session) && typeof args.session.id === 'string' && args.session.id !== '' ? args.session.id : undefined;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A fixed word of a refusal, in any case (the session id is the only part compared exactly). */
const word = (text: string): string => text.replace(/[a-z]/gi, (letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`);

/**
 * The only shapes an error line may have to count as the link refusing the session id that was sent. The WHOLE line (after the connector's
 * "Tool error:" and without the data kept after it) must be one of them, with the sent id exactly as it was sent (in quotes or not) where an id
 * is named: any other words, any other id, or the id where a refusal word stands, is no refusal and nothing is tried again.
 *   Invalid session            Invalid session id <sent id>        Unknown session        Expired session ...
 *   Session not found          Session id <sent id> is not found   Session is invalid     Session id is expired ...
 */
function refusalShapes(id: string): RegExp[] {
    const named = `["'\`]?${escapeRegExp(id)}["'\`]?`;
    const bad = `(?:${[word('not found'), word('invalid'), word('unknown'), word('expired'), word('missing')].join('|')})`;
    const before = `(?:${['invalid', 'unknown', 'expired', 'unrecognized', 'missing'].map(word).join('|')})`;
    const session = word('session');
    const idWord = word('id');
    const verb = `(?:${word('is')}|${word('was')})`;
    return [
        // Invalid session / Invalid session id / Invalid session id <sent id>
        new RegExp(`^${before} ${session}(?: ${idWord}:?)?(?: ${named})?$`),
        // Session not found / Session is invalid
        new RegExp(`^${session}(?: ${verb})? ${bad}$`),
        // Session id is not found
        new RegExp(`^${session} ${idWord} ${verb} ${bad}$`),
        // Session id <sent id> not found / is not found
        new RegExp(`^${session}(?: ${idWord}:?)? ${named}(?: ${verb})? ${bad}$`),
    ];
}

/** The words of an error line: without the connector's "Tool error:", the data kept after them, closing punctuation and extra spaces. */
const refusalWords = (line: string): string =>
    line
        .replace(/\s[{[][\s\S]*$/, '')
        .replace(/^\s*(?:tool error|error)\s*:\s*/i, '')
        .replace(/[.!\s]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();

/**
 * Whether a call failed only because the App's link refused the session id it was given, so that nothing ran: the model carries the
 * session id one App's link gave (the joined search keeps the oldest App's) to another App's link, which may not know it. True only for an
 * explicit refusal of the whole call (never a thrown error, an unsure outcome, or an answer that carries any sign that actions ran, at
 * the root, in `data` or in the error's own words) that names an invalid, unknown, expired or missing session and says nothing more than
 * that, in one of the exact shapes of `refusalShapes` (the session id it names can only be the one that was sent).
 */
export function sessionRefused(answer: unknown, args: Record<string, unknown>): boolean {
    const id = sessionIdOf(args);
    if (!id) return false;
    // A call that threw or whose outcome is not known may have run
    if (isObject(answer) && (answer.outcome === 'uncertain' || (typeof answer.error === 'string' && answer.error.startsWith('MCP tool error')))) return false;
    const line = failureOf(answer);
    if (line === undefined || line === 'it gave no answer.') return false;
    // An answer that carries the results of actions may have run some of them
    const data = dataOf(answer);
    const inner = isObject(data) && isObject(data.data) ? data.data : undefined;
    const hasResults = (value: Record<string, unknown> | undefined) => Array.isArray(value?.results) && value.results.length > 0;
    if (hasResults(isObject(data) ? data : undefined) || hasResults(inner)) return false;
    // The connector keeps the data of a failed call after its words (`Invalid session id x {"results":...}`): only the words are read here, as
    // the one retry that uses this is a lookup (search, schemas), which changes nothing and is safe to send again
    const message = refusalWords(line);
    if (SHOWS_ACTIONS_RAN.test(message)) return false;
    if (!refusalShapes(id).some((shape) => shape.test(message))) return false;
    return true;
}

/**
 * The inputs to try again with when this call failed only because its link refused the session id, or undefined when it is not to be
 * tried again: only an App's own ready-made link and only its lookups (search, schemas), never the batch that runs actions and never a person's own server, where
 * `session_id` can be a real input of the tool.
 */
export function retryWithoutSession(entry: { readyMade?: boolean }, toolName: string, args: Record<string, unknown>, answer: unknown): Record<string, unknown> | undefined {
    if (entry.readyMade !== true || !SESSION_TOOLS.has(toolName.trim().toUpperCase())) return undefined;
    return sessionRefused(answer, args) ? withoutSession(args) : undefined;
}
/** The same inputs without the session they carried (`session_id`, and the `id` of `session`), or undefined when they carried none. */
export function withoutSession(args: Record<string, unknown>): Record<string, unknown> | undefined {
    const bare: Record<string, unknown> = { ...args };
    let carried = false;
    if ('session_id' in bare) {
        delete bare.session_id;
        carried = true;
    }
    if (isObject(bare.session) && 'id' in bare.session) {
        const { id: _sessionId, ...others } = bare.session;
        if (Object.keys(others).length > 0) bare.session = others;
        else delete bare.session;
        carried = true;
    }
    return carried ? bare : undefined;
}

/** The session id a lookup's answer hands out (`data.session.id` of the link's answer, or `session.id` / `session_id` at its root), if any. */
export function sessionOfAnswer(answer: unknown): string | undefined {
    if (failureOf(answer) !== undefined) return undefined;
    const data = dataOf(answer);
    if (!isObject(data)) return undefined;
    for (const holder of [isObject(data.data) ? data.data : undefined, data]) {
        if (!holder) continue;
        if (isObject(holder.session) && typeof holder.session.id === 'string' && holder.session.id !== '') return holder.session.id;
        if (typeof holder.session_id === 'string' && holder.session_id !== '') return holder.session_id;
    }
    return undefined;
}

/**
 * Which App's link gave each session id the model may carry into a later call. A session id belongs to the link that handed it out; the
 * joined search keeps the oldest answering App's, which is not always the first App of the Brick (one may have its lookups off or fail).
 */
export class SessionOwners {
    private readonly owners = new Map<string, string>();

    constructor(private readonly limit = 500) {}

    /** Notes that this App's link answered with this session id. */
    note(scope: string, answer: unknown, serverId: string): void {
        const id = sessionOfAnswer(answer);
        if (!id) return;
        const key = `${scope}|${id}`;
        this.owners.delete(key);
        this.owners.set(key, serverId);
        while (this.owners.size > this.limit) this.owners.delete(this.owners.keys().next().value as string);
    }

    /** The App whose link gave the session id these inputs carry, when it is known. */
    ownerOf(scope: string, args: Record<string, unknown>): string | undefined {
        const id = sessionIdOf(args);
        return id ? this.owners.get(`${scope}|${id}`) : undefined;
    }
}
