import type { DirectPartner } from "../Components/Room/DirectChat/DirectPartnerStore";
import { walkToPartner } from "../Components/Room/DirectChat/PartnerActions";
import { scriptUtils } from "../../Api/ScriptUtils";
import type { BotRoomLink } from "./BotRoomLink";

/**
 * Where a tap on a bot's room card takes you: to the bot itself while it is on a map (walking there, or travelling to
 * its map first), else into its room. "here" when you are already in that room and the bot isn't on the map.
 */
export function roomCardTarget(
    link: BotRoomLink,
    partner: DirectPartner | undefined,
    currentRoomUrl: string | undefined
): "bot" | "room" | "here" {
    if (partner?.actions.walkTo) return "bot";
    return currentRoomUrl === link.url ? "here" : "room";
}

export function visitBotRoom(
    link: BotRoomLink,
    partner: DirectPartner | undefined,
    currentRoomUrl: string | undefined
): void {
    const target = roomCardTarget(link, partner, currentRoomUrl);
    if (target === "bot" && partner) walkToPartner(partner);
    else if (target === "room") scriptUtils.goToPage(link.url);
}
