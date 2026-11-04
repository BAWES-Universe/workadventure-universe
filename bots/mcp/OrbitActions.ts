/**
 * The bot server's side of Orbit's saved actions (Orbit #739, game #1657): an action that waits for a tap is a row in
 * Orbit, with the exact arguments that were shown and run, a revision that goes up with every change, and one winner for
 * every tap. Every route takes BOT_SERVICE_TOKEN; the bot's own card settings are read with the admin token.
 *
 * Nothing here decides anything: it carries a request to Orbit and gives Orbit's answer back. A 409 is an answer (someone
 * else's tap, a replacement or the clock got there first), not an error, and comes back with what the action is now.
 */
import axios from 'axios';
import type { ToolHeading } from './ToolCatalog';

export type ActionStatus = 'waiting' | 'approved' | 'running' | 'done' | 'failed' | 'couldntConfirm' | 'closed';
export type ClosedReason = 'declined' | 'superseded' | 'expired' | 'stale' | 'cancelled' | 'revoked';
export type Decision = 'approve' | 'approveAndRemember' | 'decline';
export type FinishOutcome = 'succeeded' | 'failed' | 'notSent' | 'uncertain';

/** What "allow more" remembers: arguments that stay exactly as approved, and fields that may be different next time. */
export interface RememberScope {
    fixed: Record<string, unknown>;
    varies: string[];
}

export interface SavedAction {
    id: string;
    botId: string;
    status: ActionStatus;
    closedReason: ClosedReason | null;
    revision: number;
    requesterKey: string;
    conversationKey: string;
    connectionRef: string | null;
    toolName: string;
    heading: ToolHeading;
    toolFingerprint: string;
    policyRevision: number;
    arguments: Record<string, unknown>;
    rememberScope: RememberScope | null;
    /** When the card closes if nobody answers, on Orbit's clock. */
    reviewExpiresAt: string;
}

export interface NewAction {
    proposalKey: string;
    requesterKey: string;
    conversationKey: string;
    connectionRef: string | null;
    toolName: string;
    heading: ToolHeading;
    toolFingerprint: string;
    policyRevision: number;
    arguments: Record<string, unknown>;
    rememberScope: RememberScope | null;
    reviewMinutes?: number;
}

export type DecideAnswer =
    | { outcome: 'decided'; action: SavedAction; grantId: string | null }
    | { outcome: 'already_decided' | 'expired'; action: SavedAction };

export type ChangeAnswer = { outcome: 'changed' | 'already_decided' | 'expired'; action: SavedAction } | { outcome: 'no_more_time'; action?: undefined };

export type ClaimAnswer =
    | { claimed: true; action: SavedAction; attemptId: string }
    | { claimed: false; reason: string; action?: SavedAction };

/** The bot's own limits for asking (Orbit #738). */
export interface CardSettings {
    cardWaitMinutes: number;
}
export const DEFAULT_CARD_WAIT_MINUTES = 10;

const TIMEOUT_MS = 8_000;
const SETTINGS_FRESH_MS = 30_000;

export interface OrbitSide {
    adminApiUrl: string;
    adminApiToken: string;
    /** BOT_SERVICE_TOKEN. */
    serviceToken: string;
}

export class OrbitActionsUnavailable extends Error {
    constructor(what: string, cause?: unknown) {
        super(`Orbit could not be asked ${what}${cause instanceof Error ? `: ${cause.message}` : ''}`);
        this.name = 'OrbitActionsUnavailable';
    }
}

export class OrbitActions {
    private readonly settings = new Map<string, { value: CardSettings; at: number }>();

    constructor(
        private readonly orbit: () => OrbitSide | null,
        private readonly now: () => number = Date.now
    ) {}

    private async post<T>(botId: string, path: string, body: object, what: string): Promise<{ status: number; data: T }> {
        const side = this.orbit();
        if (!side || !side.serviceToken) throw new OrbitActionsUnavailable(what);
        try {
            const response = await axios.post(`${side.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/${path}`, body, {
                headers: { Authorization: `Bearer ${side.serviceToken}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                timeout: TIMEOUT_MS,
                // 409 is an answer: what happened first, and what the action is now
                validateStatus: (status) => (status >= 200 && status < 300) || status === 409,
            });
            return { status: response.status, data: response.data as T };
        } catch (error) {
            throw new OrbitActionsUnavailable(what, error);
        }
    }

    /** An action as Orbit has it now (a card that waited too long is closed first). Null when there is no such action. */
    async read(botId: string, id: string): Promise<SavedAction | null> {
        const side = this.orbit();
        if (!side || !side.serviceToken) throw new OrbitActionsUnavailable('to read the action');
        try {
            const response = await axios.get(`${side.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/actions/${encodeURIComponent(id)}`, {
                headers: { Authorization: `Bearer ${side.serviceToken}`, 'Cache-Control': 'no-store' },
                timeout: TIMEOUT_MS,
                validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
            });
            return response.status === 404 ? null : ((response.data?.action ?? response.data) as SavedAction);
        } catch (error) {
            throw new OrbitActionsUnavailable('to read the action', error);
        }
    }

    /** Save an action that waits for a tap. The same proposal key again returns the action already saved. */
    async create(botId: string, input: NewAction): Promise<SavedAction> {
        const { data } = await this.post<{ action: SavedAction }>(botId, 'actions', input, 'to save the action');
        return data.action;
    }

    async decide(botId: string, id: string, input: { actorKey: string; revision: number; decision: Decision }): Promise<DecideAnswer> {
        const { data } = await this.post<DecideAnswer>(botId, `actions/${encodeURIComponent(id)}/decision`, input, 'to record the answer');
        return data;
    }

    /** Close one card with X: nothing is done. */
    async cancel(botId: string, id: string, input: { actorKey: string; revision: number }): Promise<ChangeAnswer> {
        const { data } = await this.post<ChangeAnswer>(botId, `actions/${encodeURIComponent(id)}/cancel`, input, 'to close the card');
        return data;
    }

    /** "More time": another full wait from now. After the tenth the card can't wait any longer. */
    async extend(botId: string, id: string, input: { actorKey: string; revision: number; reviewMinutes?: number }): Promise<ChangeAnswer> {
        const { status, data } = await this.post<ChangeAnswer & { code?: string }>(botId, `actions/${encodeURIComponent(id)}/extend`, input, 'to give the card more time');
        if (status === 409 && (data as { code?: string }).code === 'no_more_time') return { outcome: 'no_more_time' };
        return data;
    }

    /** The one go at running an approved action. Only one dispatcher wins. */
    async claim(botId: string, id: string): Promise<ClaimAnswer> {
        const { data } = await this.post<ClaimAnswer>(botId, `actions/${encodeURIComponent(id)}/claim`, {}, 'to start the action');
        return data;
    }

    /** How the attempt ended, as far as it can be proven. */
    async finish(botId: string, id: string, input: { attemptId: string; outcome: FinishOutcome; outcomeClass?: string }): Promise<SavedAction | null> {
        const { status, data } = await this.post<{ action: SavedAction }>(botId, `actions/${encodeURIComponent(id)}/finish`, input, 'to record how the action ended');
        return status === 200 ? data.action : null;
    }

    /** The asker sent a replacement instruction: their waiting cards in this conversation close. */
    async supersede(botId: string, input: { requesterKey: string; conversationKey: string }): Promise<string[]> {
        const { data } = await this.post<{ closed: string[] }>(botId, 'actions/supersede', input, 'to close the waiting cards');
        return Array.isArray(data?.closed) ? data.closed : [];
    }

    /** A remembered approval that covers this call, if one does. */
    async findGrant(botId: string, input: Omit<NewAction, 'proposalKey' | 'rememberScope' | 'reviewMinutes'>): Promise<{ grantId: string; scope: RememberScope } | null> {
        const { data } = await this.post<{ grant: { grantId: string; scope: RememberScope } | null }>(botId, 'action-grants/find', input, 'about a remembered approval');
        return data?.grant ?? null;
    }

    /** The asker wrote to the bot: their remembered approvals here last another idle period. */
    async touchGrants(botId: string, input: { requesterKey: string; conversationKey: string }): Promise<void> {
        await this.post(botId, 'action-grants/touch', input, 'to renew remembered approvals');
    }

    /** "Ask me again": the asker's remembered approvals in this conversation end. */
    async revokeGrants(botId: string, input: { requesterKey: string; conversationKey: string; reason: 'ask_again' | 'left' | 'signed_out' }): Promise<void> {
        await this.post(botId, 'action-grants/revoke', input, 'to end remembered approvals');
    }

    /** How long this bot's cards wait. A failed read gives the recommended wait: the card still comes. */
    async cardSettings(botId: string): Promise<CardSettings> {
        const key = botId;
        const known = this.settings.get(key);
        if (known && this.now() - known.at < SETTINGS_FRESH_MS) return known.value;
        const side = this.orbit();
        let value: CardSettings = known?.value ?? { cardWaitMinutes: DEFAULT_CARD_WAIT_MINUTES };
        if (side) {
            try {
                const response = await axios.get(`${side.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/tool-settings`, {
                    headers: { Authorization: `Bearer ${side.adminApiToken}` },
                    timeout: TIMEOUT_MS,
                });
                const minutes = response.data?.cardWaitMinutes;
                if (typeof minutes === 'number' && minutes > 0 && minutes <= 24 * 60) value = { cardWaitMinutes: Math.round(minutes) };
            } catch {
                // the recommended wait, or the last one Orbit gave
            }
        }
        this.settings.set(key, { value, at: this.now() });
        if (this.settings.size > 2000) this.settings.delete(this.settings.keys().next().value!);
        return value;
    }
}
