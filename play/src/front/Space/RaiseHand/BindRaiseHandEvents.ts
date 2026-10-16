import { get } from "svelte/store";
import type { SpaceInterface } from "../SpaceInterface";
import { notificationPlayingStore } from "../../Stores/NotificationStore";
import LL from "../../../i18n/i18n-svelte";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { lowerHand, myHandRaisedStore } from "./RaiseHandStore";

/**
 * A moderator can lower our hand, or everybody's. The pusher only lets these events through from admins.
 */
export function bindRaiseHandEventsToSpace(space: SpaceInterface): void {
    const loweredByModerator = () => {
        if (!get(myHandRaisedStore)) return;
        lowerHand();
        analyticsClient.lowerHand("moderator");
        notificationPlayingStore.playNotification(get(LL).say.raiseHand.loweredByModerator());
    };

    // We can safely ignore the subscription because it will be automatically completed when the space is destroyed.
    // eslint-disable-next-line rxjs/no-ignored-subscription,svelte/no-ignored-unsubscribe
    space.observePrivateEvent("lowerHand").subscribe(loweredByModerator);

    // We can safely ignore the subscription because it will be automatically completed when the space is destroyed.
    // eslint-disable-next-line rxjs/no-ignored-subscription,svelte/no-ignored-unsubscribe
    space.observePublicEvent("lowerAllHands").subscribe(loweredByModerator);
}
