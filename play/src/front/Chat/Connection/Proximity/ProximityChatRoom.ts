import * as Sentry from "@sentry/svelte";
import Debug from "debug";
import { MapStore, SearchableArrayStore } from "@workadventure/store-utils";
import type { Readable, Writable, Unsubscriber } from "svelte/store";
import { derived, get, writable, readable } from "svelte/store";
import { v4 as uuidv4 } from "uuid";
import type { Subscription } from "rxjs";
import type { CharacterTextureMessage } from "@workadventure/messages";
import { AvailabilityStatus, FilterType } from "@workadventure/messages";
import { ChatMessageTypes } from "@workadventure/shared-utils";
import { asError } from "catch-unknown";
import { eventToAbortReason } from "@workadventure/shared-utils/src/Abort/raceAbort";
import { AbortError } from "@workadventure/shared-utils/src/Abort/AbortError";
import type {
    AnyKindOfUser,
    ChatMessage,
    ChatMessageContent,
    ChatMessageReaction,
    ChatMessageType,
    ChatRoom,
} from "../ChatConnection";
import LL, { locale } from "../../../../i18n/i18n-svelte";
import { iframeListener } from "../../../Api/IframeListener";
import type { SpaceInterface, SpaceUserExtended } from "../../../Space/SpaceInterface";
import type { SpaceRegistryInterface } from "../../../Space/SpaceRegistry/SpaceRegistryInterface";
import { chatVisibilityStore } from "../../../Stores/ChatStore";
import { openChat } from "../../openChat";
import { isAChatRoomIsVisible, navChat, shouldRestoreChatStateStore } from "../../Stores/ChatStore";
import { selectedRoomStore } from "../../Stores/SelectRoomStore";
import { mapExtendedSpaceUserToChatUser } from "../../UserProvider/ChatUserMapper";
import { gameManager } from "../../../Phaser/Game/GameManager";
import { availabilityStatusStore, requestedCameraState, requestedMicrophoneState } from "../../../Stores/MediaStore";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { MessageNotification } from "../../../Notification/MessageNotification";
import { notificationManager } from "../../../Notification/NotificationManager";
import { blackListManager } from "../../../WebRtc/BlackListManager";
import { isMediaBreakpointUp } from "../../../Utils/BreakpointsUtils";
import { ScriptingOutputAudioStreamManager } from "../../../WebRtc/AudioStream/ScriptingOutputAudioStreamManager";
import { ScriptingInputAudioStreamManager } from "../../../WebRtc/AudioStream/ScriptingInputAudioStreamManager";
import type { MessageUserJoined } from "../../../Connection/ConnexionModels";
import type { RemotePlayersRepository } from "../../../Phaser/Game/RemotePlayersRepository";
import { hideBubbleConfirmationModal } from "../../../Rules/StatusRules/statusChangerFunctions";
import { statusChanger } from "../../../Components/ActionBar/AvailabilityStatus/statusChanger";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { faviconManager } from "../../../WebRtc/FaviconManager";
import { screenWakeLock } from "../../../Utils/ScreenWakeLock";
import type { PictureStore } from "../../../Stores/PictureStore";
import { CharacterLayerManager } from "../../../Phaser/Entity/CharacterLayerManager";
import { BubbleNotification as BasicNotification } from "../../../Notification/BubbleNotification";
import { formatPeopleNames } from "../../Components/TopRow/TopRowSummary";
import { composerDraftStore } from "../../Stores/ComposerDraftStore";
import {
    selectedProximitySessionStore,
    stashProximityHistory,
    takeProximityHistory,
} from "../../Stores/ProximitySessionStore";
import type { ProximitySession, ProximitySessionMarker } from "./ProximitySessions";
import { ROOM_MESSAGES_SESSION_ID, buildProximitySessions, findNotSentInsertIndex } from "./ProximitySessions";

const debug = Debug("ProximityChatRoom");

// A typing entry expires on its own if no new "typing" event refreshes it, so a lost "stopped typing" event
// can never leave the indicator stuck. The sender re-emits "typing" on every keystroke.
export const TYPING_EXPIRY_MS = 12000;

/**
 * A person in the space the proximity chat is currently connected to (bubble, meeting or zone).
 * "Yourself" is this tab's own spaceUserId, so other tabs of the same account (clones) are participants.
 */
export interface ProximityChatParticipant {
    readonly id: string;
    readonly name: string;
    readonly pictureStore: PictureStore;
}

/**
 * What the proximity chat is currently connected to:
 * - "none": no space (alone)
 * - "bubble": a proximity bubble
 * - "meeting": a meeting area space, where every member of the space is listed
 * - "stream": a speaker/listener zone, where only the people streaming are listed
 */
export type ProximitySpaceKind = "none" | "bubble" | "meeting" | "stream";

export class ProximityChatMessage implements ChatMessage {
    isQuotedMessage = undefined;
    quotedMessage = undefined;
    isDeleted = writable(false);
    isModified = writable(false);
    canDelete = writable(false);
    reactions: MapStore<string, ChatMessageReaction> = new MapStore();
    /**
     * Set on the local markers written when this tab joins or leaves a group, so the timeline can draw
     * session dividers without ever matching translated text. Local and in memory only.
     */
    session?: ProximitySessionMarker;
    /**
     * Set on a message that was never sent because its conversation ended before its upload finished.
     * Local and in memory only.
     */
    notSent?: boolean;
    /**
     * Set on a bot reply that was still streaming when this tab left the space: the text stops where it was.
     * Local and in memory only.
     */
    stoppedOnLeave?: boolean;
    constructor(
        public id: string,
        public sender: AnyKindOfUser,
        public content: Readable<ChatMessageContent>,
        public date: Date,
        public isMyMessage: boolean,
        public type: ChatMessageType,
        options: { session?: ProximitySessionMarker; notSent?: boolean } = {}
    ) {
        this.session = options.session;
        this.notSent = options.notSent;
    }

    remove(): void {
        console.info("Function not implemented.");
    }
    edit(newContent: string): Promise<void> {
        console.info("Function not implemented.", newContent);
        return Promise.resolve();
    }
    addReaction(reaction: string): Promise<void> {
        console.info("Function not implemented.", reaction);
        return Promise.resolve();
    }
}

type SoundManager = Pick<GameScene, "playBubbleInSound" | "playBubbleOutSound">;

export class ProximityChatRoom implements ChatRoom {
    id = "proximity";
    name = writable("Proximity Chat");
    type: "direct" | "multiple" = "direct";
    hasUnreadMessages = writable(false);
    unreadNotificationCount = writable(0);
    pictureStore = readable(undefined);
    messages: SearchableArrayStore<string, ChatMessage> = new SearchableArrayStore((item) => item.id);
    messageReactions: MapStore<string, MapStore<string, ChatMessageReaction>> = new MapStore();
    hasPreviousMessage = writable(false);
    isEncrypted = writable(false);
    typingMembers: Writable<Array<{ id: string; name: string | null; pictureStore: PictureStore }>>;
    private _space: SpaceInterface | undefined;
    private _spacePromise: Promise<SpaceInterface | undefined> = Promise.resolve(undefined);
    private spaceMessageSubscription: Subscription | undefined;
    private spaceIsTypingSubscription: Subscription | undefined;
    // Expiry timers of the typing entries, by spaceUserId of the sender
    private typingExpiryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private spaceStreamMessageSubscription: Subscription | undefined;
    // Active stream messages by responseId — updated incrementally as tokens arrive
    private streamMessages: Map<string, ProximityChatMessage> = new Map();
    private observeUserJoinedSubscription: Subscription | undefined;
    private observeUserLeftSubscription: Subscription | undefined;
    // Users by spaceUserId
    private users: Map<string, SpaceUserExtended> | undefined;
    private usersUnsubscriber: Unsubscriber | undefined;
    private spaceWatcherUserJoinedObserver: Subscription | undefined;
    private spaceWatcherUserLeftObserver: Subscription | undefined;
    private newChatMessageWritingStatusStreamUnsubscriber: Subscription;
    private joinSpaceAbortController: AbortController | undefined;
    areNotificationsMuted = writable(false);
    isRoomFolder = false;
    lastMessageTimestamp = 0;
    hasUserInProximityChat = writable(false);
    private readonly _participants: Writable<ProximityChatParticipant[]> = writable([]);
    /**
     * The other people in the current space, excluding only this tab's own avatar (never by account or uuid).
     */
    public readonly participants: Readable<ProximityChatParticipant[]> = { subscribe: this._participants.subscribe };
    private readonly _spaceKind: Writable<ProximitySpaceKind> = writable("none");
    public readonly spaceKind: Readable<ProximitySpaceKind> = { subscribe: this._spaceKind.subscribe };
    private readonly _spaceJoinedAt: Writable<number | undefined> = writable(undefined);
    /**
     * When the current space was joined (ms since epoch), so that a message sent to an earlier group
     * is never shown as the latest message of the current one.
     */
    public readonly spaceJoinedAt: Readable<number | undefined> = { subscribe: this._spaceJoinedAt.subscribe };
    currentMatrixRoom: ChatRoom | undefined;
    currentChatVisibility = false;
    private _spaceGeneration = 0;
    // The name of the meeting area joined, for its end marker: the display name is reset before leaving.
    private meetingSessionLabel: string | undefined;
    // One id per stay (bubble or meeting), shared by its start and end markers. Undefined when alone.
    private _currentSessionId: string | undefined;
    // Unread messages by session id, in this tab's memory: an ended stay keeps what you didn't read in it.
    private readonly _unreadBySession: Writable<Map<string, number>> = writable(new Map());
    public readonly unreadBySession: Readable<Map<string, number>> = { subscribe: this._unreadBySession.subscribe };
    // Text left in the composer when a stay ended, by session id. Shown as unsent in that stay, never sent on.
    private readonly _unsentDrafts: Writable<Map<string, string>> = writable(new Map());
    /** The timeline split into stays, room messages first, the live one last. */
    public readonly sessions: Readable<ProximitySession<ChatMessage>[]>;

    /** The id of the stay this tab is in now, if any. */
    public get currentSessionId(): string | undefined {
        return this._currentSessionId;
    }

    /**
     * Changes every time a space is joined or left. A send captures it at submit time and is dropped
     * if it changed before the send could complete, so a message never goes to a later group.
     */
    public get spaceGeneration(): number {
        return this._spaceGeneration;
    }

    /**
     * True while a space is being joined and is not connected yet: a message sent now would reach nobody.
     */
    public get isJoiningSpace(): boolean {
        return this._space === undefined && this.joinSpaceAbortController !== undefined;
    }

    private unknownUser = {
        chatId: "0",
        uuid: "0",
        availabilityStatus: writable(AvailabilityStatus.ONLINE),
        username: "Unknown",
        pictureStore: readable(undefined),
        roomName: undefined,
        playUri: undefined,
        color: undefined,
        spaceUserId: undefined,
    } as AnyKindOfUser;

    private scriptingOutputAudioStreamManager: ScriptingOutputAudioStreamManager | undefined;
    private scriptingInputAudioStreamManager: ScriptingInputAudioStreamManager | undefined;
    private startListeningToStreamInBubbleStreamUnsubscriber: Subscription;
    private stopListeningToStreamInBubbleStreamUnsubscriber: Subscription;
    private screenWakeRelease: undefined | (() => Promise<void>);

    constructor(
        private _spaceUserId: string,
        private spaceRegistry: SpaceRegistryInterface,
        iframeListenerInstance: Pick<typeof iframeListener, "newChatMessageWritingStatusStream">,
        private remotePlayersRepository: RemotePlayersRepository,
        private soundManager: SoundManager,
        private notifyNewMessage = (message: ProximityChatMessage) => {
            if (!localUserStore.getChatSounds() || get(this.areNotificationsMuted)) return;
            gameManager.getCurrentGameScene().playSound("new-message");
            notificationManager.createNotification(
                new MessageNotification(
                    message.sender.username ?? "unknown",
                    get(message.content).body,
                    this.id,
                    get(this.name)
                )
            );
        }
    ) {
        this.typingMembers = writable([]);
        this.sessions = derived(
            [this.messages, this._spaceJoinedAt, this._unsentDrafts],
            ([$messages, $spaceJoinedAt, $unsentDrafts]) => {
                const sessions = buildProximitySessions(Array.from($messages), $spaceJoinedAt);
                for (const session of sessions) {
                    const draft = $unsentDrafts.get(session.id);
                    if (draft !== undefined) session.unsentDraft = draft;
                }
                return sessions;
            }
        );

        // The chats you had on the previous map, when the scene handed them over.
        const stash = takeProximityHistory();
        if (stash) {
            this.messages.push(...stash.messages);
            this._unreadBySession.set(stash.unreadBySession);
            this._unsentDrafts.set(stash.unsentDrafts);
            this.refreshUnreadTotals(stash.unreadBySession);
            const last = stash.messages[stash.messages.length - 1];
            if (last?.date) this.lastMessageTimestamp = last.date.getTime();
        }

        this.newChatMessageWritingStatusStreamUnsubscriber =
            iframeListenerInstance.newChatMessageWritingStatusStream.subscribe((status) => {
                if (status === ChatMessageTypes.userWriting) {
                    this.startTyping().catch((e) => {
                        console.error("Error while sending typing status", e);
                    });
                } else if (status === ChatMessageTypes.userStopWriting) {
                    this.stopTyping().catch((e) => {
                        console.error("Error while sending typing status", e);
                    });
                }
            });

        this.startListeningToStreamInBubbleStreamUnsubscriber =
            iframeListener.startListeningToStreamInBubbleStream.subscribe((message) => {
                if (!this.scriptingInputAudioStreamManager) {
                    console.error("Trying to start listening to stream in bubble but no bubble has been joined yet");
                    return;
                }
                this.scriptingInputAudioStreamManager.startListeningToAudioStream(message.sampleRate).catch((e) => {
                    console.error("Error while starting listening to streams", e);
                    Sentry.captureException(e);
                });
            });

        this.stopListeningToStreamInBubbleStreamUnsubscriber =
            iframeListener.stopListeningToStreamInBubbleStream.subscribe(() => {
                if (!this.scriptingInputAudioStreamManager) {
                    console.error("Trying to stop listening to stream in bubble but no bubble has been joined yet");
                    return;
                }
                this.scriptingInputAudioStreamManager.stopListeningToAudioStream();
            });
    }

    private inferTypeFromUrl(url: string): ChatMessageType | undefined {
        // Strip query string first — presigned URLs have params after ?
        const pathPart = url.split("?")[0];
        const ext = pathPart.split(".").pop()?.toLowerCase();
        switch (ext) {
            case "png":
            case "jpg":
            case "jpeg":
            case "gif":
            case "webp":
            case "bmp":
            case "svg":
                return "image";
            case "mp4":
            case "webm":
            case "ogg":
            case "mov":
            case "avi":
            case "mkv":
                return "video";
            case "mp3":
            case "wav":
            case "aac":
            case "flac":
            case "m4a":
            case "wma":
                return "audio";
            default:
                return undefined;
        }
    }

    sendMessage(
        message: string,
        action: ChatMessageType = "proximity",
        broadcast = true,
        url?: string,
        mediaType?: string,
        mimeType?: string,
        galleryUrls?: string[],
        fileName?: string,
        fileNames?: string[]
    ): void {
        // Determine message type from media
        let messageType = action;
        const hasGallery = galleryUrls && galleryUrls.length > 0;
        if (url) {
            // Check URL extension first (always authoritative — the file UUID preserves the extension)
            const urlType = this.inferTypeFromUrl(url);
            if (urlType) {
                messageType = urlType;
            } else if (mimeType?.startsWith("image/")) {
                messageType = "image";
            } else if (mimeType?.startsWith("audio/")) {
                messageType = "audio";
            } else if (mimeType?.startsWith("video/")) {
                messageType = "video";
            } else {
                messageType = "file";
            }
        }
        // If gallery URLs are present, override to gallery type
        if (hasGallery) {
            messageType = "gallery";
        }

        // Create content message
        const newChatMessageContent = {
            body: message,
            url: url,
            urls: galleryUrls,
            filename: fileName,
            fileNames: fileNames,
        };

        const spaceUser = this.users?.get(this._spaceUserId);
        let chatUser: AnyKindOfUser = this.unknownUser;
        if (spaceUser) {
            chatUser = mapExtendedSpaceUserToChatUser(spaceUser);
        }

        // Create message
        const newMessage = new ProximityChatMessage(
            uuidv4(),
            chatUser,
            writable(newChatMessageContent),
            new Date(),
            true,
            messageType
        );

        // Add message to the list
        this.messages.push(newMessage);

        this.lastMessageTimestamp = newMessage.date.getTime();

        // Use the room connection to send the message to other users of the space
        if (broadcast) {
            this._space?.emitPublicMessage({
                $case: "spaceMessage",
                spaceMessage: {
                    message: message,
                    characterTextures: spaceUser?.characterTextures ?? [],
                    name: chatUser.username ?? "unknown",
                    url: url,
                    mediaType: mediaType,
                    mimeType: mimeType,
                    galleryUrls: galleryUrls ?? [],
                    fileName: fileName,
                    fileNames: fileNames ?? [],
                },
            });
        }

        if (messageType === "proximity") {
            // Send local message to WorkAdventure scripting API
            try {
                iframeListener.sendUserInputChat(message, undefined);
            } catch (e) {
                console.error("Error while sending message to WorkAdventure scripting API", e);
            }
        }
    }

    private addEnteringChatWithUsers(users: SpaceUserExtended[]) {
        let userNames: string;
        if (Intl.ListFormat) {
            const formatter = new Intl.ListFormat(get(locale), { style: "long", type: "conjunction" });
            userNames = formatter.format(users.map((user) => user.name));
        } else {
            // For old browsers
            userNames = users.map((user) => user.name).join(", ");
        }
        const participants = users.map((user) => user.name);
        const label = formatPeopleNames(participants, {
            two: get(LL).chat.topRow.twoNames,
            more: get(LL).chat.topRow.moreNames,
        });
        this.addSessionMarker(get(LL).chat.timeLine.newDiscussion({ userNames }), "incoming", {
            kind: "start",
            label,
            participants,
            participantIds: users.map((user) => user.spaceUserId),
            isArea: false,
            sessionId: this._currentSessionId,
        });
    }

    /**
     * Writes a local session marker (joined or left a group). Never sent over the network.
     */
    private addSessionMarker(body: string, type: "incoming" | "outcoming", session: ProximitySessionMarker): void {
        const spaceUser = this.users?.get(this._spaceUserId);
        const marker = new ProximityChatMessage(
            uuidv4(),
            spaceUser ? mapExtendedSpaceUserToChatUser(spaceUser) : this.unknownUser,
            writable({ body, url: undefined, urls: undefined, filename: undefined, fileNames: undefined }),
            new Date(),
            true,
            type,
            { session }
        );
        this.messages.push(marker);
        this.lastMessageTimestamp = marker.date.getTime();
    }

    /**
     * Puts back a message that was never sent because its conversation ended before its upload finished.
     * It goes at the end of the group it was written in, marked as not sent, and is never broadcast.
     */
    public addNotSentMessage(body: string, fileNames: string[], submittedAt: Date): void {
        const spaceUser = this.users?.get(this._spaceUserId);
        const message = new ProximityChatMessage(
            uuidv4(),
            spaceUser ? mapExtendedSpaceUserToChatUser(spaceUser) : this.unknownUser,
            writable({
                body,
                url: undefined,
                urls: undefined,
                filename: undefined,
                fileNames: fileNames.length > 0 ? fileNames : undefined,
            }),
            submittedAt,
            true,
            "proximity",
            { notSent: true }
        );
        // Insert it at the end of its own group, in one update. SearchableArrayStore implements the inserting form
        // of splice, but only declares the removing one.
        const messages = this.messages as unknown as {
            splice(start: number, deleteCount: number, ...items: ChatMessage[]): ChatMessage[];
        };
        messages.splice(findNotSentInsertIndex(get(this.messages), submittedAt), 0, message);
    }

    private addIncomingUser(spaceUser: SpaceUserExtended): void {
        this.sendMessage(get(LL).chat.timeLine.incoming({ userName: spaceUser.name }), "incoming", false);
        /*const newChatUser = mapExtendedSpaceUserToChatUser(spaceUser);

        //if (userUuid === this._userUuid) return;
        this._connection.connectedUsers.update((users) => {
            users.set(userId, newChatUser);
            return users;
        });
        this.membersId.push(userId.toString());*/
    }

    private addOutcomingUser(spaceUser: SpaceUserExtended): void {
        this.sendMessage(get(LL).chat.timeLine.outcoming({ userName: spaceUser.name }), "outcoming", false);
        this.removeTypingUserbyID(spaceUser.spaceUserId.toString());

        /*this._connection.connectedUsers.update((users) => {
            users.delete(userId);
            return users;
        });
        this.membersId = this.membersId.filter((id) => id !== userId.toString());*/
    }

    /**
     * Add a message from a remote user to the proximity chat.
     */
    private addNewMessage(
        message: string,
        senderUserId: string,
        characterTextures: CharacterTextureMessage[],
        name: string,
        url?: string | null,
        mediaType?: string | null,
        mimeType?: string | null,
        galleryUrls?: string[] | null,
        fileName?: string | null,
        fileNames?: string[] | null
    ): void {
        // Ignore messages from the current user
        if (senderUserId === this._spaceUserId) {
            return;
        }

        // Determine message type from media
        let messageType: ChatMessageType = "proximity";
        const hasGallery = galleryUrls && galleryUrls.length > 0;
        if (url) {
            // Check URL extension first (always authoritative — the file UUID preserves the extension)
            const urlType = this.inferTypeFromUrl(url);
            if (urlType) {
                messageType = urlType;
            } else if (mimeType?.startsWith("image/")) {
                messageType = "image";
            } else if (mimeType?.startsWith("audio/")) {
                messageType = "audio";
            } else if (mimeType?.startsWith("video/")) {
                messageType = "video";
            } else {
                messageType = "file";
            }
        }
        // If gallery URLs are present, override to gallery type
        if (hasGallery) {
            messageType = "gallery";
        }

        // Create content message
        const newChatMessageContent = {
            body: message,
            url: url ?? undefined,
            urls: galleryUrls ?? undefined,
            filename: fileName ?? undefined,
            fileNames: fileNames ?? undefined,
        };

        const spaceUser = this.users?.get(senderUserId);
        let chatUser: AnyKindOfUser = this.unknownUser;
        if (spaceUser) {
            chatUser = mapExtendedSpaceUserToChatUser(spaceUser);
        }

        if (characterTextures.length > 0) {
            chatUser.pictureStore = readable<string | undefined>(undefined, (set) => {
                CharacterLayerManager.wokaBase64(characterTextures)
                    .then((wokaBase64) => {
                        set(wokaBase64);
                    })
                    .catch((e) => {
                        Sentry.captureException(e);
                        console.warn("Error while getting woka base64", e);
                    });
            });
        }

        if (name) {
            chatUser.username = name;
        }

        // Create message
        const newMessage = new ProximityChatMessage(
            uuidv4(),
            chatUser,
            writable(newChatMessageContent),
            new Date(),
            false,
            messageType
        );

        // Add message to the list
        this.messages.push(newMessage);

        this.lastMessageTimestamp = newMessage.date.getTime();

        this.notifyNewMessage(newMessage);

        this.markUnread();
        // Send bubble message to WorkAdventure scripting API (text only)
        if (messageType === "proximity") {
            try {
                iframeListener.sendUserInputChat(message, senderUserId);
            } catch (e) {
                console.error("Error while sending message to WorkAdventure scripting API", e);
            }
        }
    }

    sendFiles(files: FileList): Promise<void> {
        return Promise.resolve();
    }
    /** Marks the stay the thread shows as read (every stay when the whole timeline is shown). */
    setTimelineAsRead(): void {
        const selected = get(selectedProximitySessionStore);
        if (selected === undefined) {
            this._unreadBySession.set(new Map());
            this.refreshUnreadTotals(new Map());
            return;
        }
        this.markSessionRead(selected);
    }

    /**
     * Shows a stay in the thread: the live one by default, an ended one by id, and marks it read.
     * With no live stay and no id, the room messages are shown.
     */
    public open(sessionId: string | undefined = this._currentSessionId): void {
        const target = sessionId ?? ROOM_MESSAGES_SESSION_ID;
        selectedProximitySessionStore.set(target);
        selectedRoomStore.set(this);
        this.markSessionRead(target);
    }

    /** Opens the live stay when no conversation is open, as a message arriving always did. */
    private showIfNothingOpen(): void {
        if (get(selectedRoomStore) !== undefined) return;
        this.open();
    }

    /** The stay a message arriving now belongs to. */
    private get arrivalSessionId(): string {
        return this._currentSessionId ?? ROOM_MESSAGES_SESSION_ID;
    }

    /**
     * Counts a message that arrived as unread in its stay, unless that stay is the one open in the thread.
     * Reading one stay never marks another read.
     */
    private markUnread(): void {
        const sessionId = this.arrivalSessionId;
        if (get(selectedRoomStore) === this) {
            const shown = get(selectedProximitySessionStore);
            if (shown === undefined || shown === sessionId) return;
        }
        const unread = new Map(get(this._unreadBySession));
        unread.set(sessionId, (unread.get(sessionId) ?? 0) + 1);
        this._unreadBySession.set(unread);
        this.refreshUnreadTotals(unread);
    }

    private markSessionRead(sessionId: string): void {
        const current = get(this._unreadBySession);
        if (!current.has(sessionId)) return;
        const unread = new Map(current);
        unread.delete(sessionId);
        this._unreadBySession.set(unread);
        this.refreshUnreadTotals(unread);
    }

    private refreshUnreadTotals(unread: Map<string, number>): void {
        let total = 0;
        for (const count of unread.values()) total += count;
        this.hasUnreadMessages.set(total > 0);
        this.unreadNotificationCount.set(total);
    }

    /** Keeps what the composer still held when its stay ended, to show it there as unsent. */
    public keepUnsentDraft(sessionId: string | undefined, text: string): void {
        if (sessionId === undefined || text.replace(/<br\s*\/?>/gi, "").trim() === "") return;
        const drafts = new Map(get(this._unsentDrafts));
        drafts.set(sessionId, text);
        this._unsentDrafts.set(drafts);
    }

    /**
     * Hands the timeline to the proximity chat of the next map, so leaving through a door keeps the chats you had.
     * Called by the scene right before it destroys this room.
     */
    public stashHistoryForNextScene(): void {
        // Leaving the map ends the stay you're in: close it here, so the next map never receives an open stay
        // that its own messages would fall into.
        const openSessionId = this._currentSessionId;
        if (openSessionId !== undefined) {
            const draft = composerDraftStore.load(this.id, this._spaceGeneration);
            if (draft) {
                composerDraftStore.clear(this.id);
                this.keepUnsentDraft(openSessionId, draft.message);
            }
            for (const streaming of this.streamMessages.values()) {
                streaming.stoppedOnLeave = true;
            }
            const others = this.users
                ? Array.from(this.users.values()).filter((user) => user.spaceUserId !== this._spaceUserId)
                : [];
            const isArea = this.meetingSessionLabel !== undefined;
            this.addSessionMarker(
                isArea ? get(LL).chat.timeLine.youleftMeetingRoom() : get(LL).chat.timeLine.youLeft(),
                "outcoming",
                {
                    kind: "end",
                    label: isArea ? this.meetingSessionLabel ?? "" : "",
                    participants: isArea ? [] : others.map((user) => user.name),
                    participantIds: isArea ? [] : others.map((user) => user.spaceUserId),
                    isArea,
                    sessionId: openSessionId,
                }
            );
            this._currentSessionId = undefined;
        }
        stashProximityHistory({
            messages: Array.from(get(this.messages)),
            unreadBySession: new Map(get(this._unreadBySession)),
            unsentDrafts: new Map(get(this._unsentDrafts)),
        });
    }

    loadMorePreviousMessages(): Promise<void> {
        return Promise.resolve();
    }

    addExternalMessage(type: "local" | "bubble", message: string, authorName?: string): void {
        // Create content message
        const newChatMessageContent = {
            body: message,
            url: undefined,
            urls: undefined,
            filename: undefined,
            fileNames: undefined,
        };

        // Create message
        const newMessage = new ProximityChatMessage(
            uuidv4(),
            {
                ...this.unknownUser,
                username: authorName ?? this.unknownUser.username,
            },
            writable(newChatMessageContent),
            new Date(),
            false,
            "proximity"
        );

        // Add message to the list
        this.messages.push(newMessage);

        // If type is bubble, we need to forward the message to the other users
        if (type === "bubble") {
            this._space?.emitPublicMessage({
                $case: "spaceMessage",
                spaceMessage: {
                    message: message,
                    characterTextures: [],
                    galleryUrls: [],
                    fileNames: [],
                },
            });
        }
    }

    startTyping(): Promise<object> {
        this._space?.emitPublicMessage({
            $case: "spaceIsTyping",
            spaceIsTyping: {
                isTyping: true,
                characterTextures: [],
            },
        });
        return Promise.resolve({});
    }
    stopTyping(): Promise<object> {
        this._space?.emitPublicMessage({
            $case: "spaceIsTyping",
            spaceIsTyping: {
                isTyping: false,
                characterTextures: [],
            },
        });

        return Promise.resolve({});
    }

    private addTypingUser(
        senderUserId: string,
        characterTextures: CharacterTextureMessage[],
        name: string | undefined
    ): void {
        const existingTimer = this.typingExpiryTimers.get(senderUserId);
        if (existingTimer) clearTimeout(existingTimer);
        this.typingExpiryTimers.set(
            senderUserId,
            setTimeout(() => this.removeTypingUserbyID(senderUserId), TYPING_EXPIRY_MS)
        );

        this.typingMembers.update((typingMembers) => {
            if (typingMembers.find((user) => user.id === senderUserId) == undefined) {
                typingMembers.push({
                    id: senderUserId,
                    name: name ?? null,
                    pictureStore: readable<string | undefined>(undefined, (set) => {
                        CharacterLayerManager.wokaBase64(characterTextures)
                            .then((wokaBase64) => {
                                set(wokaBase64);
                            })
                            .catch((e) => {
                                Sentry.captureException(e);
                                console.warn("Error while getting woka base64", e);
                            });
                    }),
                });
            }
            return typingMembers;
        });
    }

    private removeTypingUserbyID(id: string) {
        const timer = this.typingExpiryTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.typingExpiryTimers.delete(id);
        }
        this.typingMembers.update((typingMembers) => {
            return typingMembers.filter((user) => user.id !== id);
        });
    }

    private clearTypingMembers() {
        for (const timer of this.typingExpiryTimers.values()) {
            clearTimeout(timer);
        }
        this.typingExpiryTimers.clear();
        this.typingMembers.set([]);
    }

    addExternalTypingUser(id: string, name: string, avatarUrl: string | null): void {
        this.typingMembers.update((typingMembers) => {
            if (typingMembers.find((user) => user.id === id) == undefined) {
                typingMembers.push({ id, name, pictureStore: readable(avatarUrl ?? undefined) });
            }
            return typingMembers;
        });
    }

    removeExternalTypingUser(id: string) {
        this.typingMembers.update((typingMembers) => {
            return typingMembers.filter((user) => user.id !== id);
        });
    }

    public setDisplayName(displayName: string): void {
        this.name.set(displayName);
    }

    public async joinSpace(
        spaceName: string,
        propertiesToSync: string[],
        isMeetingRoomChat: boolean = false,
        filterType: FilterType = FilterType.ALL_USERS
    ): Promise<void> {
        if (this.joinSpaceAbortController) {
            throw new Error("A space is already being joined");
        }
        if (this._space && !this._space.destroyed) {
            // Let's wait for the previous space to be left before joining a new one
            // This can happen for instance when we leave a bubble to jump right away into a meeting room.
            const space = this._space;
            await new Promise<void>((resolve) => {
                const subscription = space.onLeaveSpace.subscribe(() => {
                    resolve();
                    subscription.unsubscribe();
                });
            });
        }
        this.joinSpaceAbortController = new AbortController();
        this._spaceGeneration++;
        this._space = await this.spaceRegistry.joinSpace(
            spaceName,
            filterType,
            propertiesToSync,
            this.joinSpaceAbortController.signal
        );

        // TODO: we need to move that elsewhere.
        // Set up manager of audio streams received by the scripting API (useful for bots)
        this.scriptingOutputAudioStreamManager = new ScriptingOutputAudioStreamManager(this._space);
        this.scriptingInputAudioStreamManager = new ScriptingInputAudioStreamManager(this._space);

        let hasUserInProximityChat = false;

        if (isMeetingRoomChat) {
            this._spaceKind.set(filterType === FilterType.LIVE_STREAMING_USERS ? "stream" : "meeting");
        } else {
            this._spaceKind.set("bubble");
        }
        this._spaceJoinedAt.set(Date.now());
        this._currentSessionId = uuidv4();
        if (isMeetingRoomChat) {
            // A meeting area or zone: the divider names the place (its name was set just before joining).
            this.meetingSessionLabel = get(this.name);
            this.addSessionMarker(get(LL).chat.timeLine.youJoinedMeetingRoom(), "incoming", {
                kind: "start",
                label: this.meetingSessionLabel,
                participants: [],
                participantIds: [],
                isArea: true,
                sessionId: this._currentSessionId,
            });
        }

        this.usersUnsubscriber = this._space.usersStore.subscribe((users) => {
            this.users = users;
            this._participants.set(
                Array.from(users.values())
                    .filter((user) => user.spaceUserId !== this._spaceUserId)
                    .map((user) => ({ id: user.spaceUserId, name: user.name, pictureStore: user.pictureStore }))
            );
            if (!hasUserInProximityChat && users.size > 1) {
                let name = "unknown";
                // Let's find the first user that is not us
                for (const user of users.values()) {
                    if (user.spaceUserId !== this._spaceUserId) {
                        name = user.name;
                        break;
                    }
                }

                const notificationText = get(LL).notification.discussion({
                    name,
                });
                notificationManager.createNotification(new BasicNotification(notificationText));
            }
            hasUserInProximityChat = users.size > 1;
            this.hasUserInProximityChat.set(users.size > 1);
        });

        const isBlackListed = (sender: string) => {
            const uuid = this.users?.get(sender)?.uuid;
            return uuid && blackListManager.isBlackListed(uuid);
        };

        this.spaceMessageSubscription?.unsubscribe();
        this.spaceStreamMessageSubscription?.unsubscribe();
        this.streamMessages.clear();
        this.spaceMessageSubscription = this._space.observePublicEvent("spaceMessage").subscribe((event) => {
            if (isBlackListed(event.sender)) {
                return;
            }

            // The message has arrived, so its sender is no longer typing it.
            this.removeTypingUserbyID(event.sender);

            this.addNewMessage(
                event.spaceMessage.message,
                event.sender,
                event.spaceMessage.characterTextures ?? [],
                event.spaceMessage.name ?? "",
                event.spaceMessage.url,
                event.spaceMessage.mediaType,
                event.spaceMessage.mimeType,
                event.spaceMessage.galleryUrls,
                event.spaceMessage.fileName,
                event.spaceMessage.fileNames
            );
            // if the proximity chat is not open, open it to see the message
            openChat("bubble");
            this.showIfNothingOpen();
        });

        this.spaceIsTypingSubscription?.unsubscribe();
        this.spaceIsTypingSubscription = this._space.observePublicEvent("spaceIsTyping").subscribe((event) => {
            if (isBlackListed(event.sender)) {
                return;
            }
            if (event.spaceIsTyping.isTyping) {
                this.addTypingUser(event.sender, event.spaceIsTyping.characterTextures, event.spaceIsTyping.name);
            } else {
                this.removeTypingUserbyID(event.sender);
            }
        });

        // Subscribe to streaming bot responses — tokens arrive incrementally
        this.spaceStreamMessageSubscription = this._space
            .observePublicEvent("spaceStreamMessage")
            .subscribe((event) => {
                if (isBlackListed(event.sender)) {
                    return;
                }

                const stream = event.spaceStreamMessage;
                const existing = this.streamMessages.get(stream.responseId);

                if (stream.reset && existing) {
                    // Regeneration: clear old content so new tokens don't concatenate
                    (existing.content as Writable<ChatMessageContent>).set({
                        body: "",
                        url: undefined,
                        urls: undefined,
                        filename: undefined,
                        fileNames: undefined,
                    });
                    return;
                }

                if (existing) {
                    // Update existing stream message
                    const currentBody = get(existing.content).body;
                    if (stream.isError) {
                        // Error: display error message and finalize
                        (existing.content as Writable<ChatMessageContent>).set({
                            body: stream.errorMessage || get(LL).chat.timeLine.streamError(),
                            url: undefined,
                            urls: undefined,
                            filename: undefined,
                            fileNames: undefined,
                        });
                        this.streamMessages.delete(stream.responseId);
                        return;
                    }
                    if (stream.isFinal) {
                        // Final chunk: replace with complete cleaned content.
                        // Use nullish coalescing so an intentionally empty finalContent
                        // ('') clears accumulated partial/detected text rather than
                        // falling through to currentBody.
                        (existing.content as Writable<ChatMessageContent>).set({
                            body: stream.finalContent ?? currentBody ?? "",
                            url: undefined,
                            urls: undefined,
                            filename: undefined,
                            fileNames: undefined,
                        });
                        // Remove from active streams
                        this.streamMessages.delete(stream.responseId);
                    } else {
                        // Append incremental token
                        (existing.content as Writable<ChatMessageContent>).set({
                            body: currentBody + stream.token,
                            url: undefined,
                            urls: undefined,
                            filename: undefined,
                            fileNames: undefined,
                        });
                    }
                    return;
                }

                if (stream.reset) {
                    // Reset on a non-existent stream — ignore
                    return;
                }

                // First chunk is an error with no prior stream — create message with error text
                if (stream.isError) {
                    const spaceUser = this.users?.get(event.sender);
                    let chatUser: AnyKindOfUser = this.unknownUser;
                    if (spaceUser) {
                        chatUser = mapExtendedSpaceUserToChatUser(spaceUser);
                    }
                    const errorMessage = new ProximityChatMessage(
                        uuidv4(),
                        chatUser,
                        writable({
                            body: stream.errorMessage || get(LL).chat.timeLine.streamError(),
                            url: undefined,
                            urls: undefined,
                            filename: undefined,
                            fileNames: undefined,
                        }),
                        new Date(),
                        false,
                        "proximity"
                    );
                    this.messages.push(errorMessage);
                    this.lastMessageTimestamp = errorMessage.date.getTime();
                    this.notifyNewMessage(errorMessage);
                    openChat("bubble");
                    this.showIfNothingOpen();
                    return;
                }

                // First chunk: create message entry (may also be final if response is very fast)
                const initialBody = stream.isFinal ? stream.finalContent ?? stream.token : stream.token;
                // Emotion-only responses send isFinal=true with empty content — don't show a bubble
                if (stream.isFinal && !initialBody) return;
                const spaceUser = this.users?.get(event.sender);
                let chatUser: AnyKindOfUser = this.unknownUser;
                if (spaceUser) {
                    chatUser = mapExtendedSpaceUserToChatUser(spaceUser);
                }

                const newMessage = new ProximityChatMessage(
                    uuidv4(),
                    chatUser,
                    writable({
                        body: initialBody,
                        url: undefined,
                        urls: undefined,
                        filename: undefined,
                        fileNames: undefined,
                    }),
                    new Date(),
                    false,
                    "proximity"
                );

                this.streamMessages.set(stream.responseId, newMessage);
                this.messages.push(newMessage);

                this.lastMessageTimestamp = newMessage.date.getTime();
                this.notifyNewMessage(newMessage);

                this.markUnread();

                // If this was also the final chunk, finalize immediately
                if (stream.isFinal) {
                    this.streamMessages.delete(stream.responseId);
                }

                openChat("bubble");
                this.showIfNothingOpen();
            });

        this.saveChatState();

        const actualStatus = get(availabilityStatusStore);
        if (!isAChatRoomIsVisible()) {
            this.open(this._currentSessionId);
            navChat.switchToChat();
            if (
                !get(requestedMicrophoneState) &&
                !get(requestedCameraState) &&
                (actualStatus === AvailabilityStatus.ONLINE || actualStatus === AvailabilityStatus.AWAY)
            ) {
                // If the user is not on the mobile, open the chat
                // The user experience is disrupted by the chat on mobile
                if (!isMediaBreakpointUp("md")) {
                    openChat("bubble");
                }
            }
        }

        if (!isMeetingRoomChat) {
            // Let's wait for the users to be loaded
            let users: SpaceUserExtended[] = [];
            try {
                users = await this.getFirstUsers(this._space, {
                    signal: this.joinSpaceAbortController.signal,
                });
            } catch (e) {
                this._spaceGeneration++;
                this.usersUnsubscriber?.();
                this._participants.set([]);
                this._spaceKind.set("none");
                this._spaceJoinedAt.set(undefined);
                this._currentSessionId = undefined;
                this.spaceMessageSubscription?.unsubscribe();
                this.spaceIsTypingSubscription?.unsubscribe();
                this.spaceStreamMessageSubscription?.unsubscribe();
                this.streamMessages.clear();
                if (this._space) {
                    this.spaceRegistry.leaveSpace(this._space).catch((error) => {
                        console.error("Error leaving space: ", error);
                        Sentry.captureException(error);
                    });
                }
                this._space = undefined;
                throw e;
            }

            const playersInSpace: MessageUserJoined[] = [];

            for (const spaceUser of users.values()) {
                const player = this.getRemotePlayerFromSpaceUserId(spaceUser.spaceUserId);
                if (player) {
                    playersInSpace.push(player);
                }
            }
            iframeListener.sendJoinProximityMeetingEvent(playersInSpace);
            this.soundManager.playBubbleInSound();
            faviconManager.pushNotificationFavicon();
            screenWakeLock
                .requestWakeLock()
                .then((release) => (this.screenWakeRelease = release))
                .catch((error) => console.error(error));

            // Note: by design, if someone comes talk to us, there should be only one new user in the space.
            // So we know for sure that there is only one new user.
            const peer = Array.from(users.values()).find((user) => user.spaceUserId !== this._spaceUserId);

            if (peer) {
                statusChanger.setUserNameInteraction(peer.name ?? "unknown");
                statusChanger.applyInteractionRules();
            }

            this.addEnteringChatWithUsers(users);
        }

        this.spaceWatcherUserJoinedObserver = this._space.observeUserJoined.subscribe((spaceUser) => {
            debug("User joined space: ", spaceUser);
            if (spaceUser.spaceUserId === this._spaceUserId) {
                return;
            }
            this.addIncomingUser(spaceUser);
        });

        this.spaceWatcherUserLeftObserver = this._space.observeUserLeft.subscribe((spaceUser) => {
            this.addOutcomingUser(spaceUser);
        });

        // Now that we have the complete user list we can listen to incoming and outgoing users
        this.observeUserJoinedSubscription = this._space.observeUserJoined.subscribe((spaceUser) => {
            const player = this.getRemotePlayerFromSpaceUserId(spaceUser.spaceUserId);
            if (player) {
                iframeListener.sendParticipantJoinProximityMeetingEvent(player);
                this.soundManager.playBubbleInSound();
            }
        });

        this.observeUserLeftSubscription = this._space.observeUserLeft.subscribe((spaceUser) => {
            const player = this.getRemotePlayerFromSpaceUserId(spaceUser.spaceUserId);
            if (player) {
                iframeListener.sendParticipantLeaveProximityMeetingEvent(player);
                this.soundManager.playBubbleOutSound();
            }
        });

        this.joinSpaceAbortController = undefined;
    }

    /**
     * Wait for some users (that are not us) to be in the space, and return them.
     */
    private async getFirstUsers(space: SpaceInterface, options: { signal: AbortSignal }): Promise<SpaceUserExtended[]> {
        const users = await space.getUsers({ signal: options.signal });

        const otherUsers = Array.from(users.values()).filter((user) => user.spaceUserId !== this._spaceUserId);
        if (otherUsers.length > 0) {
            return otherUsers;
        }

        return new Promise<SpaceUserExtended[]>((resolve, reject) => {
            const onAbort = (event: Event) => {
                reject(asError(eventToAbortReason(event)));
            };
            const subscription = space.observeUserJoined.subscribe((user) => {
                if (user.spaceUserId !== this._spaceUserId) {
                    resolve([user]);
                    subscription.unsubscribe();
                    options.signal.removeEventListener("abort", onAbort);
                }
            });
            options.signal.addEventListener(
                "abort",
                (event: Event) => {
                    subscription.unsubscribe();
                    reject(asError(eventToAbortReason(event)));
                },
                { once: true }
            );
        });
    }

    private getRemotePlayerFromSpaceUserId(spaceUserId: string) {
        const { /*roomUrl,*/ userId } = this.extractUserIdAndRoomUrlFromSpaceId(spaceUserId);
        // Technically, we should check the roomUrl is the same as the current one.
        // In practice, all users in this space are in the same room.
        return this.remotePlayersRepository.getPlayers().get(userId);
    }

    private extractUserIdAndRoomUrlFromSpaceId(spaceId: string): { roomUrl: string; userId: number } {
        const lastUnderscoreIndex = spaceId.lastIndexOf("_");
        if (lastUnderscoreIndex === -1) {
            throw new Error("Invalid spaceId format: no underscore found");
        }
        const userId = parseInt(spaceId.substring(lastUnderscoreIndex + 1));
        if (isNaN(userId)) {
            throw new Error("Invalid userId format: not a number");
        }
        const roomUrl = spaceId.substring(0, lastUnderscoreIndex);
        return { roomUrl, userId };
    }

    public async leaveSpace(spaceName: string, isMeetingRoomChat: boolean = false): Promise<void> {
        if (this.joinSpaceAbortController) {
            this.joinSpaceAbortController.abort(new AbortError("Leave space called while joining a space"));
            this.joinSpaceAbortController = undefined;

            if (!this._space) {
                // We aborted the join before it completed, so we are done.
                return;
            }
        }
        const space = this._space;
        if (!space) {
            console.error("Trying to leave a space that is not joined");
            return;
        }
        if (space.getName() !== spaceName) {
            console.error("Trying to leave a space different from the one joined");
            return;
        }
        this._space = undefined;
        const endedSessionId = this._currentSessionId;
        // The composer's text for this stay, when the thread is closed: it stays with the stay, as unsent.
        const draft = composerDraftStore.load(this.id, this._spaceGeneration);
        if (draft) {
            composerDraftStore.clear(this.id);
            this.keepUnsentDraft(endedSessionId, draft.message);
        }
        this._spaceGeneration++;

        hideBubbleConfirmationModal();
        iframeListener.sendLeaveProximityMeetingEvent();
        faviconManager.pushOriginalFavicon();
        this.soundManager.playBubbleOutSound();
        if (this.screenWakeRelease) {
            this.screenWakeRelease().catch((error) => console.error(error));
            this.screenWakeRelease = undefined;
        }

        // A bot reply still streaming stops where it is: nothing can reach this stay any more.
        for (const streaming of this.streamMessages.values()) {
            streaming.stoppedOnLeave = true;
        }

        // Always one end marker, even when you were alone in a meeting: it closes the stay.
        const others = this.users
            ? Array.from(this.users.values()).filter((user) => user.spaceUserId !== this._spaceUserId)
            : [];
        const leftPeople = others.map((user) => user.name);
        const endMarker: ProximitySessionMarker = {
            kind: "end",
            label: isMeetingRoomChat
                ? this.meetingSessionLabel ?? get(this.name)
                : formatPeopleNames(leftPeople, {
                      two: get(LL).chat.topRow.twoNames,
                      more: get(LL).chat.topRow.moreNames,
                  }),
            participants: isMeetingRoomChat ? [] : leftPeople,
            participantIds: isMeetingRoomChat ? [] : others.map((user) => user.spaceUserId),
            isArea: isMeetingRoomChat,
            sessionId: endedSessionId,
        };
        let endBody: string;
        if (isMeetingRoomChat) {
            endBody = get(LL).chat.timeLine.youleftMeetingRoom();
        } else if (others.length === 1) {
            endBody = get(LL).chat.timeLine.outcoming({ userName: others[0].name });
        } else {
            endBody = get(LL).chat.timeLine.youLeft();
        }
        this.addSessionMarker(endBody, "outcoming", endMarker);
        this._currentSessionId = undefined;
        this.meetingSessionLabel = undefined;
        this.clearTypingMembers();
        this.hasUserInProximityChat.set(false);
        this._participants.set([]);
        this._spaceKind.set("none");
        this._spaceJoinedAt.set(undefined);

        this.restoreChatState();

        this.spaceWatcherUserJoinedObserver?.unsubscribe();
        this.spaceWatcherUserLeftObserver?.unsubscribe();
        this.spaceWatcherUserJoinedObserver = undefined;
        this.spaceWatcherUserLeftObserver = undefined;
        this.observeUserJoinedSubscription?.unsubscribe();
        this.observeUserLeftSubscription?.unsubscribe();
        this.observeUserJoinedSubscription = undefined;
        this.observeUserLeftSubscription = undefined;
        if (this.usersUnsubscriber) {
            this.usersUnsubscriber();
        }
        this.users = undefined;

        this.spaceMessageSubscription?.unsubscribe();
        this.spaceIsTypingSubscription?.unsubscribe();
        this.spaceStreamMessageSubscription?.unsubscribe();
        this.streamMessages.clear();

        this.scriptingOutputAudioStreamManager?.close();
        this.scriptingInputAudioStreamManager?.close();
        this.scriptingOutputAudioStreamManager = undefined;
        this.scriptingInputAudioStreamManager = undefined;

        try {
            await this.spaceRegistry.leaveSpace(space);
        } catch (error) {
            console.error("Error leaving space: ", error);
            Sentry.captureException(error);
        }
        return undefined;
    }

    private restoreChatState() {
        if (get(selectedRoomStore) == this && get(shouldRestoreChatStateStore)) {
            selectedRoomStore.set(this.currentMatrixRoom);
        }

        chatVisibilityStore.set(this.currentChatVisibility);
        shouldRestoreChatStateStore.set(false);
    }

    private saveChatState() {
        const currentChatVisibility = get(chatVisibilityStore);
        const currentRoom = get(selectedRoomStore);
        this.currentChatVisibility = currentChatVisibility;
        this.currentMatrixRoom = currentRoom;
        shouldRestoreChatStateStore.set(true);
    }

    public dispatchSound(url: URL): Promise<void> {
        if (!this._space) {
            console.error("Trying to dispatch sound in a space that is not joined");
            return Promise.resolve();
        }
        return this._space.dispatchSound(url);
    }

    public destroy(): void {
        this.newChatMessageWritingStatusStreamUnsubscriber.unsubscribe();
        this.startListeningToStreamInBubbleStreamUnsubscriber.unsubscribe();
        this.stopListeningToStreamInBubbleStreamUnsubscriber.unsubscribe();
        this.spaceMessageSubscription?.unsubscribe();
        this.spaceIsTypingSubscription?.unsubscribe();
        this.spaceStreamMessageSubscription?.unsubscribe();
        this.streamMessages.clear();
        this.clearTypingMembers();

        this.scriptingOutputAudioStreamManager?.close();
        this.scriptingInputAudioStreamManager?.close();
        this.spaceWatcherUserJoinedObserver?.unsubscribe();
        this.spaceWatcherUserLeftObserver?.unsubscribe();
        this.observeUserJoinedSubscription?.unsubscribe();
        this.observeUserLeftSubscription?.unsubscribe();
        if (this.usersUnsubscriber) {
            this.usersUnsubscriber();
        }
    }
}
