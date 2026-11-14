/**
 * Apps with a key (game #2044): an App the person connected by its service and a key (Tap, or any service they set up), used
 * by their own Brick. Orbit holds the key and does the request; this side only knows the operations, as tools, and carries
 * the model's choice of operation and arguments to Orbit. The model never sees an address, a header or the key.
 *
 * The tools go through the same gate, the same cards and the same remembered approvals as every other tool: Orbit gives each
 * operation as a tool of its grant with a confirmed or waiting state and the heading it is under, and the answer here is just
 * the tool list and how a call is run. A call is checked by Orbit again at every use (own Brick, switched on, the owner asking,
 * the version of the definition that was approved), so nothing here is trusted on its own.
 */
import axios from 'axios';
import type { McpToolDefinition, ToolServerEntry } from './MCPConnector';
import { appNotUsedLine, type AppUseRefusal } from './AppUse';

export interface KeyAppOperation {
    id: string;
    label: string;
    heading: string;
    verified: boolean;
    /** The tool's name as the model calls it, and the fingerprint Orbit's tool policy holds for it. */
    tool: string;
    fingerprint: string;
    inputSchema: Record<string, unknown>;
}

export interface KeyApp {
    serverId: string;
    connectionId: string;
    name: string;
    short: string;
    definitionHash: string;
    enabled: boolean;
    working: boolean;
    /** The App can take a payment for a page. */
    payments: boolean;
    operations: KeyAppOperation[];
}

const TIMEOUT_MS = 8_000;
/** A use waits as long as the service may: Orbit's own limit for one request is smaller than this. */
const CALL_TIMEOUT_MS = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Orbit's list for one Brick (GET /api/bots/:id/key-apps), read defensively. Never throws: a Brick whose list cannot be read has no key apps this turn. */
export async function loadKeyApps(botId: string, adminApiUrl: string, serviceToken: string): Promise<KeyApp[]> {
    return (await loadKeyAppList(botId, adminApiUrl, serviceToken)).apps;
}

export interface KeyService {
    service: string;
    name: string;
    short: string;
}

/** The same list with the services Universe ships a setup for. */
export async function loadKeyAppList(botId: string, adminApiUrl: string, serviceToken: string): Promise<{ apps: KeyApp[]; services: KeyService[] }> {
    const none = { apps: [], services: [] };
    if (!adminApiUrl || !serviceToken) return none;
    try {
        const response = await axios.get(`${adminApiUrl}/api/bots/${encodeURIComponent(botId)}/key-apps`, {
            headers: { Authorization: `Bearer ${serviceToken}`, 'Cache-Control': 'no-store' },
            timeout: TIMEOUT_MS,
            validateStatus: (status) => status === 200 || status === 404,
        });
        return response.status === 200 ? { apps: parseKeyApps(response.data), services: parseServices(response.data) } : none;
    } catch (error) {
        console.warn('[KeyApps] Could not read the key apps:', error instanceof Error ? error.message : error);
        return none;
    }
}

export function parseServices(data: unknown): KeyService[] {
    const list = isRecord(data) && Array.isArray(data.services) ? data.services : [];
    return list.flatMap((one) => (isRecord(one) && typeof one.service === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(one.service) ? [{ service: one.service, name: text(one.name, 60) || one.service, short: text(one.short, 30) || one.service }] : []));
}

export function parseKeyApps(data: unknown): KeyApp[] {
    const apps = isRecord(data) && Array.isArray(data.apps) ? data.apps : [];
    const out: KeyApp[] = [];
    for (const raw of apps) {
        if (!isRecord(raw) || typeof raw.serverId !== 'string' || typeof raw.connectionId !== 'string' || typeof raw.definitionHash !== 'string' || !Array.isArray(raw.operations)) continue;
        const operations: KeyAppOperation[] = [];
        for (const one of raw.operations) {
            if (!isRecord(one) || typeof one.id !== 'string' || typeof one.tool !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(one.tool) || typeof one.fingerprint !== 'string' || !isRecord(one.inputSchema)) continue;
            operations.push({
                id: one.id,
                label: text(one.label, 120) || one.id,
                heading: typeof one.heading === 'string' ? one.heading : 'changesThings',
                verified: one.verified === true,
                tool: one.tool,
                fingerprint: one.fingerprint,
                inputSchema: one.inputSchema,
            });
        }
        out.push({
            serverId: raw.serverId,
            connectionId: raw.connectionId,
            name: text(raw.name, 80) || 'App',
            short: text(raw.short, 30) || 'App',
            definitionHash: raw.definitionHash,
            enabled: raw.enabled !== false,
            working: raw.working !== false,
            payments: raw.payments === true,
            operations,
        });
    }
    return out;
}

/**
 * The tools of the Apps that are on and working, and what the call needs to run each. An App whose key stopped working has no tools:
 * the Brick carries on without it, and its owner has been told once in Orbit.
 */
export function keyAppTools(apps: readonly KeyApp[]): { tools: McpToolDefinition[]; entries: Map<string, ToolServerEntry> } {
    const tools: McpToolDefinition[] = [];
    const entries = new Map<string, ToolServerEntry>();
    for (const app of apps) {
        if (!app.enabled || !app.working) continue;
        for (const operation of app.operations) {
            if (entries.has(operation.tool)) continue;
            tools.push({
                type: 'function',
                function: {
                    name: operation.tool,
                    description: `${operation.label}, with the person's ${app.short} App.`,
                    parameters: operation.inputSchema,
                },
            });
            entries.set(operation.tool, {
                serverId: app.serverId,
                // Never a way in: Orbit holds it. Nothing on this side can reach the service.
                serverUrl: '',
                authType: 'none',
                serverName: app.name,
                title: operation.label,
                fingerprint: operation.fingerprint,
                inputSchema: operation.inputSchema,
                connectionId: app.connectionId,
                keyApp: { definitionHash: app.definitionHash, operation: operation.id },
            });
        }
    }
    return { tools, entries };
}

export interface KeyAppUse {
    botId: string;
    /** Who is asking (their game uuid); a key app is only ever for its owner. */
    requesterKey?: string;
    forOwner?: boolean;
    /** This call's id: the same call asked again is the same use and runs once. */
    callId: string;
}

/**
 * Runs one operation through Orbit. Always an answer the model can use, never a thrown error and never a raw answer from the service:
 * Orbit returns only the fields the definition lists. `outcome` says what is proven about whether it ran.
 */
export async function callKeyApp(where: { adminApiUrl: string; serviceToken: string }, entry: ToolServerEntry, args: Record<string, unknown>, use: KeyAppUse): Promise<unknown> {
    if (!entry.keyApp || !where.adminApiUrl || !where.serviceToken) return { error: "That App can't be used right now. This was not done.", outcome: 'not_sent' };
    const body = {
        callId: use.callId,
        operation: entry.keyApp.operation,
        arguments: args,
        definitionHash: entry.keyApp.definitionHash,
        ...(use.requesterKey ? { requesterKey: use.requesterKey } : {}),
        ...(use.forOwner === true ? { forOwner: true } : {}),
    };
    let response;
    try {
        response = await axios.post(`${where.adminApiUrl}/api/bots/${encodeURIComponent(use.botId)}/key-apps/${encodeURIComponent(entry.serverId)}/call`, body, {
            headers: { Authorization: `Bearer ${where.serviceToken}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            timeout: CALL_TIMEOUT_MS,
            validateStatus: () => true,
        });
    } catch (error) {
        console.warn('[KeyApps] A key app could not be reached:', error instanceof Error ? error.message : error);
        // The request may have reached Orbit and the service: there is no proof either way
        return { error: "I couldn't tell whether that worked. Don't try it again without asking the person." };
    }
    return answerOf(response.status, response.data);
}

const REASONS: readonly AppUseRefusal[] = ['gone', 'off', 'not_owner', 'incomplete'];

/** What the model is told for Orbit's answer, in plain words. Exported for tests. */
export function answerOf(status: number, data: unknown): unknown {
    const body = isRecord(data) ? data : {};
    if (status === 200) {
        if (body.ok === true) return isRecord(body.data) ? { ...body.data, ...(body.truncated === true ? { note: 'The answer was too long to read in full.' } : {}) } : { done: true };
        // The service said no: that is a proven "did not work", with its status and nothing it wrote
        return { error: `The service did not do it (it answered ${typeof body.httpStatus === 'number' ? body.httpStatus : 'with an error'}). Say so in one plain line.`, outcome: 'failed' };
    }
    if (status === 403) {
        const reason = typeof body.reason === 'string' && (REASONS as readonly string[]).includes(body.reason) ? (body.reason as AppUseRefusal) : 'gone';
        return { error: appNotUsedLine(reason), outcome: 'not_sent' };
    }
    if (status === 404) {
        return { error: body.code === 'unknown_operation' ? 'That is not something this App can do. This was not done.' : appNotUsedLine('gone'), outcome: 'not_sent' };
    }
    if (status === 409) {
        if (body.code === 'already_asked') return { done: true, note: 'This was already done a moment ago. Do not do it again.' };
        return { error: 'This App was changed since it was set up for you. This was not done. Tell the person to open Apps and check it.', outcome: 'not_sent' };
    }
    if (status === 400) return { error: `${text(body.error, 300) || 'Those details did not fit.'} This was not done. Fix the details and try once more.`, outcome: 'not_sent' };
    if (status === 429) return { error: 'Too many requests to Apps for now. This was not done. Tell the person to try again in a while.', outcome: 'not_sent' };
    if (status === 502) {
        if (body.code === 'key_rejected') return { error: "The service did not accept the key, so it may have stopped working. This was not done. Tell the person to open Apps and tap Replace key.", outcome: 'failed' };
        return { error: "I couldn't reach that service. Try again soon. This was not done.", outcome: 'failed' };
    }
    return { error: "That App can't be used right now. This was not done.", outcome: 'not_sent' };
}
