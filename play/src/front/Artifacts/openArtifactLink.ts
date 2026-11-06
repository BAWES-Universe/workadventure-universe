import { artifactIdOfLink } from "./artifactLinkCard";
import { openArtifactFromLink } from "./openArtifact";

/**
 * An object's link to an artifact's share address, `<Orbit>/a/<id>` (game #1737). That page is never framed, so the
 * object opens the game's own artifact window instead, the one its card in chat opens, at once on the tap. The window
 * asks the game's server, which lets this person open it or not with the same rules as a link pasted in chat. False
 * when the link is not an artifact's share address.
 */
export function openArtifactLink(link: string, title: string): boolean {
    const id = artifactIdOfLink(link);
    if (!id) return false;
    openArtifactFromLink(id, title);
    return true;
}
