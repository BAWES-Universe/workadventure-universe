/**
 * A tool server that refused the bot's sign-in, or did not answer (game #1819, mock approved 5 Nov 2026).
 *
 * The bot server sees it the moment a reply needs the server. This keeps what it saw, so that:
 *   - the server is not called again on every reply (a refused sign-in is tried again at most every 30 minutes, a server
 *     that did not answer after 5 minutes; both are settings, with these as the recommended defaults),
 *   - Orbit is told once when the state changes (it shows "Sign-in expired", and sends the notice and the Reconnect),
 *   - the model gets a short note saying which tool is down, and a manager gets the Reconnect card.
 *
 * Pure apart from the clock and the one Orbit call.
 */

import axios from 'axios';
import { createHash } from 'crypto';

export type ToolIssueState = 'expired' | 'no-answer';
export type ToolIssueKind = 'oauth' | 'key' | 'none';

/** One tool server that is not working for the bot right now. */
export interface ToolIssue {
    serverId: string;
    name: string;
    state: ToolIssueState;
    /** When the bot server first saw it (ISO time) */
    since: string;
    /** How the sign-in is made again: the provider's window (oauth), a pasted key or token (key) */
    kind: ToolIssueKind;
    /** The App's connection when the server is one (#2001): its own Reconnect, the one the Apps page has, signs it in again. */
    connectionId?: string;
}

export interface ToolSignInSettings {
    /** How long a refused sign-in waits before the bot server tries the server again */
    recheckMs: number;
    /** How long a server that did not answer waits before it is tried again */
    noAnswerRetryMs: number;
}

export const DEFAULT_RECHECK_MINUTES = 30;
export const DEFAULT_NO_ANSWER_MINUTES = 5;

function minutesFrom(raw: string | undefined, fallback: number): number {
    const value = Number(raw);
    return Number.isFinite(value) && value >= 1 ? Math.min(value, 24 * 60) : fallback;
}

/** BOT_TOOL_SIGNIN_RECHECK_MINUTES (30) and BOT_TOOL_NOANSWER_RETRY_MINUTES (5) */
export function toolSignInSettings(env: NodeJS.ProcessEnv = process.env): ToolSignInSettings {
    return {
        recheckMs: minutesFrom(env.BOT_TOOL_SIGNIN_RECHECK_MINUTES, DEFAULT_RECHECK_MINUTES) * 60_000,
        noAnswerRetryMs: minutesFrom(env.BOT_TOOL_NOANSWER_RETRY_MINUTES, DEFAULT_NO_ANSWER_MINUTES) * 60_000,
    };
}

export function issueKind(authType: string): ToolIssueKind {
    if (authType === 'oauth') return 'oauth';
    return authType === 'bearer' || authType === 'api-key' ? 'key' : 'none';
}

/**
 * How a server's sign-in is made again. An App of a person's (a connection) is always signed in again through its own page,
 * whatever it stores: a ready-made App stores no sign-in method, and GitHub has its own window.
 */
function kindOf(server: { authType: string; connectionId?: string | null; readyMade?: boolean }): ToolIssueKind {
    if (server.connectionId && (server.readyMade === true || server.authType === 'oauth')) return 'oauth';
    return issueKind(server.authType);
}

/** A refusal by the tool server's own HTTP status: the sign-in is not accepted (not a server that is down). */
export function isSignInRefusal(status: number | undefined): status is 401 | 403 {
    return status === 401 || status === 403;
}

/** A failure that says the server did not answer: no status at all (timeout, reset), or the server's own 5xx. */
export function isNoAnswer(status: number | undefined): boolean {
    return status === undefined || status >= 500;
}

/** Which credentials a state was seen with, so a new sign-in or a new key is tried at once. Never leaves the process. */
export function credentialsKey(server: { authType: string; authConfig?: string; headers?: Record<string, string> }): string {
    return createHash('sha256')
        .update(JSON.stringify([server.authType, server.authConfig ?? '', server.headers ?? {}]))
        .digest('hex')
        .slice(0, 16);
}

interface Entry {
    name: string;
    kind: ToolIssueKind;
    state: ToolIssueState;
    sinceMs: number;
    checkedMs: number;
    credentials: string;
    /** Orbit has this state */
    reported: boolean;
    /** Which observation of the server this is: a report to Orbit only counts for the observation it was sent for */
    generation: number;
    /** How long to leave the server alone after it was checked, when that is not the usual wait for its state */
    waitMs?: number;
    connectionId?: string;
}

export interface SeenServer {
    id: string;
    name: string;
    authType: string;
    authConfig?: string;
    headers?: Record<string, string>;
    /** Set when the server is an App's connection (#2001) */
    connectionId?: string | null;
    readyMade?: boolean;
    /** What Orbit itself holds, from its server list: lets a restarted bot server carry on from it */
    signInLostAt?: string | null;
    noAnswerAt?: string | null;
}

/** What the bot server knows about its tool servers, by bot and server. */
export class ToolHealth {
    private readonly entries = new Map<string, Entry>();
    private generations = 0;
    /** Reports to Orbit that are still on their way, by bot and server */
    private readonly pending = new Map<string, Promise<unknown>>();

    constructor(
        private readonly now: () => number = () => Date.now(),
        private readonly settings: () => ToolSignInSettings = toolSignInSettings
    ) {}

    private key(botId: string, serverId: string): string {
        return `${botId}:${serverId}`;
    }

    /**
     * Before a server is called: whether to leave it alone now. A server whose credentials changed since it failed is tried
     * at once; otherwise it waits out its time. A server Orbit marks but this process never saw (after a restart) is
     * adopted, and tried at once.
     */
    shouldSkip(botId: string, server: SeenServer): boolean {
        const key = this.key(botId, server.id);
        let entry = this.entries.get(key);
        if (!entry) {
            const lost = Date.parse(server.signInLostAt ?? '');
            const quiet = Date.parse(server.noAnswerAt ?? '');
            if (Number.isNaN(lost) && Number.isNaN(quiet)) return false;
            entry = {
                name: server.name,
                kind: kindOf(server),
                ...(server.connectionId ? { connectionId: server.connectionId } : {}),
                state: Number.isNaN(lost) ? 'no-answer' : 'expired',
                sinceMs: Number.isNaN(lost) ? quiet : lost,
                checkedMs: 0,
                credentials: credentialsKey(server),
                reported: true,
                generation: ++this.generations,
            };
            this.entries.set(key, entry);
            return false;
        }
        entry.name = server.name;
        const credentials = credentialsKey(server);
        if (credentials !== entry.credentials) {
            // Reconnected, or a new key: try it now. The mark stays until the server answers.
            entry.credentials = credentials;
            entry.checkedMs = 0;
            // Orbit may have cleared its mark with the new sign-in: if it is refused again, Orbit is told again
            entry.reported = false;
            entry.waitMs = undefined;
            entry.generation = ++this.generations;
            return false;
        }
        // Orbit held this mark and no longer does: the sign-in was made again where this process cannot see it in the
        // credentials (an App's connection, signed in again on the Apps page, keeps the same ones). Tried at once; if it is
        // refused again, Orbit is told again, so an unchanged server is not tried at every reply.
        const orbitHolds = entry.state === 'expired' ? server.signInLostAt : server.noAnswerAt;
        if (entry.reported && !orbitHolds) {
            entry.checkedMs = 0;
            entry.waitMs = undefined;
            entry.reported = false;
            entry.generation = ++this.generations;
            return false;
        }
        const wait = entry.waitMs ?? (entry.state === 'expired' ? this.settings().recheckMs : this.settings().noAnswerRetryMs);
        return this.now() - entry.checkedMs < wait;
    }

    /** The server was tried and failed this way. True when the state is new (Orbit is told once per change). */
    fail(botId: string, server: SeenServer, state: ToolIssueState): boolean {
        const key = this.key(botId, server.id);
        const entry = this.entries.get(key);
        const now = this.now();
        if (entry && entry.state === state) {
            entry.checkedMs = now;
            entry.waitMs = undefined;
            entry.credentials = credentialsKey(server);
            return !entry.reported;
        }
        // A no-answer after a refusal is still a refusal we have not seen cleared: keep the refusal
        if (entry && entry.state === 'expired' && state === 'no-answer') {
            // A sign-in not tried yet (new, or a mark taken from Orbit) that met a server not answering is tried again
            // after the short wait, not the long one
            entry.waitMs = entry.checkedMs === 0 ? this.settings().noAnswerRetryMs : undefined;
            entry.checkedMs = now;
            return false;
        }
        this.entries.set(key, {
            name: server.name,
            kind: kindOf(server),
            ...(server.connectionId ? { connectionId: server.connectionId } : {}),
            state,
            sinceMs: now,
            checkedMs: now,
            credentials: credentialsKey(server),
            reported: false,
            generation: ++this.generations,
        });
        return true;
    }

    /** The server was tried again and failed in a way that says nothing new: its wait starts over, nothing else changes. */
    touch(botId: string, serverId: string): void {
        const entry = this.entries.get(this.key(botId, serverId));
        if (entry) {
            entry.checkedMs = this.now();
            entry.waitMs = undefined;
        }
    }

    /** Whether Orbit has this server's state. */
    isReported(botId: string, serverId: string): boolean {
        return this.entries.get(this.key(botId, serverId))?.reported === true;
    }

    /** A report to Orbit is on its way. */
    track(botId: string, serverId: string, sent: Promise<unknown>): void {
        const key = this.key(botId, serverId);
        const done = sent.finally(() => {
            if (this.pending.get(key) === done) this.pending.delete(key);
        });
        this.pending.set(key, done);
    }

    /** Waits for the reports of one bot that are on their way, at most `maxMs`: a card is sent once Orbit has the state it shows. */
    async settled(botId: string, maxMs = 3000): Promise<void> {
        const waiting = [...this.pending].filter(([key]) => key.startsWith(`${botId}:`)).map(([, sent]) => sent);
        if (waiting.length === 0) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limit = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, maxMs);
        });
        await Promise.race([Promise.allSettled(waiting), limit]);
        if (timer) clearTimeout(timer);
    }

    /** Which observation of the server is held now: a report is sent for it, and counts only for it. */
    observation(botId: string, serverId: string): number | undefined {
        return this.entries.get(this.key(botId, serverId))?.generation;
    }

    /** Orbit has been told the state. Counts only when it is the observation the report was sent for. */
    reported(botId: string, serverId: string, observation?: number): void {
        const entry = this.entries.get(this.key(botId, serverId));
        if (entry && (observation === undefined || entry.generation === observation)) entry.reported = true;
    }

    /** The mark held now was made with other credentials than these: a read made with these is older than the mark. */
    isStale(botId: string, serverId: string, credentials: string): boolean {
        const entry = this.entries.get(this.key(botId, serverId));
        return entry !== undefined && entry.credentials !== credentials;
    }

    /** The server answered. True when it had a mark to clear (Orbit is told once). A read made with credentials older than the mark does not clear it. */
    ok(botId: string, serverId: string, credentials?: string): boolean {
        if (credentials !== undefined && this.isStale(botId, serverId, credentials)) return false;
        return this.entries.delete(this.key(botId, serverId));
    }

    /** The marks that are on now, for the servers of one bot. */
    issuesFor(botId: string, enabledServerIds: ReadonlySet<string>): ToolIssue[] {
        const out: ToolIssue[] = [];
        for (const [key, entry] of this.entries) {
            if (!key.startsWith(`${botId}:`)) continue;
            const serverId = key.slice(botId.length + 1);
            if (!enabledServerIds.has(serverId)) continue;
            out.push({
                serverId,
                name: entry.name,
                state: entry.state,
                since: new Date(entry.sinceMs).toISOString(),
                kind: entry.kind,
                ...(entry.connectionId ? { connectionId: entry.connectionId } : {}),
            });
        }
        return out.sort((a, b) => a.since.localeCompare(b.since) || a.name.localeCompare(b.name));
    }

    forgetBot(botId?: string): void {
        if (!botId) {
            this.entries.clear();
            return;
        }
        for (const key of [...this.entries.keys()]) if (key.startsWith(`${botId}:`)) this.entries.delete(key);
    }
}

/**
 * Tells Orbit a server's state moved: `PUT /api/bots/:id/mcp-servers/:serverId/sign-in` with the bot server's token. Resolves
 * true when Orbit has it. Never throws: Orbit keeping the old mark for a while is better than a failed reply.
 */
export async function reportToolState(
    orbit: { adminApiUrl: string; adminApiToken: string },
    botId: string,
    serverId: string,
    state: ToolIssueState | 'ok',
    at: string,
    status?: number
): Promise<boolean> {
    try {
        await axios.put(
            `${orbit.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/mcp-servers/${encodeURIComponent(serverId)}/sign-in`,
            { state, at, ...(status !== undefined && state === 'expired' ? { status } : {}) },
            {
                headers: { Authorization: `Bearer ${orbit.adminApiToken}`, 'Content-Type': 'application/json' },
                timeout: 15_000,
            }
        );
        return true;
    } catch (error) {
        console.warn(
            `[ToolSignIn] Orbit was not told that ${serverId} is ${state}:`,
            error instanceof Error ? error.message : error
        );
        return false;
    }
}

/** The names of tools as a sentence part: "Tavily", "Tavily and Attio", "Tavily, Attio and Linear". */
function names(list: readonly string[]): string {
    if (list.length <= 1) return list[0] ?? '';
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** A tool server's name is a person's text: one line, short. */
function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * What the model is told about tools that are down. It says so plainly, only when someone asks for something that needs
 * one, and answers with what it has. Empty when nothing is down.
 */
export function toolIssueNote(issues: readonly ToolIssue[]): string {
    if (issues.length === 0) return '';
    const expired = issues.filter((issue) => issue.state === 'expired').map((issue) => oneLine(issue.name));
    const quiet = issues.filter((issue) => issue.state === 'no-answer').map((issue) => oneLine(issue.name));
    const lines = ['Tools that are not working right now (you do not have their tools in this reply):'];
    if (expired.length > 0) {
        lines.push(
            `- ${names(expired)}: the sign-in expired. The people who manage you can sign in again.`
        );
    }
    if (quiet.length > 0) {
        lines.push(`- ${names(quiet)}: not answering right now. It is tried again in a few minutes.`);
    }
    lines.push(
        'Only when someone asks for something that needs one of them, say so plainly in a sentence or two: name the tool, ' +
            (expired.length > 0 && quiet.length > 0
                ? 'and say why as listed above (a tool whose sign-in expired: that, and that the people who manage you can sign in again; a tool that is not answering: that)'
                : expired.length > 0
                  ? 'say its sign-in expired and that the people who manage you can sign in again'
                  : 'say it is not answering') +
            ', then answer with what you can without it. Never pretend you used it. Otherwise do not bring it up.'
    );
    return lines.join('\n');
}
