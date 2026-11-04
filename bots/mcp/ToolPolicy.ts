/**
 * What Orbit says a bot may do with each tool of an MCP server (game #1656, Orbit #738): the four headings' settings
 * (Right away, Asks first, Off), which tools a person confirmed and under which heading, and the policy revision that
 * goes up with every change. The gate reads it right before a call and when it builds a bot's tool list.
 *
 * Reads are kept for a few seconds so a chat with many tool calls asks Orbit once, and several calls at once share one
 * question. When Orbit can't be asked, the last answer stands for a while (so a short outage does not stop a bot's
 * tools), and after that nothing is let through: a policy that can't be read is never guessed.
 */
import axios from 'axios';
import { TOOL_HEADINGS, type OrbitConnection, type ToolHeading } from './ToolCatalog';

export const TOOL_SETTINGS = ['rightAway', 'asksFirst', 'off'] as const;
export type ToolSetting = (typeof TOOL_SETTINGS)[number];

/** Not checked yet: an old server that keeps working in text. Not confirmed yet: some tool waits. Confirmed: all are. */
export type ServerToolsState = 'notCheckedYet' | 'notConfirmedYet' | 'confirmed';

export interface PolicyTool {
    name: string;
    fingerprint: string;
    /** Where a person put it, or accepted it from the suggestion. Null until then. */
    heading: ToolHeading | null;
    suggestedHeading: ToolHeading | null;
    confirmed: boolean;
}

export interface ServerPolicy {
    serverId: string;
    state: ServerToolsState;
    policyRevision: number;
    settings: Record<ToolHeading, ToolSetting>;
    tools: Map<string, PolicyTool>;
}

/** An answer this young is used without asking Orbit again. */
export const POLICY_FRESH_MS = 5_000;
/** When Orbit can't be asked, an answer this old still stands. After it, nothing is let through. */
export const POLICY_STALE_OK_MS = 10 * 60_000;
const POLICY_TIMEOUT_MS = 5_000;
const MAX_REMEMBERED_SERVERS = 2_000;

const isHeading = (value: unknown): value is ToolHeading => TOOL_HEADINGS.includes(value as ToolHeading);
const isSetting = (value: unknown): value is ToolSetting => TOOL_SETTINGS.includes(value as ToolSetting);

/** Orbit's answer for one server (GET .../tools) as the gate reads it, or null when it isn't one. */
export function parseServerPolicy(serverId: string, data: unknown): ServerPolicy | null {
    if (!data || typeof data !== 'object') return null;
    const body = data as Record<string, unknown>;
    if (body.state !== 'notCheckedYet' && body.state !== 'notConfirmedYet' && body.state !== 'confirmed') return null;
    if (typeof body.policyRevision !== 'number' || !Array.isArray(body.tools)) return null;
    const rawSettings = (body.settings ?? {}) as Record<string, unknown>;
    // A heading Orbit gave no valid setting for asks first: the stricter reading of "unknown"
    const settings = Object.fromEntries(TOOL_HEADINGS.map((heading) => [heading, isSetting(rawSettings[heading]) ? rawSettings[heading] : 'asksFirst'])) as Record<ToolHeading, ToolSetting>;
    const tools = new Map<string, PolicyTool>();
    for (const item of body.tools) {
        const tool = item as Record<string, unknown>;
        if (typeof tool?.name !== 'string' || typeof tool.fingerprint !== 'string') continue;
        tools.set(tool.name, {
            name: tool.name,
            fingerprint: tool.fingerprint,
            heading: isHeading(tool.heading) ? tool.heading : null,
            suggestedHeading: isHeading(tool.suggestedHeading) ? tool.suggestedHeading : null,
            confirmed: tool.state === 'confirmed',
        });
    }
    return { serverId, state: body.state, policyRevision: body.policyRevision, settings, tools };
}

export class ToolPolicyUnavailable extends Error {
    constructor(cause?: unknown) {
        super(`Orbit's tool policy could not be read${cause instanceof Error ? `: ${cause.message}` : ''}`);
        this.name = 'ToolPolicyUnavailable';
    }
}

export class ToolPolicySource {
    private readonly known = new Map<string, { policy: ServerPolicy; at: number }>();
    private readonly asking = new Map<string, Promise<ServerPolicy>>();

    constructor(
        private readonly orbit: () => OrbitConnection | null,
        private readonly now: () => number = Date.now
    ) {}

    /** One server's policy. Throws ToolPolicyUnavailable when it can't be read and no recent answer stands. */
    async read(botId: string, serverId: string): Promise<ServerPolicy> {
        const key = `${botId}|${serverId}`;
        const known = this.known.get(key);
        if (known && this.now() - known.at < POLICY_FRESH_MS) return known.policy;
        try {
            return await this.ask(key, botId, serverId);
        } catch (error) {
            if (known && this.now() - known.at < POLICY_STALE_OK_MS) return known.policy;
            throw error instanceof ToolPolicyUnavailable ? error : new ToolPolicyUnavailable(error);
        }
    }

    /** Forget what was read, so the next read asks Orbit (after a card was answered, say). */
    forget(botId: string, serverId: string): void {
        this.known.delete(`${botId}|${serverId}`);
    }

    private ask(key: string, botId: string, serverId: string): Promise<ServerPolicy> {
        const pending = this.asking.get(key);
        if (pending) return pending;
        const orbit = this.orbit();
        if (!orbit) return Promise.reject(new ToolPolicyUnavailable());

        const question = axios
            .get(`${orbit.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/mcp-servers/${encodeURIComponent(serverId)}/tools`, {
                headers: { Authorization: `Bearer ${orbit.adminApiToken}`, 'Cache-Control': 'no-store' },
                timeout: POLICY_TIMEOUT_MS,
            })
            .then((response) => {
                const policy = parseServerPolicy(serverId, response.data);
                if (!policy) throw new ToolPolicyUnavailable(new Error('an answer that is not a tool policy'));
                this.remember(key, policy);
                return policy;
            })
            .finally(() => {
                this.asking.delete(key);
            });
        this.asking.set(key, question);
        return question;
    }

    private remember(key: string, policy: ServerPolicy): void {
        this.known.delete(key);
        this.known.set(key, { policy, at: this.now() });
        while (this.known.size > MAX_REMEMBERED_SERVERS) {
            const oldest = this.known.keys().next().value;
            if (oldest === undefined) break;
            this.known.delete(oldest);
        }
    }
}
