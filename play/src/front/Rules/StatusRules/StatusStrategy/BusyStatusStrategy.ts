import { AvailabilityStatus } from "@workadventure/messages";
import type { TimedRules } from "../statusRules";
import { askIfUserWantToJoinBubbleOf, askToChangeStatus } from "../statusChangerFunctions";
//import { helpNotificationSettingsVisibleStore } from "../../../Stores/HelpSettingsStore";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { popupStore } from "../../../Stores/PopupStore";
import NotificationPermissionModal from "../../../Components/ActionBar/AvailabilityStatus/Modals/NotificationPermissionModal.svelte";
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

    private NotificationPermissionIs = (permission: "denied" | "default" | "granted") => {
        if (!("Notification" in window)) return false;
        return Notification.permission === permission;
    };

    /**
     * Going Busy is the moment notifications matter, so that is when we ask. We keep asking, but not every time:
     * "Not now" (or ignoring the card) holds the question for a while. Someone who goes Busy for every meeting
     * would otherwise see it at each one, and the way out of that is the browser's own "Block", which is permanent.
     * Once the browser has blocked us, the card only offers the way to unblock it, so it comes back more rarely.
     */
    private static readonly ASK_AGAIN_AFTER_MS = 4 * 60 * 60 * 1000;
    private static readonly ASK_AGAIN_WHEN_BLOCKED_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

    private showNotificationPermissionModal = () => {
        if (!("Notification" in window) || this.NotificationPermissionIs("granted")) {
            return;
        }
        const lastRequest = localUserStore.getLastNotificationPermissionRequest();
        const lastRequestTime = lastRequest ? new Date(lastRequest).getTime() : Number.NaN;
        const holdFor = this.NotificationPermissionIs("denied")
            ? BusyStatusStrategy.ASK_AGAIN_WHEN_BLOCKED_AFTER_MS
            : BusyStatusStrategy.ASK_AGAIN_AFTER_MS;
        if (!Number.isNaN(lastRequestTime) && Date.now() - lastRequestTime < holdFor) {
            return;
        }
        this.openNotificationPermissionModal();
        localUserStore.setLastNotificationPermissionRequest();
    };

    private openNotificationPermissionModal = () => {
        popupStore.addPopup(NotificationPermissionModal, {}, "notification_permission_modal");
    };
}
