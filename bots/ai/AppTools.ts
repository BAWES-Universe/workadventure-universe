/**
 * Apps from a chat (game #2001): the one tool a person's own Brick has to lead them to connect an App.
 *
 * `offer_app` puts a small card under the Brick's answer. Two ways in: a job needs an App the person has not connected
 * ("What's on my calendar tomorrow?"), and the Brick says so in one line and offers "Connect your calendar?"; or the person
 * asks for one by name ("connect my Notion"), and the card says "Connect Notion?". The App has to be one on Orbit's list (a
 * super admin keeps it); the Brick never invents one. The sign-in happens on the App's own page, started by the card in
 * the game, so nothing about it runs here. "Not now" is kept by Orbit with the other Brick offers, per person and App, and
 * an App already offered once is not offered again, so the Brick helps another way. Orbit answers only for the Brick's owner.
 */
import type { AdminApiService, OfferableApp } from '../server/AdminApiService';
import type { AppOfferNote, BrickNote } from './BrickTools';

export const OFFER_APP_TOOL = 'offer_app';

export function isAppTool(name: string): boolean {
    return name === OFFER_APP_TOOL;
}

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: object } };

const ASK_MAX = 120;
const OTHER_LABEL_MAX = 40;
const OTHER_LINE_MAX = 80;
const SEARCH_MAX = 40;
/** The list in the Brick's note stops here: more than this is a menu, not a hint. */
const NOTE_APPS_MAX = 40;

export function appToolDefinitions(): ToolDefinition[] {
    return [
        {
            type: 'function',
            function: {
                name: OFFER_APP_TOOL,
                description:
                    'Offer to connect one of the person\'s Apps, on a small card under your answer. Use it in two cases. (1) They ask for something that needs an App they have not connected ' +
                    '("what\'s on my calendar tomorrow?" with no calendar connected): say in one short sentence that you can\'t see it yet and that connecting takes one sign-in, then call this with asked false. ' +
                    '(2) They ask you to connect an App by name ("connect my Notion"): say in one short sentence that it takes one sign-in on the App\'s own page, then call this with asked true. ' +
                    'The App must be one of the Apps listed in your "Apps" note: use its key exactly. Never offer an App that is not listed, never offer one you may already use, and at most one in a reply. ' +
                    'Never mention the card in your words, the card says it. If they said no to an App before, do not offer it again on your own, and help another way; if they later ask for it by name, offer it with asked true.',
                parameters: {
                    type: 'object',
                    properties: {
                        app: { type: 'string', description: 'The key of the App, exactly as listed in your "Apps" note.' },
                        asked: { type: 'boolean', description: 'True only when they asked you to connect this App by name. False when you are offering it because a job needs it.' },
                        ask: {
                            type: 'string',
                            description: 'The card\'s question, in their language, naming the kind of thing and not the brand: "Connect your calendar?". Leave out when asked is true.',
                        },
                        other_label: {
                            type: 'string',
                            description: 'Only when the kind of App has others on the list: the second choice, in their language, like "Another calendar". Leave out otherwise.',
                        },
                        other_line: { type: 'string', description: 'With other_label: the line under it, like "Outlook, iCloud and more".' },
                        other_search: { type: 'string', description: 'With other_label: one or two words to search the list of Apps for, like "calendar".' },
                    },
                    required: ['app', 'asked'],
                },
            },
        },
    ];
}

/**
 * What the Brick is told about Apps with its instructions: which ones it may offer (by key, with what each does), and the ones
 * already offered so it never offers them again. Empty when there is nothing to offer.
 */
export function appsNote(apps: OfferableApp[] | null, declinedTopics: string[]): string {
    if (!apps) return '';
    const offerable = apps.filter((app) => !app.usable);
    if (offerable.length === 0) return '';
    const declined = new Set(declinedTopics.map(topicWords));
    const lines = offerable.slice(0, NOTE_APPS_MAX).map((app) => {
        const left = declined.has(topicWords(topicOf(app.key))) ? ' (already offered, they said not now: never offer it again on your own, help another way; if they ask for it by name, offer it with asked true)' : '';
        const here = app.connected ? ' (they connected it, you may not use it yet)' : '';
        return `- ${app.key}: ${app.name}${app.blurb ? `, ${app.blurb}` : ''}${here}${left}`;
    });
    return [
        'Apps: you can use Apps the person connected. When a job needs an App they have not connected, or they ask you to connect one, offer it with offer_app. These are the Apps you may offer:',
        ...lines,
        'Call them Apps, never tools or connectors.',
    ].join('\n');
}

/** The topic Orbit keeps "Not now" under for one App; Orbit lower-cases it and drops anything but letters and digits. */
export function topicOf(appKey: string): string {
    return `app ${appKey.replace(/-/g, ' ')}`;
}

/** Two topics are the same when their words match, whatever the case or punctuation. */
function topicWords(topic: string): string {
    return topic.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export interface AppToolContext {
    admin: Pick<AdminApiService, 'appsOfferableFor' | 'brickOffersFor'>;
    /** The Brick that asks, and the person it belongs to (their game uuid). */
    botId: string;
    userId: string;
    /** Where this turn's notes for the game wait until the reply goes out. */
    notes: BrickNote[];
}

/** Runs offer_app. Never throws: the model is told in plain words what happened. */
export async function runAppTool(args: Record<string, unknown>, context: AppToolContext): Promise<Record<string, unknown>> {
    const key = text(args.app, 80).toLowerCase();
    const asked = args.asked === true;
    if (!key) return { shown: false, error: 'Say which App, by its key from your Apps note.' };
    if (context.notes.some((note) => note.kind === 'app')) return { shown: false, note: 'One App offer in a reply is enough. Do not mention it.' };

    let apps: OfferableApp[];
    let offeredBefore: string[] = [];
    try {
        apps = await context.admin.appsOfferableFor(context.botId, context.userId);
        if (!asked) offeredBefore = (await context.admin.brickOffersFor(context.botId, context.userId)).topics;
    } catch (error) {
        console.warn('[AppTools] Could not read the Apps to offer:', error instanceof Error ? error.message : error);
        return { shown: false, note: 'Apps cannot be connected from here right now. Help another way and do not mention it.' };
    }
    const app = apps.find((one) => one.key.toLowerCase() === key);
    if (!app) return { shown: false, error: 'That is not one of the Apps you may offer. Use a key from your Apps note, or help another way.' };
    if (app.usable) return { shown: false, note: `${app.name} is already connected and you may use it. Use it now; do not offer it.` };

    const topic = topicOf(app.key);
    if (!asked && offeredBefore.some((one) => topicWords(one) === topicWords(topic))) {
        return { shown: false, note: `They already said not now to ${app.name}. Never offer it again. Help another way and do not mention it.` };
    }
    const ask = asked ? '' : text(args.ask, ASK_MAX);
    const label = text(args.other_label, OTHER_LABEL_MAX);
    const search = text(args.other_search, SEARCH_MAX);
    const note: AppOfferNote = {
        kind: 'app',
        topic,
        app: app.key,
        name: app.name,
        // Connected and working, only not used by this Brick yet: "Let it use", never a second sign-in
        state: app.connectionId && app.connected ? 'connected' : 'new',
        connectionId: app.connectionId,
        ask,
        asked,
        other: !asked && label && search ? { label, line: text(args.other_line, OTHER_LINE_MAX), search } : null,
    };
    // Two calls of one reply run side by side and both waited on Orbit: the first check is only an early exit, this one has no await before the push
    if (context.notes.some((one) => one.kind === 'app')) return { shown: false, note: 'One App offer in a reply is enough. Do not mention it.' };
    context.notes.push(note);
    return { shown: true, note: 'The card goes under your answer. Do not mention it in your words.' };
}
