import { AvailabilityStatus } from "@workadventure/messages";
import type { TimedRules } from "../statusRules";
import { askIfUserWantToJoinBubbleOf, askToChangeStatus } from "../statusChangerFunctions";
import { askForNotifications } from "../../../Notification/Push/NotificationAsk";
import { BasicStatusStrategy } from "./BasicStatusStrategy";

export class BusyStatusStrategy extends BasicStatusStrategy {
    constructor(
        protected status: AvailabilityStatus = AvailabilityStatus.BUSY,
        protected basicRules: Array<() => void> = [],
        protected timedRules: Array<TimedRules> = [],
        protected interactionRules: Array<() => void> = []
    ) {
        super(status, basicRules, timedRules, interactionRules);
        timedRules.push({
            rule: askToChangeStatus,
            applyIn: this.toMilliseconds(1, 0, 0),
        });

        interactionRules.push(() => {
            askIfUserWantToJoinBubbleOf(this.userNameInteraction);
        });

        this.basicRules.push(this.showNotificationPermissionModal);
    }

    allowNotificationSound(): boolean {
        return true;
    }

    /** Going Busy is a moment notifications matter: the card asks, held for a while after Not now (NotificationAsk). */
    private showNotificationPermissionModal = () => {
        askForNotifications({ kind: "busy" });
    };
}
