// The tools of the bot whose page is open (game #1655, Orbit #738): its servers, each server's tools with where they sit,
// and its Asking for approvals settings. The Tools group and its three screens (a server, a heading, Asking for
// approvals) all show this one answer, so going back and forth between them never asks Orbit again for what is here.
import { get, writable } from "svelte/store";
import { botApiService, type McpServer } from "../services/BotApiService";
import type { BotToolSettings, Heading, ServerTools, Setting } from "../toolsModel";

export interface BotToolsState {
    botId: string;
    /** Undefined until the first answer */
    servers: McpServer[] | undefined;
    /** By server id */
    tools: Record<string, ServerTools>;
    settings: BotToolSettings | undefined;
}

export const botToolsStore = writable<BotToolsState | undefined>(undefined);

/** The bot whose page asked last. An answer for any other bot is let go: that page is gone and must not put its state back. */
let current: string | undefined;

function forBot(botId: string): BotToolsState {
    const held = get(botToolsStore);
    return held && held.botId === botId ? held : { botId, servers: undefined, tools: {}, settings: undefined };
}

/** Write for a bot only while it is still the bot being looked at */
function put(botId: string, next: BotToolsState): void {
    if (current === botId) botToolsStore.set(next);
}

/** An answer that is older than the one held (a slow read landing after a change) must not put the old list back */
function take(botId: string, answer: ServerTools): void {
    const held = forBot(botId);
    const existing = held.tools[answer.serverId];
    if (existing && existing.policyRevision > answer.policyRevision) return;
    put(botId, { ...held, tools: { ...held.tools, [answer.serverId]: answer } });
}

/** The bot's servers, as the list has just loaded them: tools of a server that is gone are let go */
export function setServers(botId: string, servers: McpServer[]): void {
    current = botId;
    const held = forBot(botId);
    const ids = new Set(servers.map((server) => server.id));
    const tools = Object.fromEntries(Object.entries(held.tools).filter(([id]) => ids.has(id)));
    put(botId, { ...held, servers, tools });
}

export async function loadServerTools(botId: string, serverId: string): Promise<void> {
    current = botId;
    take(botId, await botApiService.getMcpServerTools(botId, serverId));
}

/** Every server's tools, for the "3 to check" a row says. A server whose tools can't be read keeps its plain row. */
export async function loadAllServerTools(botId: string, servers: McpServer[]): Promise<void> {
    await Promise.all(
        servers.map((server) =>
            loadServerTools(botId, server.id).catch((error) =>
                console.error("[BotToolsStore] Failed to load a server's tools:", error)
            )
        )
    );
}

export async function moveTool(botId: string, serverId: string, toolId: string, heading: Heading): Promise<void> {
    current = botId;
    take(botId, await botApiService.moveMcpTool(botId, serverId, toolId, heading));
}

/** Confirm every tool as the list looked on screen: Orbit says no when it has moved since */
export async function confirmAllTools(botId: string, serverId: string): Promise<void> {
    current = botId;
    const shown = forBot(botId).tools[serverId];
    if (!shown) return;
    take(botId, await botApiService.confirmMcpTools(botId, serverId, shown.policyRevision));
}

/** Change one heading's choice in what is held, leaving every other heading and the revision as they are */
function withSetting(botId: string, serverId: string, heading: Heading, value: Setting): void {
    const held = forBot(botId);
    const one = held.tools[serverId];
    if (!one) return;
    put(botId, {
        ...held,
        tools: { ...held.tools, [serverId]: { ...one, settings: { ...one.settings, [heading]: value } } },
    });
}

/** Pick Right away, Asks first or Off for a heading; shown at once, and only that heading put back if Orbit says no */
export async function chooseSetting(botId: string, serverId: string, heading: Heading, value: Setting): Promise<void> {
    current = botId;
    const before = forBot(botId).tools[serverId]?.settings[heading];
    withSetting(botId, serverId, heading, value);
    try {
        take(botId, await botApiService.saveMcpServerSettings(botId, serverId, { [heading]: value }));
    } catch (error) {
        if (before) withSetting(botId, serverId, heading, before);
        throw error;
    }
}

export async function loadBotToolSettings(botId: string): Promise<void> {
    current = botId;
    const settings = await botApiService.getBotToolSettings(botId);
    put(botId, { ...forBot(botId), settings });
}

/** Put in only the keys a change names, so an answer or a rollback never undoes a different setting changed meanwhile */
function withApproval(botId: string, values: Partial<BotToolSettings>): void {
    const held = forBot(botId);
    if (held.settings) put(botId, { ...held, settings: { ...held.settings, ...values } });
}

export async function saveBotToolSettings(botId: string, change: Partial<BotToolSettings>): Promise<void> {
    current = botId;
    const before = forBot(botId).settings;
    withApproval(botId, change);
    try {
        const saved = await botApiService.saveBotToolSettings(botId, change);
        const kept: Partial<BotToolSettings> = {};
        for (const key of Object.keys(change) as Array<keyof BotToolSettings>) {
            Object.assign(kept, { [key]: saved[key] });
        }
        if (before) withApproval(botId, kept);
        else put(botId, { ...forBot(botId), settings: saved });
    } catch (error) {
        if (before) {
            const back: Partial<BotToolSettings> = {};
            for (const key of Object.keys(change) as Array<keyof BotToolSettings>) {
                Object.assign(back, { [key]: before[key] });
            }
            withApproval(botId, back);
        }
        throw error;
    }
}
