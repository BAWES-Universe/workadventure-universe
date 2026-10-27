import { botIdFromChatId } from "./BotChatStatus";

/**
 * A reply limit a person reached on a bot (#1159): the bot did not answer, and the game shows one fixed card that only
 * they see. In nearby chat it comes as a private event from the bot; in direct messages as the `universe.reply_limit`
 * field of the bot's notice.
 *   - limit: which limit (their Universe AI replies signed in or as a guest, the bot's guests' shared replies, or the
 *     bot's own limit per person)
 *   - who: who reached it, so the card offers the one way out that fits them
 */
export type ReplyLimitKind = "universe-ai" | "guest" | "guests" | "bot";
export type ReplyLimitAsker = "guest" | "member" | "maker";

export interface BotReplyLimit {
    limit: ReplyLimitKind;
    /** When the bot answers them again (ISO time) */
    resetsAt: string;
    who: ReplyLimitAsker;
    botId: string;
    botName: string;
}

/** Which card a reached limit shows. */
export type ReplyLimitCardKind = "member" | "maker" | "guest" | "bot";

const KINDS: ReplyLimitKind[] = ["universe-ai", "guest", "guests", "bot"];
const ASKERS: ReplyLimitAsker[] = ["guest", "member", "maker"];
const NAME_MAX = 120;

/** A reply limit as the bot sends it, or undefined when any part of it is missing or not one we know. */
export function parseBotReplyLimit(value: unknown, botId: string, botName: string): BotReplyLimit | undefined {
    if (!value || typeof value !== "object" || !botId) return undefined;
    const { limit, resetsAt, who } = value as Partial<Record<keyof BotReplyLimit, unknown>>;
    if (!KINDS.includes(limit as ReplyLimitKind) || !ASKERS.includes(who as ReplyLimitAsker)) return undefined;
    if (typeof resetsAt !== "string" || Number.isNaN(Date.parse(resetsAt))) return undefined;
    return {
        limit: limit as ReplyLimitKind,
        resetsAt,
        who: who as ReplyLimitAsker,
        botId,
        botName: botName.trim().slice(0, NAME_MAX),
    };
}

/** The reply limit a bot's direct message notice carries, or undefined when it has none or is not from a bot. */
export function readBotReplyLimit(
    sender: string | null | undefined,
    content: Record<string, unknown>,
    botName: string
): BotReplyLimit | undefined {
    const botId = botIdFromChatId(sender);
    if (!botId || content.msgtype !== "m.notice") return undefined;
    return parseBotReplyLimit(content["universe.reply_limit"], botId, botName);
}

/**
 * The card for a reached limit. The bot's own limit has no way out but waiting. Otherwise a guest can sign in, the bot's
 * maker can run it on their AI key, and anyone else can ask the maker to.
 */
export function replyLimitCardKind(limit: Pick<BotReplyLimit, "limit" | "who">): ReplyLimitCardKind {
    if (limit.limit === "bot") return "bot";
    if (limit.who === "guest" || limit.limit === "guest" || limit.limit === "guests") return "guest";
    return limit.who === "maker" ? "maker" : "member";
}

/** When the bot answers again, in the viewer's own clock: the time today, with the day when it is not today. */
export function replyLimitTime(resetsAt: string, locale: string, now: Date = new Date()): string {
    const at = new Date(resetsAt);
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

/** The cards a timeline shows (#1159): for each bot only its newest card, and only until its time is up. */
export function shownReplyLimitIds(
    messages: ReadonlyArray<{ id: string; replyLimit?: BotReplyLimit }>,
    now: number
): Set<string> {
    const newest = new Map<string, string>();
    for (const message of messages) {
        if (message.replyLimit && Date.parse(message.replyLimit.resetsAt) > now) {
            newest.set(message.replyLimit.botId, message.id);
        }
    }
    return new Set(newest.values());
}

/** When the next card shown runs out, so the timeline can take it away then; undefined when none will. */
export function nextReplyLimitExpiry(
    messages: ReadonlyArray<{ replyLimit?: BotReplyLimit }>,
    now: number
): number | undefined {
    let next: number | undefined;
    for (const message of messages) {
        const at = message.replyLimit ? Date.parse(message.replyLimit.resetsAt) : NaN;
        if (at > now && (next === undefined || at < next)) next = at;
    }
    return next;
}
