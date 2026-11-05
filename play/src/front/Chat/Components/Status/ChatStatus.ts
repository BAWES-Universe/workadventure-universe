import type { TranslationFunctions } from "../../../../i18n/i18n-types";
import type { BotAvailability } from "../../Bots/BotChatStatus";
import { botStatusColour } from "../../Bots/BotChatStatus";
import type { PartnerPlace } from "../Room/DirectChat/PartnerPlace";
import { partnerStatus } from "../Room/DirectChat/PartnerStatus";
import { lastSeenDay } from "../UserList/Friends";

/**
 * What a direct chat's other side is doing right now, for a person or a bot alike. The Chats list, the chat header and
 * People all read it, so they cannot disagree.
 * - A person: where they are ({@link PartnerPlace}), and when a friend who shares their room was last in Universe.
 * - A bot: the state the bot server gave (undefined while it has not answered yet).
 */
export type ChatStatusFacts =
    | { kind: "person"; place: PartnerPlace; lastSeenAt?: string }
    | { kind: "bot"; state: BotAvailability | undefined };

/** Offline: a grey dot in the same spot, so every chat has exactly one dot. */
export const OFFLINE_GREY = "#8a8698";

/** The dot's colour. A bot that has not answered yet gets no dot rather than a wrong one. */
export function statusDotColour(facts: ChatStatusFacts, ll: TranslationFunctions): string | undefined {
    if (facts.kind === "bot") return facts.state ? botStatusColour(facts.state) : undefined;
    return partnerStatus(facts.place, ll).color ?? OFFLINE_GREY;
}

/**
 * The words under their name in the chat header: "Online · Cafe", "Away", "Resting", "Last seen yesterday", "Offline".
 * A person who is offline says when a friend who shares their room was last seen, in days.
 */
export function statusWords(
    facts: ChatStatusFacts,
    ll: TranslationFunctions,
    locale: string,
    now: number
): string | undefined {
    if (facts.kind === "bot") return facts.state ? ll.chat.botStatus[facts.state]() : undefined;
    if (facts.place.kind === "offline") {
        const when = lastSeenDay(facts.lastSeenAt, now, locale);
        if (when) return ll.chat.friends.lastSeen({ when });
    }
    return partnerStatus(facts.place, ll).label;
}
