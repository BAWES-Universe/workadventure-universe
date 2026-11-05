import { get } from "svelte/store";
import { lowerChatSheet } from "../Chat/ChatSheetStore";
import { coWebsites, openedByPersonCoWebsite } from "../Stores/CoWebsiteStore";
import { bringOpenHereInFront } from "../Stores/SideWindowInFrontStore";
import { ArtifactCoWebsite, type ArtifactSummary } from "../WebRtc/CoWebsite/ArtifactCoWebsite";
import type { ArtifactChat } from "./ArtifactApi";
import type { ArtifactCard } from "./artifactCard";

/** The artifact's window that is open, if any. */
export function openArtifactWindow(id: string): ArtifactCoWebsite | undefined {
    return get(coWebsites).find((coWebsite): coWebsite is ArtifactCoWebsite => {
        return coWebsite instanceof ArtifactCoWebsite && coWebsite.artifactId === id;
    });
}

/**
 * Opens a card's artifact in the window, at the version the card names. Tapping the card of the one that is open
 * brings that panel back instead (at that card's version). On a phone the chat sheet drops to its lowest height so the
 * artifact shows above it.
 */
export function openArtifactFromCard(card: ArtifactCard, chat: ArtifactChat | undefined, makerName?: string): void {
    openArtifact(
        card.id,
        chat,
        { title: card.title, kind: card.kind, makerName: card.maker ?? makerName },
        card.version
    );
}

/**
 * Opens an artifact's latest version in the window from its share link, as an object on the map links to it (game
 * #1737). Nothing is asked first: the window asks the game's server, and when this person may not open it, the window
 * says so. The title shows until the window knows the artifact's own. When its window is already open, it comes back to
 * the front as it is.
 */
export function openArtifactFromLink(id: string, title: string): void {
    openArtifact(id, undefined, { title, kind: undefined, makerName: undefined }, undefined);
}

function openArtifact(
    id: string,
    chat: ArtifactChat | undefined,
    summary: ArtifactSummary,
    version: number | undefined
): void {
    lowerChatSheet();
    const existing = openArtifactWindow(id);
    if (existing) {
        // From a link no version is named: the open window comes back as it is, at the version it shows
        if (version !== undefined) existing.version.set(version);
        if (chat) existing.chat = chat;
        // With other panels open, it moves to the end, where the container shows the newest panel.
        if (get(coWebsites).length > 1) {
            coWebsites.remove(existing);
            coWebsites.add(existing);
        }
        bringOpenHereInFront();
        return;
    }
    coWebsites.add(openedByPersonCoWebsite(new ArtifactCoWebsite(id, chat, summary, version)));
}
