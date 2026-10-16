import { connectionManager } from "../../Connection/ConnectionManager";
import { extractChatLinks, withoutTrailingLink } from "./ChatLinks";
import type { LinkKind } from "./LinkKind";
import { classifyLink, isGifSiteImage } from "./LinkKind";

/** What a chat link is (a video, an app this room allows, an image or a web page), for its card. */
export function classifyChatLink(url: string): LinkKind {
    return classifyLink(url, {
        youtube: connectionManager.youtubeToolActivated,
        googleDocs: connectionManager.googleDocsToolActivated,
        googleSheets: connectionManager.googleSheetsToolActivated,
        googleSlides: connectionManager.googleSlidesToolActivated,
        googleDrive: connectionManager.googleDriveToolActivated,
        klaxoon: connectionManager.klaxoonToolActivated,
        klaxoonClientId: connectionManager.klaxoonToolClientId,
        eraser: connectionManager.eraserToolActivated,
        excalidraw: connectionManager.excalidrawToolActivated,
        excalidrawDomains: connectionManager.excalidrawToolDomains,
        cards: connectionManager.cardsToolActivated,
        tldraw: connectionManager.tldrawToolActivated,
        custom: connectionManager.applications,
    });
}

/** The link a message previews: its first link not sent without a preview. */
export function previewedLinkOf(body: string | undefined): string | undefined {
    if (typeof body !== "string") return undefined;
    return extractChatLinks(body, 1)[0];
}

/**
 * The message text as shown above its card. A video or app link that ends the message is shown by its card alone,
 * as in the approved mock, and so is a GIF from a GIF site (the chat's GIF picker sends one). Web pages and other
 * images keep their link: their card can fail to load.
 */
export function bodyShownWithCard<Body extends string | undefined>(body: Body): Body | string {
    if (typeof body !== "string") return body;
    try {
        const url = previewedLinkOf(body);
        if (!url) return body;
        const kind = classifyChatLink(url).kind;
        // A GIF from a GIF site is the message: its address isn't shown above it.
        const gif = kind === "image" && isGifSiteImage(url);
        if (kind !== "youtube" && kind !== "app" && !gif) return body;
        return withoutTrailingLink(body, url) ?? body;
    } catch (error) {
        // A link the card can't read never hides the message.
        console.error("Could not read a chat message's link", error);
        return body;
    }
}
