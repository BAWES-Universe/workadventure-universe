/**
 * Plain words for what an App's tools show people (game #2131). Pure: no tool server, no chat.
 *
 * - A batch call (the App link's "run these tools" tool, whose arguments hold `tools`, a list of `{ tool_slug, arguments }`)
 *   is named by what its tools do, not by the provider's own title ("Multi Execute Composio Tools").
 * - The provider's name never shows in a tool's title.
 * - An input line reads in plain words: "Label ids" is "Labels", "INBOX" is "Inbox". Nothing else about a value changes.
 */

/** One tool inside a batch call. */
export interface BatchCall {
    slug: string;
    args: Record<string, unknown>;
}

const isPlain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The tools inside a batch call's arguments, or null when these are not a batch call: `tools` must be a list of at least one
 * object, each with a `tool_slug` that has a letter in it. The tool's own `arguments` are an object, or nothing.
 */
export function batchCalls(args: unknown): BatchCall[] | null {
    if (!isPlain(args) || !Array.isArray(args.tools) || args.tools.length === 0) return null;
    const calls: BatchCall[] = [];
    for (const item of args.tools) {
        if (!isPlain(item) || typeof item.tool_slug !== 'string' || !/[A-Za-z]/.test(item.tool_slug)) return null;
        calls.push({ slug: item.tool_slug.trim(), args: isPlain(item.arguments) ? item.arguments : {} });
    }
    return calls;
}

/**
 * Top-level keys of the batch tool that are the model's own notes or the provider's own plumbing, never shown to people:
 * a one-sentence "thought", the step it is on and its progress, the provider's session, and where the provider keeps a long
 * answer (ignored by App links, whose sandbox is off). Any other key a batch call carries is shown after the actions.
 */
const BATCH_QUIET_KEYS = new Set(['tools', 'thought', 'current_step', 'current_step_metric', 'session_id', 'sync_response_to_workbench']);

/** The top-level arguments of a batch call that people still see: everything but the list of tools and the quiet keys. */
export function batchExtras(args: Record<string, unknown>): Record<string, unknown> {
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) if (!BATCH_QUIET_KEYS.has(key.toLowerCase())) extras[key] = value;
    return extras;
}

const letters = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '');

/** "GMAIL_FETCH_EMAILS" reads "Fetch emails" once the App's name is dropped; the rest of the slug in lower case words. */
function slugWords(slug: string): string {
    const words = slug
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_\-.\s]+/g, ' ')
        .trim()
        .toLowerCase();
    return words ? words[0].toUpperCase() + words.slice(1) : 'Use a tool';
}

/**
 * The action in a tool's slug: its leading App prefix is dropped when it is the App's name (letters only, any case:
 * `GOOGLECALENDAR_FIND_EVENT` with "Google Calendar" is "Find event"), else the whole slug is tidied.
 */
export function actionName(slug: string, appName?: string): string {
    const app = appName ? letters(appName) : '';
    if (app) {
        const parts = slug.split(/[_\-.\s]+/).filter(Boolean);
        for (let take = 1; take < parts.length; take++) {
            const prefix = letters(parts.slice(0, take).join(''));
            if (prefix === app) return slugWords(parts.slice(take).join('_'));
            if (prefix.length >= app.length) break;
        }
    }
    return slugWords(slug);
}

const lowerFirst = (text: string) => (/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

/** One action is its name; two are "Fetch emails and list labels"; more are "Fetch emails and 2 more". */
export function batchTitle(names: string[]): string {
    if (names.length <= 1) return names[0] ?? 'Use a tool';
    if (names.length === 2) return `${names[0]} and ${lowerFirst(names[1])}`;
    return `${names[0]} and ${names.length - 1} more`;
}

/** The title and actions of a batch call by what its tools do, or null when it is not one. */
export function describeBatch(args: unknown, appName?: string): { title: string; names: string[]; calls: BatchCall[] } | null {
    const calls = batchCalls(args);
    if (!calls) return null;
    const names = calls.map((call) => withoutProvider(actionName(call.slug, appName)) || 'Use a tool');
    return { title: batchTitle(names), names, calls };
}

/** A title as people read it: the provider's name taken out ("Multi Execute Composio Tools" is "Multi Execute Tools"), spaces tidied. */
export function withoutProvider(title: string): string {
    if (!/\bcomposio\b/i.test(title)) return title;
    const words = title
        .replace(/\bcomposio(?:['’]s)?\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return words ? words[0].toUpperCase() + words.slice(1) : '';
}

/* ------------------------------ plain-word input lines ------------------------------ */

/**
 * An input's label in plain words: a trailing "ids" word turns what is before it plural ("Label ids" is "Labels"), a
 * trailing "id" word goes ("User id" is "User"). A label that is only that word stays.
 */
export function plainLabel(label: string): string {
    const many = /^(.*\S)\s+ids$/i.exec(label);
    if (many) return /s$/i.test(many[1]) ? many[1] : `${many[1]}s`;
    const one = /^(.*\S)\s+id$/i.exec(label);
    return one ? one[1] : label;
}

/** One ALL-CAPS word, or several joined by underscores: "INBOX", "CATEGORY_UPDATES". Letters only, so an id like "ORD_12345" is never taken for one. */
const CAPS_WORD = /^[A-Z]+(?:_[A-Z]+)*$/;

/** A value in plain words: "CATEGORY_UPDATES" reads "Category updates". Any other text stays exactly as it will run. */
export function plainWords(value: string): string {
    const text = value.trim();
    if (text.length < 2 || !CAPS_WORD.test(text)) return value;
    const words = text.toLowerCase().replace(/_+/g, ' ');
    return words[0].toUpperCase() + words.slice(1);
}

/**
 * Inputs whose capital words are labels, not names or codes: a mail "Label ids" of INBOX, a "Status" of OPEN. Any other input
 * (a currency of USD, a query of SQL) shows exactly as it will run.
 */
const WORD_KEY = /^(labels?(_?ids?)?|folders?|mailbox(es)?|categor(y|ies)|status|priority|visibility|sort(_?by)?)$/;

/** Whether an input's capital words read as plain words: "label_ids", "labelIds" and "Label ids" do, "currency" does not. */
export function readsAsWords(key: string): boolean {
    return WORD_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s\-.]+/g, '_').toLowerCase());
}

/** A list of words, numbers or yes/no joins with ", "; anything else is not a plain list. */
export function plainList(value: unknown, key?: string): string | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    if (!value.every((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) return undefined;
    const words = key === undefined || readsAsWords(key);
    return value.map((item) => (typeof item === 'string' ? (words ? plainWords(item) : item) : String(item))).join(', ');
}
