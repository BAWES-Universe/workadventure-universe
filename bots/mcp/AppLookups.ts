/**
 * The link's own lookups (its search, its schemas) on a Brick with several Apps. Pure: no tool server, no chat.
 *
 * Every ready-made App's link offers the same tools under the same names, and a search or a schemas request only knows the actions
 * of the App whose link answers it. With Gmail and Calendar on one Brick, asking Gmail's link about calendar actions finds nothing,
 * so these two lookups are asked of every App that allows them and the answers are joined into one. What each App's answer holds
 * is kept; an App that did not answer is named, never left out in silence.
 */
import { SCRUBBED_LOOKUPS, ownerOfAction } from './AppActions';
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
function failureOf(answer: unknown): string | undefined {
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
