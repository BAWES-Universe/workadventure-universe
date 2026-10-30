import type { Readable } from "svelte/store";
import type { SharedItem } from "../../Chat/Components/Room/Details/SharedItems";
import type { ChatFileToOpen } from "../../FileViewer/openFileViewer";
import { SimpleCoWebsite } from "./SimpleCoWebsite";

/** A song or other audio file, played in the window from the link chat already holds: nothing is read first. */
export interface FileViewerAudio {
    url: string;
    /** The songs of the chat it was shared in (as its Files list them) and its own key there, for the window's list. */
    inChat?: { tracks: Readable<SharedItem[]>; key: string };
    /** Picked from the window's own list of songs: it starts at once. */
    startPlaying?: boolean;
    /** Opens another of the chat's songs in its place. */
    openOther: (file: ChatFileToOpen) => void;
}

/** Where a file the viewer shows comes from, and what its Download and Open in new tab buttons do. */
export interface FileViewerSource {
    /** Identifies the file, so the chat card of the file that is open shows as open. */
    key: string;
    /** The file's real name, shown in the header and used when saving. */
    name: string;
    /** Who sent the file, for chat files. */
    senderName?: string;
    /** The file was sent by the person looking at it ("From you"). */
    sentByMe?: boolean;
    /** Set for an audio file, which the window plays instead of reading. */
    audio?: FileViewerAudio;
    /** Fetches the file's bytes. Rejects when the file cannot be read. */
    load: (signal: AbortSignal) => Promise<ArrayBuffer>;
    /** Saves the file under its real name. `bytes` is undefined when the file could not be read. */
    download: (bytes: ArrayBuffer | undefined) => Promise<void> | void;
    /** Saving needs the file read first: with Hide URL there is no link to fall back to when it could not be. */
    downloadNeedsFile?: boolean;
    /** Opens the file in the browser's own viewer in a new tab. Undefined when there is no such way (Hide URL). */
    openInNewTab?: (bytes: ArrayBuffer | undefined) => void;
    /** The new tab opens the file's link, so it works even when the viewer could not read the file. */
    openInNewTabFromLink?: boolean;
}

/**
 * A file shown by the file viewer beside the map, instead of in a frame: a PDF, a picture, and later the other
 * readable kinds. The viewer draws the file in the page itself from its bytes.
 */
export class FileViewerCoWebsite extends SimpleCoWebsite {
    constructor(
        public readonly source: FileViewerSource,
        widthPercent?: number,
        closable?: boolean,
        hideUrl?: boolean
    ) {
        // The file's bytes come from the source, never from this address, so there is nothing to load or leak.
        super(new URL("about:blank"), false, undefined, widthPercent, closable, hideUrl);
    }
}
