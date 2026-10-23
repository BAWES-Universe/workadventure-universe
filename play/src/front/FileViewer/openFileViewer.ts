import { derived, get, type Readable } from "svelte/store";
import { coWebsites, fullScreenCowebsite } from "../Stores/CoWebsiteStore";
import { bringOpenHereInFront } from "../Stores/SideWindowInFrontStore";
import { FileViewerCoWebsite, type FileViewerSource } from "../WebRtc/CoWebsite/FileViewerCoWebsite";
import { saveMessageFiles } from "../Chat/Components/Room/MessageActions/availableActions";
import { extensionOf, fileKindOfLink, MAP_VIEWER_KINDS, textEncodingOf } from "./fileKinds";

/** The keys of the files the viewer has open now, for the cards of those files. */
export const openFileViewerKeys: Readable<ReadonlySet<string>> = derived(coWebsites, ($coWebsites) => {
    const keys = new Set<string>();
    for (const coWebsite of $coWebsites) {
        if (coWebsite instanceof FileViewerCoWebsite) keys.add(coWebsite.source.key);
    }
    return keys;
});

/** A phone held upright: the viewer takes the whole screen there, and Back gives it back. */
function isPhoneScreen(): boolean {
    return window.matchMedia?.("(max-width: 640px)").matches ?? false;
}

async function readBytes(response: Response): Promise<ArrayBuffer> {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
}

/** Opens a link in a new tab as a person's own click would, with no access back to the game. */
function openLinkInNewTab(link: string): void {
    window.open(link, "_blank", "noopener,noreferrer");
}

function downloadBytes(name: string, bytes: ArrayBuffer): void {
    // Always a download type: the file's bytes never get a navigable blob of their own type.
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// A text file opens in a new tab as plain text, whatever it holds: the browser shows it, and never runs it.
const PLAIN_TEXT = "text/plain";
const NEW_TAB_MIME_BY_EXTENSION: Record<string, string> = {
    pdf: "application/pdf",
    md: PLAIN_TEXT,
    txt: PLAIN_TEXT,
    csv: PLAIN_TEXT,
    json: PLAIN_TEXT,
};

/**
 * Hands a chat file to the browser's own viewer as a top-level tab, so drawing and signing stay one click away.
 * `tab` is a tab that was opened during the click; the file goes into it once it is read.
 */
function openBytesInNewTab(name: string, bytes: ArrayBuffer, tab: Window | null = null): void {
    const mimeType = NEW_TAB_MIME_BY_EXTENSION[extensionOf(name)];
    if (!mimeType) {
        tab?.close();
        downloadBytes(name, bytes);
        return;
    }
    // A text file says which Unicode form it is in up front: the tab is told the same, or UTF-16 would show as noise.
    const type = mimeType === PLAIN_TEXT ? `${PLAIN_TEXT};charset=${textEncodingOf(new Uint8Array(bytes))}` : mimeType;
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    if (tab) tab.location.href = url;
    else openLinkInNewTab(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Ctrl or Cmd click on a chat card: the file in the browser's own viewer, in a new tab. */
export function openChatFileInNewTab(file: { url: string; name: string }): void {
    // The tab opens now, inside the click: a tab opened after the file is read could be blocked as a pop-up.
    const tab = NEW_TAB_MIME_BY_EXTENSION[extensionOf(file.name)] ? window.open("about:blank", "_blank") : null;
    // The new tab must not reach back to the game.
    if (tab) tab.opener = null;
    fetch(file.url)
        .then(readBytes)
        .then((bytes) => openBytesInNewTab(file.name, bytes, tab))
        .catch((error) => {
            tab?.close();
            console.warn("Could not open a chat file in a new tab", error);
        });
}

export interface ChatFileToOpen {
    /** The blob: URL chat already fetched the file into (with the sign-in token, so none goes into a link). */
    url: string;
    name: string;
    senderName?: string;
    sentByMe?: boolean;
}

/** Opens a chat file beside the map. Calling it again for the file that is open brings that panel back instead. */
export function openChatFileInViewer(file: ChatFileToOpen): void {
    const key = `chat:${file.url}`;
    const existing = get(coWebsites).find(
        (coWebsite) => coWebsite instanceof FileViewerCoWebsite && coWebsite.source.key === key
    );
    if (existing) {
        // Already open: with other panels open, it moves to the end, where the container shows the newest panel.
        if (get(coWebsites).length > 1) {
            coWebsites.remove(existing);
            coWebsites.add(existing);
        }
        // Tapped again with Orbit in front of the window: the window comes forward with the file.
        bringOpenHereInFront();
        return;
    }
    const source: FileViewerSource = {
        key,
        name: file.name,
        senderName: file.senderName,
        sentByMe: file.sentByMe,
        load: async (signal) => readBytes(await fetch(file.url, { signal })),
        // The same save as the card's Download button and the message menu: the share sheet on phones.
        download: () => saveMessageFiles([{ url: file.url, name: file.name }]),
        openInNewTab: (bytes) => {
            if (bytes) openBytesInNewTab(file.name, bytes);
        },
    };
    const coWebsite = new FileViewerCoWebsite(source);
    if (isPhoneScreen() && !get(fullScreenCowebsite)) {
        coWebsite.openedFullScreen = true;
        fullScreenCowebsite.set(true);
    }
    coWebsites.add(coWebsite);
}

export interface MapFileToOpen {
    /** The file's link with the map storage pass (`?token=`) that lets this player read it. */
    link: string;
    width?: number;
    closable?: boolean;
    hideUrl?: boolean;
}

/** The file name a map file link ends with. */
export function mapFileName(link: string): string {
    const path = link.split(/[?#]/)[0];
    const last = path.substring(path.lastIndexOf("/") + 1) || "file";
    try {
        return decodeURIComponent(last);
    } catch {
        return last;
    }
}

/**
 * A map object's or zone's file, for the viewer. The caller adds it to the panels like any other co-website, and
 * keeps the object's or zone's own options (width, can be closed, Hide URL, triggers).
 */
export function createMapFileViewer({ link, width, closable, hideUrl }: MapFileToOpen): FileViewerCoWebsite {
    const name = mapFileName(link);
    const source: FileViewerSource = {
        key: `map:${link.split(/[?#]/)[0]}`,
        name,
        // The map storage allows this fetch from the game (it answers with CORS headers).
        load: async (signal) => readBytes(await fetch(link, { signal })),
        // Hide URL keeps the address out of reach, so a file that could not be read has no link to fall back to.
        download: (bytes) => {
            if (bytes) downloadBytes(name, bytes);
            else if (!hideUrl) openLinkInNewTab(link);
        },
        downloadNeedsFile: hideUrl,
        // Hide URL keeps the address out of reach, as the panel's copy and open buttons did.
        openInNewTab: hideUrl ? undefined : () => openLinkInNewTab(link),
        openInNewTabFromLink: true,
    };
    return new FileViewerCoWebsite(source, width, closable, hideUrl);
}

/** Whether the viewer can show a map file with this link (a PDF or a picture). */
export function mapFileOpensInViewer(link: string): boolean {
    const kind = fileKindOfLink(link);
    return kind !== undefined && MAP_VIEWER_KINDS.has(kind);
}
