import { AvailabilityStatus } from "@workadventure/messages";
import type { TimedRules } from "../statusRules";
import { askIfUserWantToJoinBubbleOf, askToChangeStatus } from "../statusChangerFunctions";
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
        // Loaded when needed: statuses load with the local store, which nearly everything imports, and the card brings
        // the menu, the install wiring and Orbit's client with it
        import("../../../Notification/Push/NotificationAsk")
            .then(({ askForNotifications }) => askForNotifications({ kind: "busy" }))
            .catch((error) => console.error(error));
    };
}
