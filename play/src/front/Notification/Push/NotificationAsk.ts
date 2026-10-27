import { localUserStore } from "../../Connection/LocalUserStore";
import type { PartnerPlace } from "../../Chat/Components/Room/DirectChat/PartnerPlace";
import { popupStore } from "../../Stores/PopupStore";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { raceTimeout } from "../../Utils/PromiseUtils";
import NotificationCard from "./NotificationCard.svelte";
import { pushAvailability, refreshThisDevice } from "./PushDevice";

/**
 * When Universe offers notifications (#863): only right after something a notification helps with, in our own card
 * first; the browser's box comes only after Turn on. Never on arrival, on a timer or to guests. Not now holds every
 * moment for 4 hours, and 14 days once the browser has blocked us, as the Busy card always did.
 */
export type NotificationMoment =
    /** You set yourself Busy */
    | { kind: "busy" }
    /** You sent a friend request */
    | { kind: "friendRequest"; name: string }
    /** You wrote to someone who isn't in Universe, or to a bot */
    | { kind: "reply"; name: string; bot: boolean };

export const NOTIFICATION_CARD_ID = "notification_permission_modal";
export const ASK_AGAIN_AFTER_MS = 4 * 60 * 60 * 1000;
export const ASK_AGAIN_WHEN_BLOCKED_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
/** The card waits this long at most to know whether this server sends notifications while Universe is closed. */
export const ORBIT_ANSWER_WITHIN_MS = 3000;

function permission(): NotificationPermission | undefined {
    return typeof window !== "undefined" && "Notification" in window ? Notification.permission : undefined;
}

/** Whether a moment shows the card now. */
export function shouldAsk(
    now: number,
    lastAsked: string | null,
    availability = pushAvailability(),
    current = permission()
): boolean {
    if (availability === "unsupported" || current === "granted") return false;
    const lastTime = lastAsked ? new Date(lastAsked).getTime() : Number.NaN;
    const holdFor = current === "denied" ? ASK_AGAIN_WHEN_BLOCKED_AFTER_MS : ASK_AGAIN_AFTER_MS;
    return Number.isNaN(lastTime) || now - lastTime >= holdFor;
}

export function askForNotifications(moment: NotificationMoment): void {
    if (!localUserStore.isLogged()) return;
    if (permission() === "granted") {
        // Already on here: nothing to ask, but make sure Orbit still has this browser.
        refreshThisDevice().catch(() => undefined);
        return;
    }
    if (!shouldAsk(Date.now(), localUserStore.getLastNotificationPermissionRequest())) return;
    localUserStore.setLastNotificationPermissionRequest();
    // A server that sends none while Universe is closed (no Orbit, or no keys there): the card only promises them
    // while it is open. Orbit not answering, or not in time, is not known to be that.
    raceTimeout(botApiService.getPushPublicKey(), ORBIT_ANSWER_WITHIN_MS)
        .catch(() => undefined)
        .then((publicKey) => {
            popupStore.removePopup(NOTIFICATION_CARD_ID);
            popupStore.addPopup(NotificationCard, { moment, whileClosed: publicKey !== null }, NOTIFICATION_CARD_ID);
        })
        .catch((error) => console.error(error));
}

/** Writing in a direct chat is a moment when the other one is a bot, or isn't in Universe to answer now. */
export function replyMoment(
    partner: { isBot: boolean; place: PartnerPlace },
    name: string
): NotificationMoment | undefined {
    if (!name) return undefined;
    if (partner.isBot) return { kind: "reply", name, bot: true };
    if (partner.place.kind === "offline" || partner.place.kind === "chatOnly")
        return { kind: "reply", name, bot: false };
    return undefined;
}
