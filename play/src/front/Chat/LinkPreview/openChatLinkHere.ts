import { lowerChatSheet } from "../ChatSheetStore";
import { coWebsites, openedByPersonCoWebsite } from "../../Stores/CoWebsiteStore";
import { SimpleCoWebsite } from "../../WebRtc/CoWebsite/SimpleCoWebsite";

/** Opens a chat link in the Open here window. On a phone the page shows above the chat sheet, as a chat file does. */
export function openChatLinkHere(url: string, allowPolicy?: string): void {
    try {
        lowerChatSheet();
        coWebsites.add(openedByPersonCoWebsite(new SimpleCoWebsite(new URL(url), false, allowPolicy)));
    } catch (error) {
        console.error("Could not open a chat link beside the map", error);
    }
}
