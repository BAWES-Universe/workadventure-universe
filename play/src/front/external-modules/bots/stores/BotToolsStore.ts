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

function forBot(botId: string): BotToolsState {
    const held = get(botToolsStore);
    return held && held.botId === botId ? held : { botId, servers: undefined, tools: {}, settings: undefined };
}

/** An answer that is older than the one held (a slow read landing after a change) must not put the old list back */
function take(botId: string, answer: ServerTools): void {
    const held = forBot(botId);
    const current = held.tools[answer.serverId];
    if (current && current.policyRevision > answer.policyRevision) return;
    botToolsStore.set({ ...held, tools: { ...held.tools, [answer.serverId]: answer } });
}

/** The bot's servers, as the list has just loaded them: tools of a server that is gone are let go */
export function setServers(botId: string, servers: McpServer[]): void {
    const held = forBot(botId);
    const ids = new Set(servers.map((server) => server.id));
    const tools = Object.fromEntries(Object.entries(held.tools).filter(([id]) => ids.has(id)));
    botToolsStore.set({ ...held, servers, tools });
}

export async function loadServerTools(botId: string, serverId: string): Promise<void> {
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
    take(botId, await botApiService.moveMcpTool(botId, serverId, toolId, heading));
}

/** Confirm every tool as the list looked on screen: Orbit says no when it has moved since */
export async function confirmAllTools(botId: string, serverId: string): Promise<void> {
    const shown = forBot(botId).tools[serverId];
    if (!shown) return;
    take(botId, await botApiService.confirmMcpTools(botId, serverId, shown.policyRevision));
}

/** Pick Right away, Asks first or Off for a heading; shown at once, put back if Orbit says no */
export async function chooseSetting(botId: string, serverId: string, heading: Heading, value: Setting): Promise<void> {
    const before = forBot(botId).tools[serverId];
    if (before) {
        botToolsStore.set({
            ...forBot(botId),
            tools: {
                ...forBot(botId).tools,
                [serverId]: { ...before, settings: { ...before.settings, [heading]: value } },
            },
        });
    }
    try {
        take(botId, await botApiService.saveMcpServerSettings(botId, serverId, { [heading]: value }));
    } catch (error) {
        if (before) botToolsStore.set({ ...forBot(botId), tools: { ...forBot(botId).tools, [serverId]: before } });
        throw error;
    }
}

export async function loadBotToolSettings(botId: string): Promise<void> {
    const settings = await botApiService.getBotToolSettings(botId);
    botToolsStore.set({ ...forBot(botId), settings });
}

export async function saveBotToolSettings(botId: string, change: Partial<BotToolSettings>): Promise<void> {
    const before = forBot(botId).settings;
    if (before) botToolsStore.set({ ...forBot(botId), settings: { ...before, ...change } });
    try {
        const settings = await botApiService.saveBotToolSettings(botId, change);
        botToolsStore.set({ ...forBot(botId), settings });
    } catch (error) {
        if (before) botToolsStore.set({ ...forBot(botId), settings: before });
        throw error;
    }
}
