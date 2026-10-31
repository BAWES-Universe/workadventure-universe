import type { IContent, MatrixEvent, Room } from "matrix-js-sdk";
import { Direction, EventStatus, EventType, MatrixEventEvent, MsgType, RelationType } from "matrix-js-sdk";
import type { Writable } from "svelte/store";
import { derived, writable } from "svelte/store";
import { v4 as uuidv4 } from "uuid";
import { MapStore } from "@workadventure/store-utils";
import { readBotStatusNote, type BotStatusNote } from "../../Bots/BotChatStatus";
import { readBotRoomLink, type BotRoomLink } from "../../Bots/BotRoomLink";
import { readBotReplyLimit, type BotReplyLimit } from "../../Bots/BotReplyLimit";
import { readArtifactField, type ArtifactCard } from "../../../Artifacts/artifactCard";
import { readBotSteps, type BotSteps } from "../../Bots/BotSteps";
import type { ChatMessage, ChatMessageContent, ChatMessageType, ChatUser, SharedFileInfo } from "../ChatConnection";
import { canRenderAttachmentInline } from "../../../Utils/InlineMimeType";
import { fromMatrixWaveform, secondsFromMatrixDuration } from "../../VoiceNote/VoiceNote";
import { chatUserFactory } from "./MatrixChatUser";
import { MatrixChatMessageReaction } from "./MatrixChatMessageReaction";
import { MatrixChatRelation } from "./MatrixChatRelation";
import type { MatrixMediaHold } from "./MatrixMedia";
import { holdMatrixMedia } from "./MatrixMedia";
import { readMediaGroup, type MediaGroupTag } from "./MatrixMediaGroup";

/** My reaction with one emoji: what the last click asked for, and the event that is on the server now. */
interface MyReaction {
    want: boolean;
    eventId: string | undefined;
    clicks: number;
    sync: Promise<void> | undefined;
}

/** Clicks closer together than this count as one burst: only where the burst ends is sent. */
const REACTION_BURST_MS = 300;

/** A Matrix reply's plain body can start with the quoted lines ("> <@name> text"), then a blank line, then the reply. */
const REPLY_FALLBACK_START = /^> (?:\* )?<[^>\n]+>/;

function withoutReplyFallback(body: unknown): string | undefined {
    if (typeof body !== "string") return undefined;
    // Only a body that starts like a quote has one: a caption that merely starts with ">" is the sender's own text.
    if (!REPLY_FALLBACK_START.test(body)) return body;
    const lines = body.split("\n");
    let first = 0;
    while (first < lines.length && lines[first].startsWith(">")) first++;
    if (lines[first] === "") first++;
    return lines.slice(first).join("\n");
}

/**
 * What the gallery shows: the files of all its messages once each has its address (or failed), with the words of the
 * first one under them.
 */
function galleryContent(kinds: ChatMessageType[], contents: ChatMessageContent[]): ChatMessageContent {
    const items = kinds.map((type, i) => ({ type, content: contents[i] }));
    const ready = items.filter((item) => item.content.url !== undefined);
    const loading = items.some((item) => item.content.url === undefined && !item.content.mediaFailed);
    const first = contents[0];
    // The words of a Matrix file are its body when that is not its name (MSC2530).
    const body = first.body?.trim() && first.body.trim() !== first.filename?.trim() ? first.body : "";
    if (loading || ready.length === 0) {
        return {
            body,
            url: undefined,
            urls: undefined,
            filename: undefined,
            // What the gallery holds is known before its addresses are: a notification or a list line can say it.
            fileNames: items.map((item) => item.content.filename ?? item.content.body ?? ""),
            itemTypes: items.map((item) => galleryItemType(item.type)),
            mediaFailed: !loading && ready.length === 0 ? true : undefined,
        };
    }
    return {
        body,
        url: ready[0].content.url,
        urls: ready.slice(1).map((item) => item.content.url as string),
        filename: undefined,
        fileNames: ready.map((item) => item.content.filename ?? item.content.body ?? ""),
        itemTypes: ready.map((item) => galleryItemType(item.type)),
    };
}

function galleryItemType(type: ChatMessageType): "image" | "video" | "audio" | "file" {
    return type === "image" || type === "video" || type === "audio" ? type : "file";
}

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
    readonly botStatus: BotStatusNote | undefined;
    readonly botStatusAt: number | undefined;
    readonly roomLink: BotRoomLink | undefined;
    readonly replyLimit: BotReplyLimit | undefined;
    readonly artifact: ArtifactCard | undefined;
    /** A bot's steps line (#1545): the bot server updates this one message while the bot works. */
    readonly steps: Writable<BotSteps | undefined>;
    /** Set when this message is one of several files sent together (see MatrixMediaGroup). */
    readonly groupTag: MediaGroupTag | undefined;
    /** The Matrix id of the sender, which only the same sender's messages can join a group with. */
    readonly senderId: string | undefined;
    /** The messages of the gallery this one opens, in order, this one first. */
    private groupMembers: MatrixChatMessage[] | undefined;
    readonly canReact = writable(true);
    readonly canReply = writable(true);
    private isShown = false;
    private mediaHold: MatrixMediaHold | undefined;
    private myReactions = new Map<string, MyReaction>();

    /** In a direct chat (isDirect), only the person who sent a message can delete it. */
    constructor(private event: MatrixEvent, private room: Room, isQuotedMessage?: boolean, private isDirect = false) {
        this.id = event.getId() ?? uuidv4();
        this.groupTag = readMediaGroup(event.getOriginalContent());
        this.senderId = event.getSender();
        this.type = this.mapMatrixMessageTypeToChatMessage();
        this.botStatus = readBotStatusNote(event.getSender(), event.getOriginalContent());
        // The homeserver's clock can differ from ours: the SDK's local timestamp is the send time on our clock.
        this.botStatusAt = this.botStatus ? event.localTimestamp : undefined;
        this.roomLink = readBotRoomLink(event.getSender(), event.getOriginalContent(), window.location.origin);
        this.replyLimit = readBotReplyLimit(
            event.getSender(),
            event.getOriginalContent(),
            room.getMember(event.getSender() ?? "")?.name ?? ""
        );
        this.artifact = readArtifactField(event.getSender(), event.getOriginalContent());
        this.steps = writable(readBotSteps(event.getSender(), this.stepsContent()));
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

        event.on(MatrixEventEvent.Decrypted, this.onDecrypted);

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
                update((content) =>
                    content.url === undefined && !content.mediaFailed
                        ? content
                        : { ...content, url: undefined, mediaFailed: undefined }
                );
            };
        });
    }

    /** The same function is added to and removed from the event, which lives on after this message is replaced. */
    private readonly onDecrypted = () => {
        this.updateMessageContentOnDecryptedEvent();
    };

    /**
     * Makes this message the gallery of all the files sent together (it is the first of `members`). It is shown as
     * the same gallery nearby chat uses, with the words of the first file under it; the other messages are kept
     * inside it and not listed on their own.
     */
    joinGroup(members: MatrixChatMessage[]) {
        if (members.length < 2 || members[0] !== this) return;
        this.groupMembers = members;
        // What each file is, read before this message becomes the gallery.
        const kinds = members.map((member) => member.type);
        this.type = "gallery";
        const own = this.content;
        const gallery = derived([own, ...members.slice(1).map((member) => member.content)], (contents) =>
            galleryContent(kinds, contents)
        );
        // Edits and media loading still change the first file's own content.
        this.content = { subscribe: gallery.subscribe, set: own.set, update: own.update };
    }

    /** The list that held this message is built again: the event no longer calls it, and its media is let go. */
    destroy() {
        this.event.off(MatrixEventEvent.Decrypted, this.onDecrypted);
        this.groupMembers?.slice(1).forEach((member) => member.destroy());
        this.releaseMedia();
        this.relations?.destroy();
    }

    private updateMessageContentOnDecryptedEvent() {
        // Until it is decrypted, the event's type is m.room.encrypted: an image or file only shows as one now.
        if (this.groupMembers === undefined) this.type = this.mapMatrixMessageTypeToChatMessage();
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
        let mimetype =
            typeof info === "object" && info !== null ? (info as Record<string, unknown>).mimetype : undefined;
        const filename = content.filename ?? content.body;
        if (mimetype === undefined && typeof filename === "string" && /\.svg$/i.test(filename)) {
            mimetype = "image/svg+xml";
        }
        const hold = holdMatrixMedia(
            this.room.client,
            content.url ?? content.file,
            typeof mimetype === "string" ? mimetype : undefined
        );
        this.mediaHold = hold;
        const failed = () => this.content.update((content) => ({ ...content, mediaFailed: true }));
        hold.url
            .then((url) => {
                if (this.mediaHold !== hold) return;
                if (url === undefined) failed();
                else this.content.update((content) => ({ ...content, url, mediaFailed: undefined }));
            })
            .catch((error) => {
                console.error(error);
                if (this.mediaHold === hold) failed();
            });
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
                // A picture's text is plain: the reply fallback comes off its body, and its HTML form is not shown.
                body:
                    this.type === "text"
                        ? content.formatted_body.replace(/^(<mx-reply>).*(<\/mx-reply>)/, "")
                        : withoutReplyFallback(content.body) ?? "",
                url: undefined,
                urls: undefined,
                // A picture sent as a reply still tells its body from its name.
                filename: this.type === "text" ? undefined : this.getMediaFileName(content),
                fileNames: undefined,
                ...this.voiceDetails(content),
            };
        }

        if (this.type !== "text") {
            return {
                // A reply picture whose app sends no HTML form still has the quoted lines in its plain text.
                body: withoutReplyFallback(content.body) ?? "",
                // Set by loadMediaUrl once the file is fetched.
                url: undefined,
                urls: undefined,
                // The body of a Matrix file is its name: the blob: URL it loads from has none.
                filename: this.getMediaFileName(content),
                fileNames: undefined,
                ...this.voiceDetails(content),
            };
        }

        return { body: content.body, url: undefined, urls: undefined, filename: undefined, fileNames: undefined };
    }

    /** Whether the message is a voice message, and the length and shape its sender wrote with it (MSC1767). */
    private voiceDetails(content: IContent): Pick<ChatMessageContent, "isVoice" | "voiceDuration" | "voiceWaveform"> {
        const isVoice = this.isVoiceMessage(content);
        if (!isVoice) return { isVoice };
        const audio: unknown = content["org.matrix.msc1767.audio"];
        const details = typeof audio === "object" && audio !== null ? (audio as Record<string, unknown>) : {};
        const info: unknown = content.info;
        const infoDuration = typeof info === "object" && info !== null ? (info as Record<string, unknown>).duration : 0;
        return {
            isVoice,
            voiceDuration: secondsFromMatrixDuration(details.duration) ?? secondsFromMatrixDuration(infoDuration),
            voiceWaveform: fromMatrixWaveform(details.waveform),
        };
    }

    /** A recorded voice message, flagged by Element (MSC3245) as `org.matrix.msc3245.voice`, or `m.voice` once stable. */
    private isVoiceMessage(content: IContent): boolean {
        return (
            this.type === "audio" &&
            (content["org.matrix.msc3245.voice"] !== undefined || content["m.voice"] !== undefined)
        );
    }

    /**
     * The name of the file a media message carries. Without a `filename` field, the body is the name and there is no
     * caption (Matrix, MSC2530): so what we show under a picture is only a body that differs from this name.
     */
    private getMediaFileName(content: IContent): string | undefined {
        if (typeof content.filename === "string") return content.filename;
        // The body is shown without the quoted lines of a reply, so the name is read from it the same way.
        return withoutReplyFallback(content.body);
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

    get sharedFile(): SharedFileInfo | undefined {
        if (this.type === "text" || this.event.isDecryptionFailure() || this.event.isRedacted()) return undefined;
        const content = this.event.getOriginalContent();
        const info: unknown = content.info;
        const size = typeof info === "object" && info !== null ? (info as Record<string, unknown>).size : undefined;
        return {
            name: this.getMediaFileName(content) ?? "",
            size: typeof size === "number" && Number.isFinite(size) ? size : undefined,
            // A voice message is flagged on its audio event (MSC3245), as for its chat list line.
            voice: this.isVoiceMessage(content),
        };
    }

    public mxcUrlToHttp(url: string) {
        return this.room.client.mxcUrlToHttp(url);
    }
    private mapMatrixMessageTypeToChatMessage() {
        const content = this.event.getOriginalContent();
        const matrixMessageType = content.msgtype;
        // Retyped documents cannot render as media. Show the existing named download card instead of a broken preview.
        if (
            ["m.image", "m.audio", "m.video"].includes(matrixMessageType ?? "") &&
            !canRenderAttachmentInline(content.info?.mimetype, content.filename ?? content.body)
        ) {
            return "file";
        }
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

    /** A notice as last edited, so a steps line read from history shows where the bot server left it. */
    private stepsContent(): Record<string, unknown> | undefined {
        const original = this.event.getOriginalContent();
        // Only a notice can carry a steps line, so other messages skip the look at their edits
        if (original.msgtype !== "m.notice") return undefined;
        const bundled: unknown = this.event.getUnsigned()["m.relations"]?.["m.replace"]?.content?.["m.new_content"];
        if (bundled && typeof bundled === "object") return bundled as Record<string, unknown>;
        if (this.event.replacingEventId()) {
            const replaced: unknown = this.event.replacingEvent()?.getOriginalContent()["m.new_content"];
            if (replaced && typeof replaced === "object") return replaced as Record<string, unknown>;
        }
        return original;
    }

    /** An update of a bot's steps line: only its own sender can change it. */
    public modifySteps(sender: string | undefined, newContent: Record<string, unknown> | undefined) {
        if (!sender || sender !== this.event.getSender()) return;
        const steps = readBotSteps(sender, newContent);
        if (steps) this.steps.set(steps);
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
