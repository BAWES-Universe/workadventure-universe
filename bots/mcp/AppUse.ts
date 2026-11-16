/**
 * The check right before a Brick or bot uses an App that sits on a connection (game #2001, Orbit `POST
 * /api/bots/:id/mcp-servers/:serverId/use`): a person's own App, one lent to a universe, or a universe's own App.
 *
 * It is asked on EVERY use, not once per chat, so an App taken back, a lend whose uses ran out or a switch turned off stops
 * it at once. Orbit decides; this only carries the question and says what the bot may be told. Orbit needs a `callId` on a
 * lent or team App (the bot server's id for this call, so "uses a day" counts a retry once) and a `heading` on a lent one
 * (what the lender allowed is held at every use). Without them Orbit answers `incomplete`: such a use never runs.
 *
 * An App is never refused to the person: the bot carries on without it and says so in plain words.
 */
import axios from 'axios';
import type { ToolHeading } from './ToolCatalog';

/** Why Orbit did not allow a use. `unavailable` is ours: Orbit could not be asked, so nothing is let through. */
export type AppUseRefusal = 'gone' | 'off' | 'not_owner' | 'not_lent' | 'limit_reached' | 'incomplete' | 'unavailable';

/** `reason` is set whenever `allowed` is false. */
export interface AppUseAnswer {
    allowed: boolean;
    reason?: AppUseRefusal;
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
}

/** Asks Orbit. Never throws: when Orbit can't be asked the answer is `unavailable`. */
export type AppUseCheck = (botId: string, serverId: string, request: AppUseRequest) => Promise<AppUseAnswer>;

const REASONS: readonly AppUseRefusal[] = ['gone', 'off', 'not_owner', 'not_lent', 'limit_reached', 'incomplete'];
const TIMEOUT_MS = 8_000;

/** The body Orbit takes: only what it was given, so nothing is sent as "undefined". */
export function useBody(request: AppUseRequest): Record<string, unknown> {
    const heading = orbitHeadingOf(request.heading);
    return {
        callId: request.callId,
        ...(request.requesterKey ? { requesterKey: request.requesterKey } : {}),
        ...(request.forOwner === true ? { forOwner: true } : {}),
        ...(heading ? { heading } : {}),
    };
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
            if (response.data?.allowed === true) return { allowed: true };
            const reason = response.data?.reason;
            return { allowed: false, reason: REASONS.includes(reason) ? reason : 'gone' };
        } catch (error) {
            console.warn('[AppUse] Orbit could not be asked about an App:', error instanceof Error ? error.message : error);
            return { allowed: false, reason: 'unavailable' };
        }
    };
}

/**
 * What the bot is told when an App was not used, in plain words. Nothing about whose App it is or what it holds, no prices;
 * the bot carries on without it and tells the person.
 */
export function appNotUsedLine(reason: AppUseRefusal): string {
    const tail = ' This was not done with that App. Carry on without it if you can, and tell the person in one plain line.';
    switch (reason) {
        case 'limit_reached':
            return `That App has reached its uses for today here.${tail}`;
        case 'not_lent':
            return `That App was not shared for this kind of thing here.${tail}`;
        case 'not_owner':
            return `That App is only for its owner, so it cannot be used for this request.${tail}`;
        case 'off':
            return `That App is switched off for this bot.${tail}`;
        case 'unavailable':
            return "I can't check that App right now. Try again soon. This was not done.";
        default:
            return `That App can't be used here any more.${tail}`;
    }
}
