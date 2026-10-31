import { derived } from "svelte/store";
import { SimpleCoWebsite } from "../WebRtc/CoWebsite/SimpleCoWebsite";
import type { CoWebsite } from "../WebRtc/CoWebsite/CoWebsite";
import { coWebsites } from "./CoWebsiteStore";
import { openHereSheetStore } from "./OpenHereSheetStore";
import { openHereTuckedStore } from "./SideWindowInFrontStore";

/**
 * "Hide title bar" (#1682): a page a map opens with the switch on fills the window, with no row (icon, name, URL line)
 * above it, but only while it is the one thing open. Opening anything else brings the row (and the tabs) back; closing
 * that leaves the page alone, and the row hides again. Pure where it can be, so it can be unit tested.
 *
 * `tucked` is a phone's sheet put away into a slim row above the bar: that row is the item's own, so it shows then.
 */
export function titleBarHiddenItem(items: readonly CoWebsite[], tucked = false): CoWebsite | undefined {
    if (tucked || items.length !== 1) return undefined;
    const [only] = items;
    return only instanceof SimpleCoWebsite && only.getHideTitleBar() ? only : undefined;
}

/** The item whose title bar is left out right now, if any. */
export const titleBarHiddenItemStore = derived(
    [coWebsites, openHereSheetStore, openHereTuckedStore],
    ([$coWebsites, $sheet, $tucked]) => titleBarHiddenItem($coWebsites, $sheet && $tucked)
);
