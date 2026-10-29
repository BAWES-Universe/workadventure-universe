import { get } from "svelte/store";
import { lowerChatSheet } from "../Chat/ChatSheetStore";
import { coWebsites, openedByPersonCoWebsite } from "../Stores/CoWebsiteStore";
import { bringOpenHereInFront } from "../Stores/SideWindowInFrontStore";
import { YourArtifactsCoWebsite } from "../WebRtc/CoWebsite/YourArtifactsCoWebsite";
import { yourArtifactsList } from "./chatArtifactsList";

/**
 * Opens Your artifacts in the window (game #1609), read again from the top so what changed since shows. When it is
 * open already, it comes back to the front instead. On a phone the chat sheet drops to its lowest height, as it does
 * for an artifact.
 */
export function openYourArtifacts(): void {
    lowerChatSheet();
    yourArtifactsList()
        .refresh()
        .catch((error) => console.error(error));
    const existing = get(coWebsites).find((coWebsite) => coWebsite instanceof YourArtifactsCoWebsite);
    if (existing) {
        // With other panels open, it moves to the end, where the container shows the newest panel.
        if (get(coWebsites).length > 1) {
            coWebsites.remove(existing);
            coWebsites.add(existing);
        }
        bringOpenHereInFront();
        return;
    }
    coWebsites.add(openedByPersonCoWebsite(new YourArtifactsCoWebsite()));
}
