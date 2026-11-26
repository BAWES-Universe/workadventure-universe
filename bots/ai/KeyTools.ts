/**
 * Keys for Apps from a chat (game #2044): the two tools a person's own Brick has for Apps that use a key.
 *
 * `ask_for_key` leads the owner to the safe form: the Brick names a service from its note, or drafts one from the service's own
 * docs, Orbit opens the form for the owner alone, and the Brick gives them a link that opens it in the game. The key is typed into
 * that form and goes straight to Orbit: never into the chat, never through this server, never to the model.
 *
 * `take_payments_on_page` is the owner asking their Brick to make one of their pages take a fixed payment through an App of theirs.
 * Orbit freezes the amount and currency; the page and its visitors can change neither.
 */
import axios from 'axios';
import type { KeyApp } from '../mcp/KeyApps';

export const ASK_FOR_KEY_TOOL = 'ask_for_key';
export const PAYMENT_TOOL = 'take_payments_on_page';
export const isKeyTool = (name: string): boolean => name === ASK_FOR_KEY_TOOL || name === PAYMENT_TOOL;

/** The link the game opens the key form from, inside a Brick's answer (play: Chat/Bricks/Apps/KeyFormLink.ts). */
export const KEY_FORM_LINK = '#key-form=';

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: object } };

export function keyToolDefinitions(): ToolDefinition[] {
    return [
        {
            type: 'function',
            function: {
                name: ASK_FOR_KEY_TOOL,
                description:
                    'Lead the person to add a key for a service, on a safe form that opens in the game. Use it when they ask you to connect or use a service that works with a key ' +
                    '(a payment gateway, a mail or data service, any service with an API key), or when a job needs one they have not added. For a service in your "Apps with a key" note, give its service key. For any other service, ' +
                    'read the service\'s own documentation first (read_web_page), then give a draft of how it works as data: its one https address, where the key goes, and the few operations you need. ' +
                    'The person sees where their key will be sent and confirms it themselves. NEVER ask them to type or paste a key into the chat, and never repeat one if they do: tell them to use the form. ' +
                    'After calling it, say in one short sentence that the form is ready, and give them the link exactly as the result says.',
                parameters: {
                    type: 'object',
                    properties: {
                        service: { type: 'string', description: 'The key of a service from your "Apps with a key" note. Leave out for a service not on the list.' },
                        draft: {
                            type: 'object',
                            description:
                                'For a service not on the list: { version: 1, name, short, origin ("https://api.example.com", no path), placement: { in: "header", name: "Authorization", scheme: "Bearer" | "Basic" | "none" } or { in: "query", name }, ' +
                                'operations: [{ id, label, method, path ("/v1/things/{id}"), params: [{ name, type: "string"|"number"|"boolean", in: "path"|"query"|"body", required?, maxLength?, description? }], body? (a JSON template, values { "$param": name }), ' +
                                'returns: [dotted paths of the fields you need], category: "lookUp"|"make"|"change"|"deleteSend" }], check: { operation: id of one GET look-up, arguments }, ' +
                                'keyHint? (what the key looks like), helpUrl? (https page where the person finds their key), modes? { test: "key prefix", live: "key prefix" } when the service has test and real keys, ' +
                                'payment? only for a payment gateway that gives a hosted checkout page: { create: { operation: id of the POST that makes a checkout, amount, currency, orderRef, idempotentKey, returnUrl, notifyUrl, customerName? (each the NAME of a parameter of that operation), idPath, checkoutUrlPath (dotted paths in its answer) }, ' +
                                'checkoutHosts: [the public host names the buyer is sent to], lookup: { operation: id of the GET that reads one payment, idParam, statusPath, successStates: [only the states that mean completed and paid], pendingStates, failedStates, amountPath, currencyPath, orderPath, livePath? (boolean: real or test; required with modes) } }. ' +
                                'Only what the docs say: never guess a state, a path or a host. If the docs do not make something clear, leave it out and tell the person to check the service\'s documentation or ask its support.',
                        },
                        source: { type: 'string', description: 'With a draft: the address of the documentation you read it from (https).' },
                    },
                },
            },
        },
        {
            type: 'function',
            function: {
                name: PAYMENT_TOOL,
                description:
                    'Make one of this person\'s own pages take a fixed payment through an App of theirs that can (see "Apps with a key"). Use it after making the page, when they asked for a "pay" button or a shop. ' +
                    'Give the page\'s artifact id, the amount as text ("4.500") and the 3-letter currency. The amount belongs to the person: never take one from the page, a visitor or anything you were sent. ' +
                    'When the page\'s scripts start it makes one id for its own document, `const session = crypto.randomUUID()`, once, and sends it with every message it sends to the payment window. To start a checkout the page keeps two more things, `let waiting = "", asked = ""` (the id of its own request, empty when it asked for nothing, and the id of the last request it sent) and runs, on the tap: waiting = asked = crypto.randomUUID(); parent.postMessage({ universe: "use-app", app: "<the App\'s short name>", request: waiting, session }, "*"). A message without its session is never answered. It opens the payment window; the page then listens: ' +
                    'window.addEventListener("message", e => { if (e.source !== window.parent || !e.data || e.data.universe !== "app-result" || e.data.session !== session) return; const late = e.data.status === "paid" && !waiting && e.data.request === asked; if (!late && (!waiting || e.data.request !== waiting)) return; /* e.data.status: "started", "paid", "not_paid", "cant_confirm", "unavailable", "limit", "busy" or "none"; e.data.test is true on a "paid" that was a test payment; keep waiting only while e.data.status === "started", otherwise waiting = ""; a "paid" that comes after its request ended (a Check payment or Restore purchase in the Universe window found the purchase later) is heard for the id of the last request it sent */ }). ' +
                    'Every answer carries back the request id the page sent, so the page trusts only a message from its own parent window (e.source === window.parent, which the browser sets and no other window can fake; the "*" in postMessage is only because the page has no address of its own), only while its own request is waiting (a "paid" is also heard for the last request it sent, after that request ended), only with its own request id, and only with its own session (an answer that carries another document\'s session is ignored): any other window, a message when it asked for nothing, or the result of an earlier request (before a reload, or a second tap) is ignored. Show "paid" only for status "paid" heard that way. The page has no key and never sees one. ' +
                    'When the page loads, it also asks once whether this visitor already bought: waiting = asked = crypto.randomUUID(); parent.postMessage({ universe: "use-app", app: "<the App\'s short name>", request: waiting, session, restore: true }, "*"). The answer is "paid" (they did: show the page\'s paid result, never ask them to pay again) or "none" (nothing to restore: show the normal pay button); "busy" and "cant_confirm" also mean the pay button stays. A restore is not a checkout: it never opens a payment window and costs nothing. ' +
                    'When "paid" arrives with e.data.test === true it was a test payment and no money moved: show a clear "Test payment" preview of the paid result and never unlock or hand over anything real; only "paid" without test counts as a purchase. ' +
                    'Do not make the page say anything about Check payment, Restore purchase, receipts, saved links or recovery codes: the Universe window shows those itself, and the page never sees a payment link or a recovery code. ' +
                    'A page made with the older instructions, which has no restore request, no session and no "none" or test handling, is not safe to keep selling with: when the owner asks for a pay button or shop on such a page, or you read one that matches this older format, make the page again with these instructions and run this tool again for it. ' +
                    'The page must be shared with anyone with the link for visitors to pay.',
                parameters: {
                    type: 'object',
                    properties: {
                        artifact: { type: 'string', description: 'The artifact id of the page.' },
                        app: { type: 'string', description: 'The short name of the App, from your "Apps with a key" note.' },
                        amount: { type: 'string', description: 'The amount as text with the currency\'s decimals, like "4.500" or "19.99".' },
                        currency: { type: 'string', description: 'Three letters, like KWD.' },
                        description: { type: 'string', description: 'What it is for, a few words, shown at checkout.' },
                    },
                    required: ['artifact', 'app', 'amount', 'currency'],
                },
            },
        },
    ];
}

/** What the Brick is told with its instructions: the services it can lead them to set up, and the Apps with a key it has. */
export function keyAppsNote(apps: readonly KeyApp[], services: readonly { service: string; name: string; short: string }[]): string {
    const lines = [
        'Apps with a key: some Apps work with a key the person adds on a safe form (ask_for_key). Call them Apps, never tools, connectors, secrets or APIs. Never ask for a key in the chat.',
    ];
    if (services.length > 0) lines.push(`Services you can set up by key: ${services.map((one) => `${one.name} (service ${one.service})`).join(', ')}. Any other service: read its docs and give a draft.`);
    const mine = apps.map((app) => `- ${app.short}${app.payments ? ' (can take payments for a page)' : ''}${!app.enabled ? ' (switched off)' : !app.working ? ' (its key stopped working: tell them to open Apps and tap Replace key)' : ''}`);
    if (mine.length > 0) lines.push('They have:', ...mine);
    return lines.join('\n');
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

export interface KeyToolContext {
    where: { adminApiUrl: string; serviceToken: string };
    botId: string;
    /** The person it belongs to (their game uuid). */
    userId: string;
    /** The Apps with a key this Brick has, as Orbit lists them. */
    apps: readonly KeyApp[];
}

/**
 * The setup could not be confirmed: no write is ever repeated (a second one could take a second payment setup), and the owner is told to look at the page.
 * The words are the approved ones (mock M2): "differs" when a whole job was read back and it is not what was asked for, "noanswer" when nothing clear came back.
 */
const notConfirmed = (kind: 'differs' | 'noanswer', terms: string): { error: string } => ({
    error:
        kind === 'differs'
            ? `The payment setup is not confirmed: what was saved does not match ${terms}. Say, in their language and in these words: "I couldn't confirm the payment setup. What was saved doesn't match ${terms}, so I didn't set it up again. Please open the page and check the price before you share it." Do not set it up again in this reply.`
            : `The payment setup is not confirmed: no clear answer came back, so it may already be set up on the page. Say, in their language and in these words: "No clear answer came back, so I can't confirm the payment setup. I didn't set it up again. Please open the page and check it." Do not set it up again in this reply.`,
});

/** The job as Orbit saved it (`job` of a write or a read-back), in canonical form; null when it is not whole. */
interface SavedPageJob {
    artifactId: string;
    connectionId: string;
    amountMinor: number;
    currency: string;
    exponent: number;
    amount: string;
    active: boolean;
    /** What Orbit holds as the job's description: a text, null for none, undefined when the answer carried no such field. */
    description?: string | null;
    /**
     * The page's link still shows an older published version than the one these terms were set on (Orbit's `waitsForPublish`): people who open
     * it by its link cannot pay until the owner publishes again. Only a real `true` counts; an Orbit that does not say it leaves it false.
     */
    waitsForPublish: boolean;
}
function savedJobOf(data: unknown): SavedPageJob | null {
    const job = (data as { job?: unknown } | null)?.job as Record<string, unknown> | null | undefined;
    if (!job || typeof job !== 'object') return null;
    const { artifactId, connectionId, amountMinor, currency, exponent, amount, active } = job;
    if (typeof artifactId !== 'string' || typeof connectionId !== 'string' || typeof currency !== 'string' || typeof amount !== 'string') return null;
    if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor < 0) return null;
    if (typeof exponent !== 'number' || ![0, 2, 3].includes(exponent) || typeof active !== 'boolean') return null;
    const description = typeof job.description === 'string' ? job.description : job.description === null ? null : undefined;
    const waitsForPublish = (data as { waitsForPublish?: unknown }).waitsForPublish === true;
    return { artifactId, connectionId, amountMinor, currency, exponent, amount, active, description, waitsForPublish };
}

/** What the owner asked for, in the smallest unit of a currency with `exponent` decimals ("4.5" and "4.500" KWD are both 4500); null for text that is not an amount that fits. */
export function minorUnitsOf(amount: string, exponent: number): number | null {
    const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(amount.trim());
    if (!match) return null;
    const fraction = match[2] ?? '';
    // A digit past the currency's decimals is an amount it cannot hold: never rounded
    if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) return null;
    const minor = Number(match[1]) * 10 ** exponent + Number((fraction + '0'.repeat(exponent)).slice(0, exponent) || '0');
    return Number.isSafeInteger(minor) ? minor : null;
}

/** The saved job is the one asked for: this page, this App's connection, the amount in minor units, the currency, and it is on. */
function savedMatches(job: SavedPageJob, asked: { artifact: string; connectionId: string; amount: string; currency: string; description?: string }): boolean {
    const wanted = minorUnitsOf(asked.amount, job.exponent);
    // A description that was asked for is part of what was set up: a job that holds another one (or the answer does not say) is not it
    if (asked.description && job.description !== asked.description) return false;
    return job.active && job.artifactId === asked.artifact && job.connectionId === asked.connectionId && job.currency.toUpperCase() === asked.currency.toUpperCase() && wanted !== null && job.amountMinor === wanted;
}

const FORM_FAILS = 'The form could not be opened just now. Say so in one plain sentence and offer to try again. Do not ask them for the key in the chat.';

/** Reads what Orbit has saved for a page, once, without writing; null when no clear answer came back. */
async function readSavedJob(context: KeyToolContext, app: KeyApp, artifact: string): Promise<{ job: SavedPageJob | null } | null> {
    try {
        const response = await axios.get(`${context.where.adminApiUrl}/api/bots/${encodeURIComponent(context.botId)}/key-apps/${encodeURIComponent(app.serverId)}/page-jobs`, {
            params: { artifactId: artifact },
            headers: { Authorization: `Bearer ${context.where.serviceToken}`, 'Cache-Control': 'no-store' },
            timeout: 15_000,
            validateStatus: () => true,
        });
        if (!response) return null;
        if (response.status === 200) return { job: savedJobOf(response.data) };
        // Orbit says there is none (this page, this App): that is an answer, and it is not what was asked for
        if (response.status === 404) return { job: null };
        return null;
    } catch (error) {
        console.warn('[KeyTools] The page job could not be read back:', error instanceof Error ? error.message : error);
        return null;
    }
}

async function post(context: KeyToolContext, path: string, body: unknown): Promise<{ status: number; data: unknown }> {
    const response = await axios.post(`${context.where.adminApiUrl}/api/bots/${encodeURIComponent(context.botId)}/${path}`, body, {
        headers: { Authorization: `Bearer ${context.where.serviceToken}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        timeout: 15_000,
        validateStatus: () => true,
    });
    return { status: response.status, data: response.data };
}

/** Runs one of the two tools. Never throws: the model is told in plain words what happened. */
export async function runKeyTool(name: string, args: Record<string, unknown>, context: KeyToolContext): Promise<Record<string, unknown>> {
    if (!context.where.adminApiUrl || !context.where.serviceToken) return { error: "That can't be done in this chat right now." };
    try {
        if (name === ASK_FOR_KEY_TOOL) return await askForKey(args, context);
        if (name === PAYMENT_TOOL) return await takePayments(args, context);
    } catch (error) {
        console.warn('[KeyTools] A key tool failed:', error instanceof Error ? error.message : error);
        return { error: name === ASK_FOR_KEY_TOOL ? FORM_FAILS : "I couldn't set that up just now. Say so in one plain sentence and offer to try again." };
    }
    return { error: 'Unknown tool.' };
}

async function askForKey(args: Record<string, unknown>, context: KeyToolContext): Promise<Record<string, unknown>> {
    const service = text(args.service, 60);
    const draft = args.draft && typeof args.draft === 'object' && !Array.isArray(args.draft) ? args.draft : undefined;
    const source = text(args.source, 255);
    if (!service && !(draft && source)) return { error: 'Give a service from your note, or a draft with the address of the docs you read it from.' };
    const sent = await post(context, 'app-key-forms', { requesterKey: context.userId, ...(service ? { service } : { draft, source }) });
    if (sent.status === 404) return { error: 'That form is only for the owner of this Brick, in their own chat.' };
    if (sent.status === 400) {
        const body = sent.data as { error?: unknown; issues?: unknown } | null;
        return { error: `That setup is not valid: ${text(body?.error, 200)}. Fix it from the docs and call this again.` };
    }
    const id = (sent.data as { id?: unknown } | null)?.id;
    if (sent.status >= 300 || typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return { error: FORM_FAILS };
    const label = text(service ? (context.apps.find((app) => app.short.toLowerCase() === service.toLowerCase())?.short ?? service) : (draft as { short?: unknown }).short, 30) || 'service';
    return {
        shown: true,
        note: `The form is ready. Tell them in one short sentence, and give them this link with its words in their language and its address exactly as written: [Add your ${label} key](${KEY_FORM_LINK}${id}). They type the key there, not here. Never ask for it in the chat.`,
    };
}

async function takePayments(args: Record<string, unknown>, context: KeyToolContext): Promise<Record<string, unknown>> {
    const wanted = text(args.app, 60).toLowerCase();
    const app = context.apps.find((one) => one.payments && one.enabled && (one.short.toLowerCase() === wanted || one.name.toLowerCase() === wanted));
    if (!app) return { error: 'They have no App that can take payments by that name. Lead them to add one with ask_for_key first.' };
    // A key that stopped working is said plainly, before a request that could only fail
    if (!app.working) return { error: `Their ${app.short} key may have stopped working. Nothing was set up. Tell them to open Apps and tap Replace key, then try again.` };
    const artifact = text(args.artifact, 100);
    if (!artifact) return { error: 'Say which page, by its artifact id.' };
    const amount = typeof args.amount === 'number' ? String(args.amount) : text(args.amount, 30);
    // Whatever was written is checked whole: cut to three letters, "USDT" would become a different money, and Orbit could not tell
    const currency = typeof args.currency === 'string' ? args.currency.trim() : '';
    if (!/^[A-Za-z]{3}$/.test(currency)) return { error: 'The currency must be a three-letter code, like USD. Nothing was set up. Ask which one they mean.' };
    const description = text(args.description, 200);
    const asked = { artifact, connectionId: app.connectionId, amount, currency, ...(description ? { description } : {}) };
    const terms = `${amount} ${currency.toUpperCase()}`;
    const done = (job: SavedPageJob): Record<string, unknown> => ({
        done: true,
        amount: `${job.amount} ${job.currency}`,
        ...(job.waitsForPublish ? { waitsForPublish: true } : {}),
        note: job.waitsForPublish
            ? // The terms are on a version the link does not show yet: visitors are refused until the owner publishes (Orbit charges nothing meanwhile)
              `The page will take ${job.amount} ${job.currency} through ${app.short} once they publish this version: what was saved matches what they asked for, but the page's link still shows an older published version, and people who open it by its link can't pay until they publish. Say so in their language, like "Done. The Join button takes 4.500 KWD once you publish this version. Until then, people who open the link can't pay." (name the button or page as they know it). They publish with the Publish button above the page or in Share. Make sure the page asks for a checkout the way the tool says. A test key makes test payments only.`
            : `The page now takes ${job.amount} ${job.currency} through ${app.short}: what was saved matches what they asked for. Say so in their language, like "Done. The Join button now takes 4.500 KWD." (name the button or page as they know it). Make sure the page asks for a checkout the way the tool says, and tell the person it needs to be shared with anyone with the link for visitors to pay. A test key makes test payments only.`,
    });
    let sent: { status: number; data: unknown } | null = null;
    try {
        sent = await post(context, `key-apps/${encodeURIComponent(app.serverId)}/page-jobs`, {
            requesterKey: context.userId,
            artifactId: artifact,
            amount,
            currency,
            ...(description ? { description } : {}),
        });
    } catch (error) {
        // The request may have reached Orbit: an unknown outcome is read back once, never written again
        console.warn('[KeyTools] The page job request got no answer:', error instanceof Error ? error.message : error);
    }
    if (sent) {
        const body = (sent.data ?? {}) as { error?: unknown };
        // Only a whole saved job that is what was asked for is "done": what Orbit said is compared with what the owner asked, not trusted as a word
        const saved = sent.status === 200 ? savedJobOf(sent.data) : null;
        if (saved && savedMatches(saved, asked)) return done(saved);
        // Answers that say plainly that nothing was set up
        if (sent.status === 404) return { error: 'That is not a page of theirs. Check the artifact id.' };
        if (sent.status === 403) return { error: 'Only the owner can set up a payment, in their own chat.' };
        if (sent.status === 400) return { error: `${text(body.error, 200) || 'Those terms were not accepted.'} Nothing was set up.` };
    }
    // Anything else (no answer, a server error, an answer that is not whole, or a saved job that is not what was asked for) does not say what is on the
    // page: Orbit is asked once what it has saved, and if that is not what was asked for the setup is not confirmed. The write is never repeated.
    const read = await readSavedJob(context, app, artifact);
    if (read?.job && savedMatches(read.job, asked)) return done(read.job);
    return notConfirmed(read?.job || (sent?.status === 200 && savedJobOf(sent.data)) ? 'differs' : 'noanswer', terms);
}
