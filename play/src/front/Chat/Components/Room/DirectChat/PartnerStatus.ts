import type { TranslationFunctions } from "../../../../../i18n/i18n-types";
import { getColorHexOfStatus, getStatusLabel } from "../../../../Utils/AvailabilityStatus";
import type { PartnerPlace } from "./PartnerPlace";

const ONLINE_GREEN = "#68e97a";
const TALKING_BLUE = "#4156f6";

/** The status line under their name, and the colour of its dot (none when they're offline). */
export function partnerStatus(place: PartnerPlace, ll: TranslationFunctions): { label: string; color?: string } {
    const status = ll.chat.directChat.status;
    const withRoom = (label: string, roomName?: string) =>
        roomName ? `${label}${ll.chat.topRow.separator()}${roomName}` : label;
    switch (place.kind) {
        case "talking":
            return { label: status.talking(), color: TALKING_BLUE };
        case "here":
            return {
                label: place.roomName ? status.here({ room: place.roomName }) : status.hereNoRoom(),
                color: ONLINE_GREEN,
            };
        case "elsewhere":
            return {
                label: place.roomName ? status.elsewhere({ room: place.roomName }) : status.online(),
                color: ONLINE_GREEN,
            };
        case "away":
        case "busy":
            return {
                label: withRoom(getStatusLabel(place.status), place.roomName),
                color: getColorHexOfStatus(place.status),
            };
        case "chatOnly":
            return {
                label: `${status.online()}${ll.chat.topRow.separator()}${status.chatOnly()}`,
                color: ONLINE_GREEN,
            };
        case "offline":
            return { label: status.offline() };
    }
}
