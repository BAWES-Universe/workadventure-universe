/**
 * A ready-made App's actions on a Brick (game "Ask, Do, Ignore" for Bricks, Orbit #1042). Pure: no tool server, no chat.
 *
 * Orbit holds a ready-made App's grant as the App's own actions (Fetch emails, Send email...), each sorted under one of the four
 * headings, and the person picks Right away, Asks first or Off per heading and, when they want, per action. The App's link still
 * offers the model the provider's few tools of its own: a search, its schemas, its connections, and one tool that runs a batch of
 * actions. So the gate judges each action inside a batch on its own, never the batch tool itself, and lets the link's own lookups
 * run (Orbit drops every Off action from what they answer, and checks each read of a code job).
 */
import { actionName, batchCalls, withoutProvider, type BatchCall } from './AppBatch';
import type { ToolServerEntry } from './MCPConnector';
import { stricterHeading, type ToolHeading } from './ToolCatalog';
import type { ServerPolicy, ToolSetting } from './ToolPolicy';

/** The App link's tool that runs a batch of the App's actions: its `tools` list holds `{ tool_slug, arguments }`. Never shown to people. */
export const APP_BATCH_TOOL = 'COMPOSIO_MULTI_EXECUTE_TOOL';

/**
 * The App link's own tools that run as they are on a Brick's App, with the heading the per-use check is told: its search and its
 * schemas look things up, its connections change the account it uses, and Universe's code jobs only read (Orbit checks each read).
 */
const LINK_TOOLS: Readonly<Record<string, ToolHeading>> = {
    COMPOSIO_SEARCH_TOOLS: 'looksUp',
    COMPOSIO_GET_TOOL_SCHEMAS: 'looksUp',
    COMPOSIO_MANAGE_CONNECTIONS: 'changesThings',
    COMPOSIO_WAIT_FOR_CONNECTIONS: 'looksUp',
    UNIVERSE_CODE_JOB_START: 'looksUp',
    UNIVERSE_CODE_JOB_RESULT: 'looksUp',
    UNIVERSE_CODE_JOB_CANCEL: 'looksUp',
};

/** The heading of one of the link's own tools that runs as it is (any of Universe's own, too), or null when the name is not one. */
export function linkToolHeading(name: string): ToolHeading | null {
    const key = name.trim().toUpperCase();
    return LINK_TOOLS[key] ?? (key.startsWith('UNIVERSE_') ? 'looksUp' : null);
}

export const isBatchTool = (name: string): boolean => name.trim().toUpperCase() === APP_BATCH_TOOL;

/** Words that make an action a send, a delete or a spend, whatever else it says (the same list as Orbit's). A whole word of the slug. */
const SENDS_OR_DELETES = new Set([
    'SEND', 'SENDS',
    'REPLY', 'REPLIES',
    'FORWARD', 'FORWARDS',
    'DELETE', 'DELETES',
    'TRASH',
    'REMOVE', 'REMOVES',
    'PAY', 'PAYS', 'PAYMENT', 'PAYMENTS', 'PAYOUT', 'PAYOUTS',
    'PURCHASE', 'PURCHASES',
    'BUY', 'BUYS',
    'PUBLISH', 'PUBLISHES',
    'SHARE', 'SHARES',
    'INVITE', 'INVITES',
]);

/** Deletes or sends out when the slug's words say so; null when they don't. */
export function nameRule(slug: string): ToolHeading | null {
    return slug
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .some((word) => SENDS_OR_DELETES.has(word))
        ? 'deletesOrSends'
        : null;
}

/** How one action of a Brick's App is judged: its own choice, else its heading's. */
export interface ActionVerdict {
    slug: string;
    /** Plain words for it ("Fetch emails"). */
    title: string;
    heading: ToolHeading;
    setting: ToolSetting;
}

/**
 * An action as the grant says: its row's heading and own choice; an action with no row (past the first 500, or one the App's list
 * does not have yet) by its name, else as Deletes or sends out, under that heading's setting. Never looser than the name says.
 */
/** How an action's slug is compared: upper case, any other character than a letter or a digit as "_" (as Orbit keys them). */
export const slugKey = (slug: string): string => slug.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');

export function judgeAction(policy: Pick<ServerPolicy, 'tools' | 'settings'>, slug: string, appName?: string): ActionVerdict {
    const key = slugKey(slug);
    let row = policy.tools.get(slug.trim());
    if (!row) for (const tool of policy.tools.values()) if (slugKey(tool.name) === key) row = tool;
    const byName = nameRule(key);
    const heading: ToolHeading = row?.heading ? (byName ? stricterHeading(row.heading, byName) : row.heading) : (byName ?? 'deletesOrSends');
    const setting = row?.setting ?? policy.settings[heading];
    return { slug: slug.trim(), title: row?.title || actionName(slug.trim(), appName), heading, setting };
}

/**
 * The entry one action of a ready-made App runs under on a card of its own: its App's batch tool, named and titled as the action,
 * with no inputs of its own to show (the action's are its card's lines).
 */
export function appActionEntry(batch: ToolServerEntry, slug: string, title?: string): ToolServerEntry {
    const { inputSchema: _inputs, sharedJob: _shared, sharedAlt: _alt, ...rest } = batch;
    return { ...rest, title: title || withoutProvider(actionName(slug, batch.serverName)), appAction: { slug, batchTool: APP_BATCH_TOOL } };
}

/** "Delete for good is off for Sam in Gmail." for one; "Delete for good and Send email are off..." for several. */
export function offLine(titles: readonly string[], brick: string, app: string): string {
    const listed = titles.length <= 1 ? (titles[0] ?? 'That') : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
    return `${listed} ${titles.length <= 1 ? 'is' : 'are'} off for ${brick} in ${app}.`;
}

/** The line for an action no App of the Brick's says is its own, when it has several: it is never guessed. */
export const whichAppLine = (title: string) => `${title} wasn't done: it isn't clear which of your Apps it belongs to. Ask for it again, naming the App.`;

/** The person's own copy of an App this action is named after, when Universe's ready-made copy was left out for it (own Apps first). */
export const ownCopyOf = (slug: string, apps: readonly string[] | undefined): string | undefined => apps?.find((app) => actionName(slug, app) !== actionName(slug));

/** The line for an action of an App the person has their own copy of: it is never sent through another App's link. */
export const ownCopyLine = (title: string, app: string): string => `${title} wasn't done here: use your owner's own ${app} App for it.`;

/**
 * Which of a Brick's Apps under one tool name an action belongs to: the one whose action list has it, else the one its name names.
 * 'unclear' when several could own it, 'none' when no App lists it or is named by it. `policies` are the Apps' own, in the same order.
 */
export function ownerOfAction(slug: string, apps: readonly ToolServerEntry[], policies: readonly (ServerPolicy | null)[]): ToolServerEntry | 'unclear' | 'none' {
    const key = slugKey(slug);
    const listed = apps.filter((_, at) => [...(policies[at]?.tools.values() ?? [])].some((tool) => slugKey(tool.name) === key));
    if (listed.length === 1) return listed[0];
    if (listed.length > 1) return 'unclear';
    const named = apps.filter((app) => !!app.serverName && actionName(slug, app.serverName) !== actionName(slug));
    if (named.length === 1) return named[0];
    return named.length > 1 ? 'unclear' : 'none';
}

/** One action of a batch as the model asked for it: where it was in the list, and the entry exactly as it was written. */
export interface BatchPart extends BatchCall {
    index: number;
    raw: Record<string, unknown>;
}

/** The actions of a batch call with each entry as it came, or null when these are not a batch call's arguments. */
export function batchParts(args: unknown): BatchPart[] | null {
    const calls = batchCalls(args);
    if (!calls) return null;
    const list = (args as { tools: Record<string, unknown>[] }).tools;
    // Inputs written as JSON text are read as the object they hold: that object is what a card shows and what is sent (batchOf).
    // Inputs that can't be read as one make it no batch call at all (batchCalls)
    return calls.map((call, index) => ({ ...call, index, raw: list[index] }));
}

/**
 * A batch call's arguments holding only these parts, with its other top-level keys kept as they were. Each action is sent as it
 * was read (its slug and its inputs, nothing else), so what runs is exactly what a card showed.
 */
export function batchOf(args: Record<string, unknown>, parts: readonly BatchPart[]): Record<string, unknown> {
    return { ...args, tools: parts.map((part) => ({ tool_slug: part.slug, arguments: part.args })) };
}

/** The strictest heading of several (Looks things up when there are none). */
export const strictestOf = (headings: readonly ToolHeading[]): ToolHeading => headings.reduce<ToolHeading>((a, b) => stricterHeading(a, b), 'looksUp');

/* ------------------------------ what the Brick is told ------------------------------ */

/** At most this many actions are named in the line that tells the Brick what is off in an App. */
const OFF_NAMES_MAX = 20;

const HEADING_WORDS: Record<ToolHeading, string> = {
    looksUp: 'looks things up',
    makesNew: 'makes new things',
    changesThings: 'changes things',
    deletesOrSends: 'deletes or sends out',
};

/**
 * The line that tells the Brick what is Off in one App ("Off in Gmail: Delete for good, Send email."), so it says so and offers what it
 * may do instead of asking for it. Empty when nothing is off.
 */
export function offNote(policy: Pick<ServerPolicy, 'tools' | 'settings'>, app: string): string {
    const off: string[] = [];
    // The same verdict the gate gives: a row's own choice, else its heading's (an unsorted row's by its name)
    for (const tool of policy.tools.values()) if (judgeAction(policy, tool.name, app).setting === 'off') off.push(tool.title || actionName(tool.name, app));
    const wholeHeadings = (Object.keys(HEADING_WORDS) as ToolHeading[]).filter((heading) => policy.settings[heading] === 'off');
    if (off.length === 0 && wholeHeadings.length === 0) return '';
    const names = off.slice(0, OFF_NAMES_MAX);
    const more = off.length - names.length;
    const listed = names.length > 0 ? `${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}` : '';
    const whole = wholeHeadings.length > 0 ? `anything else that ${wholeHeadings.map((heading) => HEADING_WORDS[heading]).join(' or ')}` : '';
    return `Off in ${app}: ${[listed, whole].filter(Boolean).join('; ')}.`;
}

/* ------------------------------ Off actions in the link's answers ------------------------------ */

/** The link's own lookups whose answers name the App's actions: what they answer is held to what is not Off. */
export const SCRUBBED_LOOKUPS: ReadonlySet<string> = new Set(['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_GET_TOOL_SCHEMAS']);

/** Whether a slug is one of the grant's own actions and is Off for it (only a known action is ever taken out of an answer). */
export function isOffRow(policy: Pick<ServerPolicy, 'tools' | 'settings'>, slug: string): boolean {
    const key = slugKey(slug);
    // Judged as the gate judges it, so what is refused at the call is never offered in a lookup either
    for (const tool of policy.tools.values()) if (slugKey(tool.name) === key) return judgeAction(policy, tool.name).setting === 'off';
    return false;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A value that names an App action the way the App's lists do (GMAIL_FETCH_EMAILS): only such a value is ever taken out. */
const looksLikeSlug = (value: string): boolean => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(value.trim());

const NAME_KEYS = ['tool_slug', 'slug', 'name', 'tool', 'toolSlug'];

function scrub(value: unknown, isOff: (slug: string) => boolean, depth = 0): { value: unknown; changed: boolean } {
    if (depth > 32) return { value, changed: false };
    if (Array.isArray(value)) {
        let changed = false;
        const kept: unknown[] = [];
        for (const item of value) {
            if (typeof item === 'string' && looksLikeSlug(item) && isOff(item)) {
                changed = true;
                continue;
            }
            if (isObject(item) && NAME_KEYS.some((key) => typeof item[key] === 'string' && looksLikeSlug(item[key] as string) && isOff(item[key] as string))) {
                changed = true;
                continue;
            }
            const inner = scrub(item, isOff, depth + 1);
            changed ||= inner.changed;
            kept.push(inner.value);
        }
        return { value: kept, changed };
    }
    if (isObject(value)) {
        let changed = false;
        const kept: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            if (looksLikeSlug(key) && isOff(key)) {
                changed = true;
                continue;
            }
            const inner = scrub(item, isOff, depth + 1);
            changed ||= inner.changed;
            kept[key] = inner.value;
        }
        return { value: kept, changed };
    }
    return { value, changed: false };
}

/**
 * What one of the link's own lookups answered (its search, its schemas), with every Off action taken out, so the Brick never sees
 * one to ask for. Orbit's link does the same before it answers; this holds it again here. Text parts that are JSON are read and
 * written back; anything else is passed on as it came.
 */
export function withoutOff(result: unknown, isOff: (slug: string) => boolean): unknown {
    if (typeof result === 'string') {
        const text = result.trim();
        if (!text.startsWith('{') && !text.startsWith('[')) return result;
        try {
            const cleaned = scrub(JSON.parse(text), isOff);
            return cleaned.changed ? JSON.stringify(cleaned.value) : result;
        } catch {
            return result;
        }
    }
    if (Array.isArray(result)) {
        let changed = false;
        const parts = result.map((part) => {
            if (isObject(part) && part.type === 'text' && typeof part.text === 'string') {
                const text = withoutOff(part.text, isOff);
                if (text !== part.text) {
                    changed = true;
                    return { ...part, text };
                }
                return part;
            }
            const cleaned = scrub(part, isOff);
            changed ||= cleaned.changed;
            return cleaned.value;
        });
        return changed ? parts : result;
    }
    if (isObject(result)) {
        const cleaned = scrub(result, isOff);
        return cleaned.changed ? cleaned.value : result;
    }
    return result;
}

/** What happened to one action of a batch call, in the words of `outcomeOf`. */
export type PartOutcome = 'succeeded' | 'failed' | 'notSent' | 'uncertain';

/** The batch answer as data: an object, the JSON text of one, or the MCP text parts that carry it. */
function answerData(answer: unknown): Record<string, unknown> | undefined {
    if (isObject(answer)) {
        if (Array.isArray(answer.content)) return answerData(answer.content);
        return answer;
    }
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
        for (const part of answer) {
            const found = isObject(part) && part.type === 'text' ? answerData(part.text) : undefined;
            if (found) return found;
        }
    }
    return undefined;
}

/**
 * Each action's own outcome in a batch call that answered (the provider's documented shape: `{ successful, error?, data: {
 * results: [{ index, tool_slug, response?, error? }] } }`, results in the order they were sent). An action whose result carries an
 * error, or that has no result in a list that has some, is not known to be done. An answer whose shape can't be read keeps the
 * call's own outcome for every action, as before. `slugs` are the actions as sent, in order.
 */
export function batchOutcomes(answer: unknown, slugs: readonly string[], whole: PartOutcome): PartOutcome[] {
    if (whole !== 'succeeded') return slugs.map(() => whole);
    const data = answerData(answer);
    const inner = data && isObject(data.data) ? data.data : data;
    const results = inner?.results;
    if (!Array.isArray(results)) {
        // No list to read: an answer that says it was not successful is not known to be done
        return slugs.map(() => (data?.successful === false ? 'uncertain' : 'succeeded'));
    }
    const outcomes: PartOutcome[] = slugs.map(() => 'uncertain');
    const taken = new Set<number>();
    results.forEach((item, position) => {
        if (!isObject(item)) return;
        const slug = typeof item.tool_slug === 'string' ? slugKey(item.tool_slug) : undefined;
        const at =
            typeof item.index === 'number' && Number.isInteger(item.index) && item.index >= 0 && item.index < slugs.length && (!slug || slugKey(slugs[item.index]) === slug)
                ? item.index
                : slug
                ? slugs.findIndex((one, i) => !taken.has(i) && slugKey(one) === slug)
                : position < slugs.length && !taken.has(position)
                ? position
                : -1;
        if (at < 0 || taken.has(at)) return;
        taken.add(at);
        const failed = (typeof item.error === 'string' && item.error.trim() !== '') || item.successful === false;
        outcomes[at] = failed ? 'uncertain' : 'succeeded';
    });
    return outcomes;
}
