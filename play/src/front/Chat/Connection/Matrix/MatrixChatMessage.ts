import type { MatrixEvent, Room } from "matrix-js-sdk";
import { Direction, EventStatus, EventType, MatrixEventEvent, MsgType, RelationType } from "matrix-js-sdk";
import type { Writable } from "svelte/store";
import { writable } from "svelte/store";
import { v4 as uuidv4 } from "uuid";
import { MapStore } from "@workadventure/store-utils";
import type { ChatMessage, ChatMessageContent, ChatMessageType, ChatUser } from "../ChatConnection";
import { chatUserFactory } from "./MatrixChatUser";
import { MatrixChatMessageReaction } from "./MatrixChatMessageReaction";
import { MatrixChatRelation } from "./MatrixChatRelation";
import type { MatrixMediaHold } from "./MatrixMedia";
import { holdMatrixMedia } from "./MatrixMedia";

/** My reaction with one emoji: what the last click asked for, and the event that is on the server now. */
interface MyReaction {
    want: boolean;
    eventId: string | undefined;
    clicks: number;
    sync: Promise<void> | undefined;
}

/** Clicks closer together than this count as one burst: only where the burst ends is sent. */
const REACTION_BURST_MS = 300;

export class MatrixChatMessage implements ChatMessage {
    id: string;
    content: Writable<ChatMessageContent>;
    sender: ChatUser | undefined;
    isMyMessage: boolean;
    date: Date | null;
    isQuotedMessage: boolean | undefined;
    quotedMessage: ChatMessage | undefined;
    type: ChatMessageType;
    isDeleted: Writable<boolean>;
    isModified: Writable<boolean>;
    reactions: MapStore<string, MatrixChatMessageReaction>;
    relations: MatrixChatRelation | undefined;
    readonly canDelete: Writable<boolean>;
    readonly canReact = writable(true);
    readonly canReply = writable(true);
    private isShown = false;
    private mediaHold: MatrixMediaHold | undefined;
    private myReactions = new Map<string, MyReaction>();

    /** In a direct chat (isDirect), only the person who sent a message can delete it. */
    constructor(private event: MatrixEvent, private room: Room, isQuotedMessage?: boolean, private isDirect = false) {
        this.id = event.getId() ?? uuidv4();
        this.type = this.mapMatrixMessageTypeToChatMessage();
        this.date = event.getDate();
        this.sender = this.getSender();
        this.isMyMessage = this.room.client.getUserId() === event.getSender();
        this.content = this.initMessageContent();
        this.isQuotedMessage = isQuotedMessage;
        this.isDeleted = writable(this.getIsDeleted());
        this.isModified = writable(this.getIsModified());
        this.reactions = new MapStore<string, MatrixChatMessageReaction>();

        const myRoomMember = room.getMember(room.client.getSafeUserId());
        const senderRoomMember = room.getMember(this.sender?.chatId || "");

        let myPowerLevel = 0;
        let senderPowerLevel = 0;

        if (myRoomMember) {
            myPowerLevel = myRoomMember.powerLevelNorm;
        }

        if (senderRoomMember) {
            senderPowerLevel = senderRoomMember.powerLevelNorm;
        }

        const hasSufficientPowerLevel =
            this.room
                .getLiveTimeline()
                .getState(Direction.Backward)
                ?.hasSufficientPowerLevelFor("redact", myPowerLevel) ?? false;

        // In a group, a moderator can delete others' messages. In a DM, whoever started it is admin in Matrix
        // (older DMs), and that must not let them delete what the other person sent.
        this.canDelete = writable(
            this.isMyMessage || (!this.isDirect && hasSufficientPowerLevel && myPowerLevel > senderPowerLevel)
        );

        event.on(MatrixEventEvent.Decrypted, () => {
            this.updateMessageContentOnDecryptedEvent();
        });

        this.initReactions();
    }

    private getSender() {
        let messageUser;
        const senderUserId = this.event.getSender();
        if (senderUserId) {
            const matrixUser = this.room.client.getUser(senderUserId);
            messageUser = matrixUser ? chatUserFactory(matrixUser, this.room.client) : undefined;
        }
        return messageUser;
    }

    private initMessageContent(): Writable<ChatMessageContent> {
        // The file is only downloaded once the message is shown, and kept while it is.
        return writable(this.getMessageContent(), (set, update) => {
            this.isShown = true;
            this.loadMediaUrl();
            return () => {
                this.isShown = false;
                this.releaseMedia();
                // Its URL may be released from now on: shown again, the message waits for a fresh one.
                update((content) => (content.url === undefined ? content : { ...content, url: undefined }));
            };
        });
    }

    private updateMessageContentOnDecryptedEvent() {
        // Until it is decrypted, the event's type is m.room.encrypted: an image or file only shows as one now.
        this.type = this.mapMatrixMessageTypeToChatMessage();
        this.content.set(this.getMessageContent());
        this.loadMediaUrl();
    }

    /** Files need the access token to download (authenticated media): the URL arrives once fetched. */
    private loadMediaUrl() {
        this.releaseMedia();
        if (!this.isShown || this.type === "text" || this.event.isDecryptionFailure()) return;
        const content = this.event.getOriginalContent();
        // In an encrypted chat, files sent by other apps (Element) are encrypted too: they come as `file`, not `url`.
        const info: unknown = content.info;
        const mimetype =
            typeof info === "object" && info !== null ? (info as Record<string, unknown>).mimetype : undefined;
        const hold = holdMatrixMedia(
            this.room.client,
            content.url ?? content.file,
            typeof mimetype === "string" ? mimetype : undefined
        );
        this.mediaHold = hold;
        hold.url
            .then((url) => {
                if (url === undefined || this.mediaHold !== hold) return;
                this.content.update((content) => ({ ...content, url }));
            })
            .catch((error) => console.error(error));
    }

    private releaseMedia() {
        this.mediaHold?.release();
        this.mediaHold = undefined;
    }

    private getMessageContent(): ChatMessageContent {
        const unsigned = this.event.getUnsigned();
        const relation = unsigned["m.relations"];
        if (this.event.isDecryptionFailure()) {
            return {
                body: "🔐 Failed to decrypt",
                url: undefined,
                urls: undefined,
                filename: undefined,
                fileNames: undefined,
            };
        }
        if (relation) {
            if (relation["m.replace"]) {
                return {
                    body: relation["m.replace"].content?.["m.new_content"]?.body,
                    url: undefined,
                    urls: undefined,
                    filename: undefined,
                    fileNames: undefined,
                };
            }
        }

        const content = this.event.getOriginalContent();
        const quotedMessage = this.getQuotedMessage();

        if (quotedMessage !== undefined && content.formatted_body) {
            this.quotedMessage = quotedMessage;
            return {
                body: content.formatted_body.replace(/^(<mx-reply>).*(<\/mx-reply>)/, ""),
                url: undefined,
                urls: undefined,
                filename: undefined,
                fileNames: undefined,
            };
        }

        if (this.type !== "text") {
            return {
                body: content.body,
                // Set by loadMediaUrl once the file is fetched.
                url: undefined,
                urls: undefined,
                // The body of a Matrix file is its name: the blob: URL it loads from has none.
                filename: this.type === "file" ? content.body : undefined,
                fileNames: undefined,
            };
        }

        return { body: content.body, url: undefined, urls: undefined, filename: undefined, fileNames: undefined };
    }

    public initReactions() {
        this.reactions.clear();
        const reactionByKey = this.room
            .getUnfilteredTimelineSet()
            .relations.getChildEventsForEvent(this.id, RelationType.Annotation, EventType.Reaction);
        if (!reactionByKey) return;
        if (!this.relations) {
            this.relations = new MatrixChatRelation(this, reactionByKey);
        }
        const sortedReactionByKey = reactionByKey.getSortedAnnotationsByKey() ?? [];
        sortedReactionByKey.forEach(([reactionKey, events]) => {
            events.forEach((event) => {
                // Everyone who reacted with this emoji, not only the last one: else my own reaction can look missing.
                const reaction = this.reactions.get(reactionKey);
                if (reaction) {
                    reaction.addUser(event.getSender(), event.getId());
                    return;
                }
                this.reactions.set(
                    reactionKey,
                    new MatrixChatMessageReaction(this.room, event, () => this.toggleReaction(reactionKey))
                );
            });
        });
    }

    /** From its first reaction on, the message follows Matrix's own count of them, removals included. */
    public followReactions() {
        if (this.relations === undefined) this.initReactions();
    }

    private getQuotedMessage() {
        const replyEventId = this.event.replyEventId;
        if (replyEventId) {
            const replyToEvent = this.room.findEventById(replyEventId);
            if (replyToEvent) {
                return new MatrixChatMessage(replyToEvent, this.room, true, this.isDirect);
            }
        }
        return;
    }

    private getIsDeleted() {
        return this.event.isRedacted();
    }

    private getIsModified() {
        return this.event.replacingEventId() !== undefined;
    }

    public getFormattedBody(): string {
        const content = this.event.getOriginalContent();
        return content.formatted_body;
    }

    public mxcUrlToHttp(url: string) {
        return this.room.client.mxcUrlToHttp(url);
    }
    private mapMatrixMessageTypeToChatMessage() {
        const matrixMessageType = this.event.getOriginalContent().msgtype;
        switch (matrixMessageType) {
            case "m.text":
                return "text";
            case "m.image":
                return "image";
            case "m.file":
                return "file";
            case "m.audio":
                return "audio";
            case "m.video":
                return "video";
        }
        return "text";
    }

    remove() {
        this.room.client.redactEvent(this.room.roomId, this.id).catch((error) => console.error(error));
    }

    async edit(newContent: string): Promise<void> {
        try {
            await this.room.client.sendEvent(this.room.roomId, EventType.RoomMessage, {
                msgtype: MsgType.Text,
                "m.relates_to": { rel_type: RelationType.Replace, event_id: this.id },
                "m.new_content": { msgtype: MsgType.Text, body: newContent },
                body: newContent,
            });
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    public modifyContent(newContent: string) {
        this.content.set({
            body: newContent,
            url: undefined,
            urls: undefined,
            filename: undefined,
            fileNames: undefined,
        });
        this.isModified.set(true);
    }

    public markAsRemoved() {
        this.isDeleted.set(true);
    }

    addReaction(reaction: string): Promise<void> {
        return this.toggleReaction(reaction);
    }

    /**
     * Turns my reaction with this emoji on or off. Clicks made while one is still on its way only change what the
     * last click asked for, so quick clicks end where the last one says and nothing is sent twice: the server refuses
     * a second identical reaction, and a refused event holds back everything sent after it in the room.
     */
    toggleReaction(key: string): Promise<void> {
        const current = this.myReactions.get(key);
        if (current?.sync) {
            current.want = !current.want;
            current.clicks++;
            return current.sync;
        }
        const eventId = this.myReactionEventId(key, current?.eventId);
        const mine: MyReaction = { want: eventId === undefined, eventId, clicks: 0, sync: undefined };
        this.myReactions.set(key, mine);
        mine.sync = this.syncMyReaction(key, mine).finally(() => (mine.sync = undefined));
        return mine.sync;
    }

    private myReactionEventId(key: string, lastSentId: string | undefined): string | undefined {
        const known = this.reactions.get(key)?.users.get(this.room.myUserId)?.eventId;
        // A "~" id is a local echo, never confirmed by the server.
        if (known !== undefined && !known.startsWith("~") && !this.isRemoved(known)) return known;
        // Sent from here and maybe not back from sync yet.
        return lastSentId !== undefined && !this.isRemoved(lastSentId) ? lastSentId : undefined;
    }

    private isRemoved(eventId: string): boolean {
        const event = this.room.findEventById(eventId);
        return event !== undefined && (event.isRedacted() || event.localRedactionEvent() !== null);
    }

    private async syncMyReaction(key: string, mine: MyReaction): Promise<void> {
        try {
            // The first click is sent at once. Clicks after it only change mine.want until they stop, then one send
            // or removal brings the server to the last one: the chat server slows down anyone sending many events.
            // One request at a time on purpose, and only this loop writes mine.eventId.
            for (;;) {
                if (mine.want !== (mine.eventId !== undefined)) {
                    if (mine.eventId === undefined) {
                        // eslint-disable-next-line no-await-in-loop
                        const { event_id } = await this.room.client.sendEvent(this.room.roomId, EventType.Reaction, {
                            "m.relates_to": { key, rel_type: RelationType.Annotation, event_id: this.id },
                        });
                        // eslint-disable-next-line require-atomic-updates
                        mine.eventId = event_id;
                    } else {
                        // eslint-disable-next-line no-await-in-loop
                        await this.room.client.redactEvent(this.room.roomId, mine.eventId);
                        // eslint-disable-next-line require-atomic-updates
                        mine.eventId = undefined;
                    }
                }
                // Wait for the clicks to stop.
                let clicks: number;
                do {
                    clicks = mine.clicks;
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise<void>((resolve) => {
                        setTimeout(resolve, REACTION_BURST_MS);
                    });
                } while (mine.clicks !== clicks);
                if (mine.want === (mine.eventId !== undefined)) return;
            }
        } catch (error) {
            console.error(error);
            mine.want = mine.eventId !== undefined;
            this.dropUnsentReactions();
        }
    }

    /** A refused reaction stays queued as "not sent", and the room then holds back every later message too. */
    private dropUnsentReactions() {
        for (const event of this.room.getPendingEvents()) {
            if (event.status !== EventStatus.NOT_SENT) continue;
            const target = event.isRedaction() ? event.getAssociatedId() : undefined;
            const isReaction =
                event.getType() === EventType.Reaction ||
                (target !== undefined &&
                    (this.room.findEventById(target) ?? this.room.getPendingEvent(target))?.getType() ===
                        EventType.Reaction);
            if (isReaction) this.room.client.cancelPendingEvent(event);
        }
    }
}
