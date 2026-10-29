import { get } from "svelte/store";
import { lowerChatSheet } from "../Chat/ChatSheetStore";
import { coWebsites, openedByPersonCoWebsite } from "../Stores/CoWebsiteStore";
import { bringOpenHereInFront } from "../Stores/SideWindowInFrontStore";
import { ArtifactCoWebsite } from "../WebRtc/CoWebsite/ArtifactCoWebsite";
import type { ArtifactChat } from "./ArtifactApi";
import type { ArtifactCard } from "./artifactCard";

/** The artifact's window that is open, if any. */
export function openArtifactWindow(id: string): ArtifactCoWebsite | undefined {
    return get(coWebsites).find((coWebsite): coWebsite is ArtifactCoWebsite => {
        return coWebsite instanceof ArtifactCoWebsite && coWebsite.artifactId === id;
    });
}

/**
 * Opens a card's artifact in the window, at the version the card names, or at whatever is latest for a pasted share
 * link (`atLatest`, game #1582), since that is what the link means. Tapping the card of the one that is open brings
 * that panel back instead (at that card's version). On a phone the chat sheet drops to its lowest height so the
 * artifact shows above it.
 */
export function openArtifactFromCard(
    card: ArtifactCard,
    chat: ArtifactChat | undefined,
    makerName?: string,
    atLatest = false
): void {
    lowerChatSheet();
    const version = atLatest ? undefined : card.version;
    const existing = openArtifactWindow(card.id);
    if (existing) {
        existing.version.set(version);
        if (chat) existing.chat = chat;
        // With other panels open, it moves to the end, where the container shows the newest panel.
        if (get(coWebsites).length > 1) {
            coWebsites.remove(existing);
            coWebsites.add(existing);
        }
        bringOpenHereInFront();
        return;
    }
    coWebsites.add(
        openedByPersonCoWebsite(
            new ArtifactCoWebsite(
                card.id,
                chat,
                { title: card.title, kind: card.kind, makerName: card.maker ?? makerName },
                version
            )
        )
    );
}
