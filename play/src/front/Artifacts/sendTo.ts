import type { ChatRoom } from "../Chat/Connection/ChatConnection";
import type { BrickCard } from "../Chat/Bricks/Brick";
import { ownBrickInChat } from "../Chat/Bricks/Brick";
import type { TranslationFunctions } from "../../i18n/i18n-types";
import { sanitizeInlineMimeType } from "../Utils/InlineMimeType";
import type { ArtifactOpenScope, ArtifactPublished } from "./ArtifactApi";

/**
 * "Send to…" (game #2160's follow-up): a document or a file in a chat goes to a friend, a chat or a Brick. Nothing in here
 * reads a store or talks to a server, so every rule can be unit tested.
 */

/**
 * Who a chat is with, for what a link to a document can do there:
 * - `myBrick`: just the person and one of their own Bricks. Their Brick may read a "Just you" document they point it at.
 * - `person`: one other person, or a Brick that is not theirs. Someone else's Brick is treated like a person: it is asked on
 *   behalf of whoever wrote to it, never as the owner of the document.
 * - `group`: more people. A Brick in a group reads as nobody in particular, so a private document would not open for it.
 */
export type Receiver = "person" | "group" | "myBrick";

/** Whether the chat is a direct chat or a group, as the chat server lists it. */
export type ChatKind = ChatRoom["type"];

/**
 * Who the chat is with. `memberIds` are the chat addresses of everyone in it (the person's own included, which is left
 * out). A chat whose one other member is one of the person's own Bricks is that Brick's chat, whatever type the server gives
 * it. Members that have not arrived yet make a person (a chat with a warning is the safe default).
 */
export function receiverOf(
    kind: ChatKind,
    memberIds: readonly string[],
    myChatId: string | null | undefined,
    bricksByChatId: ReadonlyMap<string, BrickCard>
): Receiver {
    if (ownBrickInChat(memberIds, myChatId, bricksByChatId)) return "myBrick";
    return kind === "direct" ? "person" : "group";
}

/**
 * Who sees "Send to…" on a document: its owner always, and anyone else only while the document opens by its link. On a
 * document that only people in its chat can open, a Send to from someone else would pass it on past the owner's choice.
 */
export function mayOfferSendTo(access: { owner: boolean; openScope: ArtifactOpenScope | string | undefined }): boolean {
    return access.owner || access.openScope === "link" || access.openScope === "public";
}

/** The plain line under "A link to this doc", one for each thing a link can do for this receiver. */
export type SendLinkLine =
    /** Only the owner can open it, and the receiver is the owner's own Brick in a chat of just the two. */
    | { kind: "myBrick" }
    /** Only the owner can open it, and the receiver is someone else. */
    | { kind: "justYou" }
    /** Only people in the chat it was made in can open it. */
    | { kind: "chat" }
    /** Anyone with the link opens the latest version. */
    | { kind: "latest" }
    /** Anyone with the link opens the version the owner published, which `behind` says is not the latest. */
    | { kind: "published"; version: number; behind: boolean }
    /** Public, with nothing published: nobody else can open it. */
    | { kind: "nothingPublished" }
    /** Not the owner, who alone knows whether something was published: the owner's own choice is followed. */
    | { kind: "byOwner" };

export interface SendLinkChoice {
    /** The link can be chosen. A link that would open for nobody is shown with its line but cannot be chosen. */
    usable: boolean;
    line: SendLinkLine;
}

/**
 * What a link to the document does for this receiver: whether it can be chosen, and the one line that says why.
 * `published` is told to the owner only (so a non-owner gets the generic line), `latest` is the newest version number.
 */
export function sendLinkChoice(input: {
    openScope: ArtifactOpenScope | string | undefined;
    owner: boolean;
    receiver: Receiver;
    published: ArtifactPublished | null | undefined;
    latest: number;
}): SendLinkChoice {
    const { openScope, owner, receiver, latest } = input;
    const published = owner && input.published && input.published.available !== false ? input.published : undefined;
    const ownBrick: SendLinkChoice = { usable: true, line: { kind: "myBrick" } };
    switch (openScope) {
        case "link":
            if (!owner) return { usable: true, line: { kind: "byOwner" } };
            return {
                usable: true,
                line: published
                    ? { kind: "published", version: published.version, behind: published.version < latest }
                    : { kind: "latest" },
            };
        case "public":
            if (!owner) return { usable: true, line: { kind: "byOwner" } };
            if (published) {
                return {
                    usable: true,
                    line: { kind: "published", version: published.version, behind: published.version < latest },
                };
            }
            // Nothing published: it opens for nobody but its owner, whose own Brick still reads it
            return receiver === "myBrick" ? ownBrick : { usable: false, line: { kind: "nothingPublished" } };
        case "chat":
            return receiver === "myBrick" ? ownBrick : { usable: true, line: { kind: "chat" } };
        default:
            // "Just you", and anything this game does not know: kept to its owner
            return receiver === "myBrick" ? ownBrick : { usable: false, line: { kind: "justYou" } };
    }
}

/** The plain line for a link choice, in the person's words. `who` is the name of the chat it goes to. */
export function sendLinkWords(
    line: SendLinkLine,
    who: string,
    texts: Pick<
        TranslationFunctions["chat"]["sendTo"],
        | "linkMyBrick"
        | "linkJustYou"
        | "linkChat"
        | "linkLatest"
        | "linkPublished"
        | "linkPublishedBehind"
        | "linkNothing"
        | "linkByOwner"
    >
): string {
    switch (line.kind) {
        case "myBrick":
            return texts.linkMyBrick();
        case "justYou":
            return texts.linkJustYou({ who });
        case "chat":
            return texts.linkChat({ who });
        case "latest":
            return texts.linkLatest();
        case "published":
            return line.behind
                ? texts.linkPublishedBehind({ version: line.version })
                : texts.linkPublished({ version: line.version });
        case "nothingPublished":
            return texts.linkNothing();
        default:
            return texts.linkByOwner();
    }
}

/** One chat the person can send to, as the list needs to see it. */
export interface SendTarget {
    id: string;
    name: string;
    /** `brick`: a direct chat with a Brick (theirs or someone else's). */
    group: "brick" | "chat";
    /** When the last message was written, newest first. 0 when there is none. */
    timestamp: number;
}

/** The targets a search keeps, Bricks first and then the rest, each newest first. */
export function groupSendTargets(
    targets: readonly SendTarget[],
    search: string
): { bricks: SendTarget[]; chats: SendTarget[] } {
    const wanted = search.trim().toLocaleLowerCase();
    const kept = targets.filter((target) => wanted === "" || target.name.toLocaleLowerCase().includes(wanted));
    const newestFirst = (a: SendTarget, b: SendTarget) => b.timestamp - a.timestamp || a.name.localeCompare(b.name);
    return {
        bricks: kept.filter((target) => target.group === "brick").sort(newestFirst),
        chats: kept.filter((target) => target.group === "chat").sort(newestFirst),
    };
}

/** What goes: the file, the link, or both. */
export type SendPart = "file" | "link";

/** A chat that can take what "Send to…" sends, and say when it did not. Only a chat on the chat server can. */
export interface ForwardingRoom {
    /** The chat's own file send, which says when the file did not go. */
    sendFileOrThrow?: (file: File) => Promise<void>;
    /** Words as the person's own message, answered once the chat server has them. Never a reply, never a notice. */
    sendMessageConfirmed?: (message: string) => Promise<void>;
}

export interface SendResult {
    sent: SendPart[];
    failed: SendPart[];
}

/**
 * Sends what was chosen to one chat: the file through the chat's own file send, and the link as the person's own normal
 * message (a Brick reads links only from what the person wrote). Each part is tried on its own, so a file that did not go
 * does not hold back the link, and the answer says which went and which did not.
 */
export async function sendParts(
    room: ForwardingRoom,
    what: { makeFile?: () => Promise<File>; link?: string },
    parts: readonly SendPart[]
): Promise<SendResult> {
    const result: SendResult = { sent: [], failed: [] };
    // One at a time and in order: the file arrives before the link that points at the same thing
    /* eslint-disable no-await-in-loop */
    for (const part of parts) {
        try {
            if (part === "file") {
                if (!what.makeFile || !room.sendFileOrThrow) throw new Error("This chat cannot take a file");
                await room.sendFileOrThrow(await what.makeFile());
            } else {
                if (!what.link || !room.sendMessageConfirmed) throw new Error("This chat cannot take a link");
                await room.sendMessageConfirmed(what.link);
            }
            result.sent.push(part);
        } catch (error) {
            console.warn("Could not send to a chat", part, error);
            result.failed.push(part);
        }
    }
    /* eslint-enable no-await-in-loop */
    return result;
}

/**
 * A file made from a chat file's address, under the name it has: the same read Save does. Its type is kept only when it is a
 * passive one (a picture, song or video); a document type such as HTML goes on as a plain file.
 */
export async function fileFromAddress(url: string, name: string): Promise<File> {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return new File([blob], name, { type: sanitizeInlineMimeType(blob.type) });
}
