/**
 * The check right before a Brick or bot uses an App that sits on a connection (game #2001, Orbit `POST
 * /api/bots/:id/mcp-servers/:serverId/use`): a person's own App, one lent to a universe, or a universe's own App.
 *
 * It is asked on EVERY use, not once per chat, so an App taken back, a lend whose uses ran out or a switch turned off stops
 * it at once. Orbit decides; this only carries the question and says what the bot may be told. Orbit needs a `callId` on a
 * lent or team App (the bot server's id for this call, so "uses a day" counts a retry once) and a `heading` on a lent one
 * (what the lender allowed is held at every use). Without them Orbit answers `incomplete`: such a use never runs.
 *
 * An App is never refused to the person: the bot carries on without it and says so in plain words. `paused` is the team pausing Apps
 * (Orbit, Universe AI > Pause): the same kind line, until they resume it.
 */
import axios from 'axios';
import type { ToolHeading } from './ToolCatalog';

/**
 * Why Orbit did not allow a use. `unavailable` is ours: Orbit could not be asked, so nothing is let through. `not_shared`, `busy`
 * and `already_asked` are for someone else asking for a job its owner shared (#2006).
 */
export type AppUseRefusal =
    | 'gone'
    | 'off'
    | 'not_owner'
    | 'not_lent'
    | 'limit_reached'
    | 'incomplete'
    | 'paused'
    | 'unavailable'
    | 'not_shared'
    | 'busy'
    | 'already_asked';

/** `reason` is set whenever `allowed` is false. */
export interface AppUseAnswer {
    allowed: boolean;
    reason?: AppUseRefusal;
    /**
     * Someone else asking for a job its owner shared (#2006): which fields of the answer may be given back (null: the whole answer).
     * Set only on an allowed ask like that. The try is on Orbit's books, so what it came to is told back (see `settleAppUse`).
     */
    shared?: { returns: string[] | null };
    /** For `limit_reached`: when the uses of the day are back. */
    resetsAt?: string;
    /** For `already_asked`: what the first try came to (`running`, `done`, `unknown`, `refunded`). */
    earlier?: string;
    /** For an allowed ask that took the day's last use: who to tell once, and what to tell (see `OwnerNote`). */
    ownerNote?: OwnerNote;
}

/** Orbit says, once a day, that the day's uses for other people ran out: the owner is told in their own chat with the Brick. */
export interface OwnerNote {
    /** The owner's chat id, for the direct chat the two share. */
    matrixUserId: string;
    appName: string;
    botName: string;
    limit: number;
    /** The app, for the "Change the limit" link. */
    connectionId: string;
    /** The day (UTC, YYYY-MM-DD) whose uses ran out, as Orbit decided it: the same note of the same day is one message to Matrix, even if it is told just after midnight. */
    day?: string;
}

/** The four headings as Orbit names them. */
export type OrbitHeading = 'lookUp' | 'make' | 'change' | 'deleteSend';

const ORBIT_HEADING: Record<ToolHeading, OrbitHeading> = {
    looksUp: 'lookUp',
    makesNew: 'make',
    changesThings: 'change',
    deletesOrSends: 'deleteSend',
};

export function orbitHeadingOf(heading: ToolHeading | undefined): OrbitHeading | undefined {
    return heading ? ORBIT_HEADING[heading] : undefined;
}

export interface AppUseRequest {
    /** Who is asking, as the bot server knows them (their WorkAdventure uuid). A guest has none. */
    requesterKey?: string;
    /** The Brick works for its owner on its own (a goal they set): no one else is asking. */
    forOwner?: boolean;
    /** This call's id: the same call asked again counts once. */
    callId: string;
    /** What the tool falls under. Orbit refuses a lent App without it. */
    heading?: ToolHeading;
    /** The job asked for and the names of the inputs this ask carries (never their values): needed when someone else asks (#2006). */
    tool?: string;
    argumentNames?: string[];
}

/** Asks Orbit. Never throws: when Orbit can't be asked the answer is `unavailable`. */
export type AppUseCheck = (botId: string, serverId: string, request: AppUseRequest) => Promise<AppUseAnswer>;

const REASONS: readonly AppUseRefusal[] = ['gone', 'off', 'not_owner', 'not_lent', 'limit_reached', 'incomplete', 'paused', 'not_shared', 'busy', 'already_asked'];
const TIMEOUT_MS = 8_000;

/** The body Orbit takes: only what it was given, so nothing is sent as "undefined". */
export function useBody(request: AppUseRequest): Record<string, unknown> {
    const heading = orbitHeadingOf(request.heading);
    return {
        callId: request.callId,
        ...(request.requesterKey ? { requesterKey: request.requesterKey } : {}),
        ...(request.forOwner === true ? { forOwner: true } : {}),
        ...(heading ? { heading } : {}),
        ...(request.tool ? { tool: request.tool } : {}),
        ...(request.argumentNames ? { argumentNames: request.argumentNames } : {}),
    };
}

const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/**
 * What Orbit says about a shared ask: the fields that may come back, or null for the whole answer. It must say so on purpose: an
 * answer with no `returns` at all is not read as "everything" (undefined: the ask is not run for someone else). A `returns` that is not a
 * list of names is read as "nothing may come back".
 */
function sharedOf(value: unknown): { returns: string[] | null } | undefined {
    if (!value || typeof value !== 'object' || !('returns' in value)) return undefined;
    const returns = (value as { returns?: unknown }).returns;
    if (returns === null) return { returns: null };
    if (returns === undefined) return undefined;
    return { returns: isNames(returns) ? returns : [] };
}

function ownerNoteOf(value: unknown): OwnerNote | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const note = value as Record<string, unknown>;
    if (typeof note.matrixUserId !== 'string' || typeof note.appName !== 'string' || typeof note.botName !== 'string' || typeof note.connectionId !== 'string') return undefined;
    if (typeof note.limit !== 'number' || !Number.isFinite(note.limit)) return undefined;
    const day = typeof note.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(note.day) ? note.day : undefined;
    return { matrixUserId: note.matrixUserId, appName: note.appName, botName: note.botName, limit: note.limit, connectionId: note.connectionId, ...(day ? { day } : {}) };
}

/** The question to Orbit, with BOT_SERVICE_TOKEN. A 404 is an answer (this bot has no such App: refused), a failure is `unavailable`. */
export function askOrbitAboutAppUse(side: () => { adminApiUrl: string; serviceToken: string } | null): AppUseCheck {
    return async (botId, serverId, request) => {
        const where = side();
        if (!where || !where.serviceToken) return { allowed: false, reason: 'unavailable' };
        try {
            const response = await axios.post(
                `${where.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/mcp-servers/${encodeURIComponent(serverId)}/use`,
                useBody(request),
                {
                    headers: { Authorization: `Bearer ${where.serviceToken}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                    timeout: TIMEOUT_MS,
                    validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
                }
            );
            if (response.status === 404) return { allowed: false, reason: 'gone' };
            if (response.data?.allowed === true) {
                const shared = sharedOf(response.data?.shared);
                const note = ownerNoteOf(response.data?.ownerNote);
                return { allowed: true, ...(shared ? { shared } : {}), ...(note ? { ownerNote: note } : {}) };
            }
            const reason = response.data?.reason;
            const resetsAt = typeof response.data?.resetsAt === 'string' ? response.data.resetsAt : undefined;
            const earlier = typeof response.data?.earlier === 'string' ? response.data.earlier : undefined;
            const note = ownerNoteOf(response.data?.ownerNote);
            return {
                allowed: false,
                reason: REASONS.includes(reason) ? reason : 'gone',
                ...(resetsAt ? { resetsAt } : {}),
                ...(earlier ? { earlier } : {}),
                ...(note ? { ownerNote: note } : {}),
            };
        } catch (error) {
            console.warn('[AppUse] Orbit could not be asked about an App:', error instanceof Error ? error.message : error);
            return { allowed: false, reason: 'unavailable' };
        }
    };
}

/** Who the line is about, when the use was someone else asking for a job its owner shared (#2006). */
export interface AppUseContext {
    /** The App's name as its owner knows it. */
    app?: string;
    /** The owner's name, when the Brick knows it. */
    owner?: string | null;
}

/**
 * What the bot is told when an App was not used, in plain words. Nothing about what it holds, no prices; the bot carries on
 * without it and tells the person. For someone else asking, the line names the App and its owner the way the Brick can say it, and
 * says only what the owner shared can be asked, never the way round it.
 */
export function appNotUsedLine(reason: AppUseRefusal, context: AppUseContext = {}): string {
    const tail = ' This was not done with that App. Carry on without it if you can, and tell the person in one plain line.';
    const sharedApp = context.app ? `${context.owner ? `${context.owner}'s ` : ''}${context.app}` : 'That App';
    switch (reason) {
        case 'limit_reached':
            return context.app
                ? `${sharedApp} has reached the limit set for today, so it can't be used again until tomorrow. This was not done. Say so kindly in one line, and say what you can still do without it.`
                : `That App has reached its uses for today here.${tail}`;
        case 'not_lent':
            return `That App was not shared for this kind of thing here.${tail}`;
        case 'not_shared':
            return `${sharedApp} was not shared for that, so it can't be done for anyone else. This was not done. Say so kindly in one line, and say what you can still do.`;
        case 'busy':
            return `${sharedApp} is busy with other requests right now. This was not done. Say so kindly in one line and suggest asking again in a little while.`;
        case 'already_asked':
            return `That was already asked once, and it will not be run again. Do not ask again. Tell the person in one plain line.`;
        case 'not_owner':
            return `That App is only for its owner, so it cannot be used for this request.${tail}`;
        case 'off':
            return `That App is switched off for this bot.${tail}`;
        case 'paused':
            // The team paused Apps for a while: nothing is lost, and it is back by itself when they resume it
            return `Apps are paused for a while.${tail}`;
        case 'unavailable':
            return "I can't check that App right now. Try again soon. This was not done.";
        default:
            return `That App can't be used here any more.${tail}`;
    }
}

/**
 * What an `already_asked` answer means for the person: the same call is never run twice, and what the first try came to decides the words.
 * `earlier` is Orbit's word for it (`running`, `done`, `unknown`, `refunded`).
 */
export function alreadyAskedLine(earlier: string | undefined, context: AppUseContext = {}): string {
    const app = context.app ? `${context.owner ? `${context.owner}'s ` : ''}${context.app}` : 'That App';
    switch (earlier) {
        case 'unknown':
            return `${app} was asked for this already and no answer came back, so it may have worked. It will not be run again. Tell the person in one line that it may have worked and to check before asking again.`;
        case 'running':
            return `${app} is still working on this. It will not be run again. Tell the person in one line that it is on its way.`;
        case 'done':
            return `${app} already did this once, and it will not be run again. Tell the person in one line.`;
        case 'refunded':
            return `${app} could not do this the first time, and nothing was used up. This same request will not be run again; if the person still wants it, they can ask again as a new request.`;
        default:
            // Orbit did not say what the first try came to: nothing says it failed, so it may have worked
            return `${app} was asked for this already and what came of it is not known, so it may have worked. It will not be run again. Tell the person in one line that it may have worked and to check before asking again.`;
    }
}

/** What a shared try came to, as Orbit's settle route takes it. */
export type SettleOutcome = 'done' | 'failed' | 'unknown';

/**
 * What a call's result says about a shared try. Only a call that PROVED it made nothing (it never reached the App: `not_sent`) or that
 * the App itself said failed gives the use back. A timeout, a lost or empty answer and anything not understood is `unknown`: it stays
 * counted and is never run again, so nothing is given back by guessing (#2006, check 31).
 */
export function settleOutcomeOf(result: unknown): SettleOutcome {
    const outcome = result && typeof result === 'object' && !Array.isArray(result) ? (result as { outcome?: unknown; error?: unknown }) : undefined;
    if (!outcome || outcome.error === undefined) return 'done';
    if (outcome.outcome === 'not_sent' || outcome.outcome === 'failed') return 'failed';
    return 'unknown';
}

/** Where a shared try is settled: Orbit, with BOT_SERVICE_TOKEN. Never throws; false when Orbit could not be told (the try stays counted, which is the safe side). */
export type AppUseSettle = (botId: string, serverId: string, callId: string, outcome: SettleOutcome) => Promise<boolean>;

export function settleWithOrbit(side: () => { adminApiUrl: string; serviceToken: string } | null): AppUseSettle {
    return async (botId, serverId, callId, outcome) => {
        const where = side();
        if (!where || !where.serviceToken) return false;
        try {
            await axios.post(
                `${where.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/mcp-servers/${encodeURIComponent(serverId)}/use/settle`,
                { callId, outcome },
                {
                    headers: { Authorization: `Bearer ${where.serviceToken}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                    timeout: TIMEOUT_MS,
                    // A try that already ended the other way (409) or is not found is settled: asking again changes nothing
                    validateStatus: (status) => (status >= 200 && status < 300) || status === 404 || status === 409,
                }
            );
            return true;
        } catch (error) {
            console.warn('[AppUse] Orbit could not be told what a shared try came to:', error instanceof Error ? error.message : error);
            return false;
        }
    };
}

/** What someone else is told when a shared job did not work and the App said why in its own words. */
export const SHARED_FAILED_LINE = "That didn't work just now.";

/**
 * A failure as someone else may see it. A try that never left or has no answer is told in the bot's own fixed words, with its hint; a
 * failure the App worded itself (an account, an email, a file name can be in it) is replaced by one plain line. The kind of failure stays,
 * so the Brick still knows whether to try again.
 */
function forVisitor(failed: Record<string, unknown>): Record<string, unknown> {
    const own = failed.outcome === 'not_sent' || failed.outcome === 'uncertain';
    return {
        error: own && typeof failed.error === 'string' ? failed.error : SHARED_FAILED_LINE,
        ...(typeof failed.outcome === 'string' ? { outcome: failed.outcome } : {}),
        ...(own && typeof failed.hint === 'string' ? { hint: failed.hint } : {}),
    };
}

/**
 * Holds what comes back to the fields the owner picked. `returns: null` is the whole answer (the App does not say what it gives back). A
 * text answer that is not JSON cannot be held to named fields, so it is not given; neither is a file or a picture. Never throws.
 */
export function narrowToReturns(result: unknown, returns: string[] | null): unknown {
    // An error reaches someone else only in the bot's own words: the App's own words can name the owner's account
    if (result && typeof result === 'object' && !Array.isArray(result) && 'error' in (result as object)) return forVisitor(result as Record<string, unknown>);
    if (returns === null) return result;
    const keep = new Set(returns);
    const narrow = (value: unknown): unknown => {
        // A bare value in a list (a word, a number) belongs to no field, so no field the owner picked lets it through
        if (Array.isArray(value)) return value.filter((one) => one !== null && typeof one === 'object').map(narrow);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([name]) => keep.has(name)));
        return value;
    };
    if (Array.isArray(result)) {
        const items: Array<{ type: 'text'; text: string }> = [];
        for (const item of result as Array<{ type?: unknown; text?: unknown }>) {
            if (item?.type !== 'text' || typeof item.text !== 'string') continue;
            try {
                const parsed = JSON.parse(item.text);
                // A bare value (a number, a word) has no fields to hold it to
                if (parsed === null || typeof parsed !== 'object') continue;
                items.push({ type: 'text', text: JSON.stringify(narrow(parsed)) });
            } catch {
                // Not JSON: withheld
            }
        }
        // An App that wrote prose beside its data gave its fields in structuredContent: with no text item holding them, those are held to the picked fields
        const structured = structuredOf(result);
        if (items.length === 0 && structured !== undefined) items.push({ type: 'text', text: JSON.stringify(narrow(structured)) });
        return items;
    }
    if (result && typeof result === 'object') return narrow(result);
    return typeof result === 'string' ? [] : result;
}

/** The data an App gave in `structuredContent` beside its content, kept by the connector out of the content (see `withStructured`). Objects and lists only. */
const STRUCTURED = Symbol.for('universe.structuredContent');
export function withStructured<T extends unknown[]>(content: T, structured: unknown): T {
    if (structured !== null && typeof structured === 'object') Object.defineProperty(content, STRUCTURED, { value: structured, enumerable: false });
    return content;
}
function structuredOf(content: unknown[]): unknown {
    return (content as unknown as Record<symbol, unknown>)[STRUCTURED];
}

/** The owner's one line when today's uses for other people ran out, in the Brick's own voice, with the way to the limit. */
export function ownerNoteText(note: Pick<OwnerNote, 'appName' | 'limit' | 'connectionId'>): string {
    return `Heads up: your ${note.appName} has been used ${note.limit} times through me today, the most you allow for everyone. It opens again tomorrow. [Change the limit](#apps=${note.connectionId})`;
}

/** When a note to the owner that was not told for sure is told again. */
export const OWNER_NOTE_RETRY_MS: readonly number[] = [5_000, 30_000, 120_000];

/**
 * Says the day's note in the owner's own chat with the Brick. The transaction id is made from the day Orbit says ran out, so the same
 * note is one message to Matrix (also when told again, or just after midnight) and the next day's is another. A try that was not told for
 * sure (Matrix or Orbit could not be reached) is made again a few times, with the same id. "No chat" and "not allowed" are certain: there is
 * nobody to tell. Never throws.
 */
export async function sayOwnerNote(
    speak: (matrixUserId: string, text: string, transactionId: string) => Promise<{ ok: boolean; reason?: string }>,
    botId: string,
    note: OwnerNote,
    waitsMs: readonly number[] = OWNER_NOTE_RETRY_MS,
    wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.())
): Promise<void> {
    const day = note.day ?? new Date().toISOString().slice(0, 10);
    const transactionId = `app-share-limit:${botId}:${note.connectionId}:${day}`;
    for (const waitMs of [0, ...waitsMs]) {
        if (waitMs > 0) await wait(waitMs);
        try {
            const said = await speak(note.matrixUserId, ownerNoteText(note), transactionId);
            if (said.ok || said.reason !== 'unsure') return;
        } catch (error) {
            console.warn('[AppUse] Could not tell the owner about the limit:', error instanceof Error ? error.message : error);
        }
    }
}
