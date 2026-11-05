import { botIdFromChatId } from "./BotChatStatus";

/**
 * A tool whose sign-in expired (#1819, mock approved 5 Nov 2026): the card a bot shows the people who manage it, pinned
 * above the message box with an X, so they can sign in again where they are. In nearby chat it comes as a private event
 * of the bot (kind "signin"); in direct messages as the `universe.tool_signin` field of the bot's notice. Only a bot may
 * send it; no AI writes it. Before it is drawn the game asks Orbit, so an old card never offers a fix that is done.
 */
export const BOT_TOOL_SIGNIN_KEY = "universe.tool_signin";

export type ToolSignInKind = "oauth" | "key" | "none";

/** One connection that needs signing in again. */
export interface ToolSignInLost {
    serverId: string;
    name: string;
    /** When the bot first saw the sign-in refused (ISO) */
    since: string;
    kind: ToolSignInKind;
}

export interface BotToolSignIn {
    botId: string;
    botName: string;
    lost: ToolSignInLost[];
}

const KINDS: ToolSignInKind[] = ["oauth", "key", "none"];
const NAME_MAX = 120;
const MAX_LOST = 10;

/** A card as the bot sends it, or undefined when it is not one. An empty list is the bot taking the card back. */
export function parseBotToolSignIn(value: unknown, botId: string, botName: string): BotToolSignIn | undefined {
    if (!value || typeof value !== "object" || !botId) return undefined;
    const raw = (value as { lost?: unknown }).lost;
    if (!Array.isArray(raw)) return undefined;
    const lost: ToolSignInLost[] = [];
    for (const item of raw.slice(0, MAX_LOST)) {
        if (!item || typeof item !== "object") continue;
        const { serverId, name, since, kind } = item as Partial<Record<keyof ToolSignInLost, unknown>>;
        if (typeof serverId !== "string" || !serverId || typeof name !== "string" || !name.trim()) continue;
        if (typeof since !== "string" || Number.isNaN(Date.parse(since))) continue;
        if (!KINDS.includes(kind as ToolSignInKind)) continue;
        lost.push({ serverId, name: name.trim().slice(0, NAME_MAX), since, kind: kind as ToolSignInKind });
    }
    return { botId, botName: botName.trim().slice(0, NAME_MAX), lost };
}

/** The card a bubble's private event carries (its body is the card as JSON). */
export function parseNearbyToolSignIn(body: string, botId: string, botName: string): BotToolSignIn | undefined {
    try {
        return parseBotToolSignIn(JSON.parse(body), botId, botName);
    } catch {
        return undefined;
    }
}

/** The card a bot's direct message notice carries, or undefined when it has none or is not from a bot. */
export function readBotToolSignIn(
    sender: string | null | undefined,
    content: Record<string, unknown>,
    botName: string
): BotToolSignIn | undefined {
    const botId = botIdFromChatId(sender);
    if (!botId || content.msgtype !== "m.notice") return undefined;
    const card = parseBotToolSignIn(content[BOT_TOOL_SIGNIN_KEY], botId, botName);
    return card && card.lost.length > 0 ? card : undefined;
}

/** Since when, in the viewer's own clock: the time today, with the day when it is not today. */
export function toolSignInSince(since: string, locale: string, now: Date = new Date()): string {
    const at = new Date(since);
    const sameDay = at.toDateString() === now.toDateString();
    try {
        return new Intl.DateTimeFormat(locale, {
            ...(sameDay ? {} : { weekday: "short" }),
            hour: "numeric",
            minute: "2-digit",
        }).format(at);
    } catch {
        return at.toLocaleTimeString();
    }
}

/**
 * Which of the card's connections are still lost, as Orbit's server list says it now. A connection that is not lost any
 * more, or whose server is gone, is dropped (an old card must not offer a fix that is done); `reconnected` ones, which
 * this person just fixed from the card, stay as done.
 */
export function stillLost(
    lost: readonly ToolSignInLost[],
    servers: ReadonlyArray<{ id: string; signInLostAt?: string | null }>
): ToolSignInLost[] {
    const byId = new Map(servers.map((server) => [server.id, server]));
    return lost.filter((one) => !!byId.get(one.serverId)?.signInLostAt);
}

/** Cards a person closed with the X, by message, for as long as the page is open. */
const closedToolSignIns = new Set<string>();

export function closeToolSignIn(messageId: string): void {
    closedToolSignIns.add(messageId);
}

export function isToolSignInClosed(messageId: string): boolean {
    return closedToolSignIns.has(messageId);
}
