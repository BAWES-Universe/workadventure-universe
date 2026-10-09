import { connectionManager } from "../../Connection/ConnectionManager";
import { extractChatLinks, withoutTrailingLink } from "./ChatLinks";
import type { LinkKind } from "./LinkKind";
import { classifyLink } from "./LinkKind";

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
export function previewedLinkOf(body: string): string | undefined {
    return extractChatLinks(body, 1)[0];
}

/**
 * The message text as shown above its card. A video or app link that ends the message is shown by its card alone,
 * as in the approved mock. Web pages and images keep their link: their card can fail to load.
 */
export function bodyShownWithCard(body: string): string {
    const url = previewedLinkOf(body);
    if (!url) return body;
    const kind = classifyChatLink(url).kind;
    if (kind !== "youtube" && kind !== "app") return body;
    return withoutTrailingLink(body, url) ?? body;
}
