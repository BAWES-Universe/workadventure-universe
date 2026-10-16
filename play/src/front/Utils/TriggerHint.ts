import { get } from "svelte/store";
import LL from "../../i18n/i18n-svelte";
import { isTouchDevice } from "./TouchDevice";

export type TriggerHintKind = "object" | "cowebsite" | "jitsiRoom" | "newTab";

/** The default hint for something the player can open: "Tap to ..." on a touch screen, "Press [SPACE] to ..." elsewhere. */
export function getTriggerHint(kind: TriggerHintKind): string {
    const trigger = get(LL).trigger;
    return isTouchDevice() ? trigger.mobile[kind]() : trigger[kind]();
}
