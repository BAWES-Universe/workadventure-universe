import { artifactIdOfLink, refreshLinkedArtifactCard } from "./artifactLinkCard";
import { openArtifactFromCard } from "./openArtifact";

/**
 * An object's link to an artifact's share address, `<Orbit>/a/<id>` (game #1737). That page is never framed, so the
 * object opens the game's own artifact window instead, the one its card in chat opens. Orbit decides for this person,
 * with the same rules as a link pasted in chat; when they may not open it from here, the link opens in a new tab, where
 * the page says what it says to anyone. False when the link is not an artifact's share address.
 */
export function openArtifactLink(link: string, openTab: (url: string) => void): boolean {
    const id = artifactIdOfLink(link);
    if (!id) return false;
    refreshLinkedArtifactCard(id, undefined)
        .then((card) => {
            if (card) openArtifactFromCard(card, undefined);
            else openTab(link);
        })
        .catch((error) => console.error(error));
    return true;
}
