import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { ArtifactOpenScope, ArtifactPublished } from "./ArtifactApi";

/**
 * What "Send to…" was asked to send, from the three places that offer it: a document's Download list, the file viewer's
 * header and the menu of a file card in a chat. The sheet that asks who and what is one, drawn once for the whole game.
 */
export interface SendToRequest {
    /** The file's name, as the receiver will see it. */
    fileName: string;
    /** Makes the file when Send is pressed, so nothing is read for a list that is only looked at. */
    makeFile: () => Promise<File>;
    /** Set for a document: a link to it can go instead of, or with, the file. A chat file has none. */
    link?: {
        url: string;
        openScope: ArtifactOpenScope | string | undefined;
        /** The person looking is the document's owner (only the owner is told what was published). */
        owner: boolean;
        published: ArtifactPublished | null | undefined;
        /** The newest version's number. */
        latest: number;
    };
}

const request = writable<SendToRequest | undefined>(undefined);
/** The request the open sheet is for; nothing when the sheet is closed. */
export const sendToRequest: Readable<SendToRequest | undefined> = { subscribe: request.subscribe };

export function openSendTo(next: SendToRequest): void {
    request.set(next);
}

export function closeSendTo(): void {
    request.set(undefined);
}
