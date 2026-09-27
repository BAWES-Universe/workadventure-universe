import { AvailabilityStatus } from "@workadventure/messages";
import type { TranslationFunctions } from "../../../../i18n/i18n-types";

/** The words the People tab shows for a status. */
export function statusLabel(status: AvailabilityStatus, ll: TranslationFunctions): string {
    switch (status) {
        case AvailabilityStatus.ONLINE:
            return ll.chat.status.online();
        case AvailabilityStatus.AWAY:
            return ll.chat.status.away();
        case AvailabilityStatus.BUSY:
            return ll.chat.status.busy();
        case AvailabilityStatus.DO_NOT_DISTURB:
            return ll.chat.status.do_not_disturb();
        case AvailabilityStatus.BACK_IN_A_MOMENT:
            return ll.chat.status.back_in_a_moment();
        case AvailabilityStatus.JITSI:
        case AvailabilityStatus.BBB:
        case AvailabilityStatus.LIVEKIT:
            return ll.chat.status.meeting();
        case AvailabilityStatus.SPEAKER:
            return ll.chat.status.megaphone();
        case AvailabilityStatus.SILENT:
            return ll.chat.status.silent();
        default:
            return ll.chat.status.unavailable();
    }
}
