import type { Readable, Writable } from "svelte/store";
import type { AvailabilityStatus } from "@workadventure/messages";
import type { MapStore } from "@workadventure/store-utils";
import type { StateEvents } from "matrix-js-sdk";
import type { AppOffer, BrickOffer, GuestChatLine, MadeBrick } from "../Bricks/Brick";
import type { BotStatusNote } from "../Bots/BotChatStatus";
import type { BotRoomLink } from "../Bots/BotRoomLink";
import type { BotReplyLimit } from "../Bots/BotReplyLimit";
import type { BotSteps } from "../Bots/BotSteps";
import type { NoteTranscript } from "../Bots/BotTranscript";
import type { ArtifactCard } from "../../Artifacts/artifactCard";
import type { BotAsk, BotAskTap } from "../Bots/BotAsk";
import type { RoomConnection } from "../../Connection/RoomConnection";
import type { PictureStore } from "../../Stores/PictureStore";
import type { HeldRole } from "../Roles/WorldRoles";
import type { ChatPusher } from "../../Notification/Push/PushChat";

export type memberTypingInformation = { id: string; name: string | null; pictureStore: PictureStore };
/**
 * How long (ms) someone still shows as typing after their "stopped" (#1379): a stop and a start close together never
 * make the dots blink. Their message arriving takes the dots away at once.
 */
export const TYPING_STOP_GRACE_MS = 1500;
export type ChatPresence = "online" | "away" | "offline";

export type ChatUser = {
    chatId: string;
    uuid?: string;
    availabilityStatus: Readable<AvailabilityStatus>;
    /** On a call with a Brick right now (game #2004): a label next to the status, never a status. */
    onACall?: Readable<boolean | undefined>;
    username: string | undefined;
    pictureStore: PictureStore | undefined;
    /** Their saved Woka, drawn only when shown: what a person who is away looks like, until they have a live one. */
    storedWoka?: PictureStore;
    /** The name they go by in Universe (the game's, or the back office's), never the chat account's. */
    gameName?: string;
    roomName: string | undefined;
    playUri: string | undefined;
    isAdmin?: boolean;
    isMember?: boolean;
    /** The roles they hold that Orbit named, highest first (show them with rolesToShow). Member is automatic and not listed. */
    roles?: HeldRole[];
    /** A bot (AI character) rather than a person. */
    isBot?: boolean;
    visitCardUrl?: string;
    color: string | undefined;
    spaceUserId: string | undefined;
};

export type AdminUser = {
    chatId?: string;
    uuid: string;
    availabilityStatus: Readable<AvailabilityStatus>;
    /** On a call with a Brick right now (game #2004): a label next to the status, never a status. */
    onACall?: Readable<boolean | undefined>;
    username: string | undefined;
    pictureStore: PictureStore | undefined;
    /** Their saved Woka, drawn only when shown: what a person who is away looks like, until they have a live one. */
    storedWoka?: PictureStore;
    /** The name they go by in Universe (the game's, or the back office's), never the chat account's. */
    gameName?: string;
    roomName: string | undefined;
    playUri: string | undefined;
    isAdmin?: boolean;
    isMember?: boolean;
    /** The roles they hold that Orbit named, highest first (show them with rolesToShow). Member is automatic and not listed. */
    roles?: HeldRole[];
    /** A bot (AI character) rather than a person. */
    isBot?: boolean;
    visitCardUrl?: string;
    color: string | undefined;
    spaceUserId: string | undefined;
};

export type AnyKindOfUser = ChatUser | AdminUser;

export type PartialChatUser = Partial<ChatUser> & { chatId: string };
export type PartialAdminUser = Partial<AdminUser> & { uuid: string };
export type PartialAnyKindOfUser = PartialChatUser | PartialAdminUser;

export type ChatRoomMembership = "ban" | "leave" | "knock" | "join" | "invite" | string;

export enum ChatPermissionLevel {
    USER = "USER",
    MODERATOR = "MODERATOR",
    ADMIN = "ADMIN",
}

export type ModerationAction = "ban" | "kick" | "invite" | "redact";

export interface ChatRoomMember {
    id: string;
    name: Readable<string>;
    membership: Readable<ChatRoomMembership>;
    permissionLevel: Readable<ChatPermissionLevel>;
}
export interface ChatRoom {
    readonly id: string;
    readonly name: Readable<string>;
    readonly type: "direct" | "multiple";
    readonly hasUnreadMessages: Readable<boolean>;
    readonly unreadNotificationCount: Readable<number>;
    readonly pictureStore: PictureStore;
    readonly messages: Readable<readonly ChatMessage[]>;
    readonly sendMessage: (
        message: string,
        type?: ChatMessageType,
        broadcast?: boolean,
        url?: string,
        mediaType?: string,
        mimeType?: string,
        galleryUrls?: string[]
    ) => void;
    readonly sendFiles: (files: FileList) => Promise<void>;
    /** Taps on a bot's card (#1657): sends only the card's id and revision and what was tapped. Direct messages with bots. */
    readonly answerBotAsk?: (ask: Pick<BotAsk, "id" | "revision">, tap: BotAskTap) => Promise<void>;
    readonly setTimelineAsRead: () => void;
    readonly hasPreviousMessage: Readable<boolean>;
    readonly loadMorePreviousMessages: () => Promise<void>;
    /** True while the room is still getting its first messages (so an empty list is not yet "no message"). */
    readonly isLoadingMessages?: Readable<boolean>;
    readonly isEncrypted: Readable<boolean>;
    readonly typingMembers: Readable<Array<{ id: string; name: string | null; pictureStore: PictureStore }>>;
    readonly startTyping: () => Promise<object>;
    readonly stopTyping: () => Promise<object>;
    readonly isRoomFolder: boolean;
    readonly lastMessageTimestamp: number;
    /** For a pending invitation: when the invite was sent (ms), if the invite event carries a time. */
    readonly inviteTimestamp?: number;
    /** For a pending invitation: the display name of whoever sent it, if known. */
    readonly inviterName?: string;
}

/** Accepting an invitation failed because it no longer exists (the room was left or the invite withdrawn). */
export class InvitationNoLongerAvailableError extends Error {
    constructor(options?: { cause?: unknown }) {
        super("Invitation no longer available", options);
        this.name = "InvitationNoLongerAvailableError";
    }
}

/** A chat whose messages can be pinned for everyone in it (Matrix keeps the list in the room's state). */
export interface ChatRoomPins {
    /** The pinned messages' ids, the most recently pinned last. */
    readonly pinnedMessageIds: Readable<string[]>;
    /** Whether this person may pin and unpin in this chat (both people in a direct chat; Admins and Moderators in a group). */
    readonly canPinMessages: Readable<boolean>;
    readonly setMessagePinned: (messageId: string, pinned: boolean) => Promise<void>;
    /** A pinned message that is not loaded yet is fetched on its own. */
    readonly getMessageById: (messageId: string) => Promise<ChatMessage | undefined>;
}

export function hasPins(room: ChatRoom | undefined): room is ChatRoom & ChatRoomPins {
    return room !== undefined && "pinnedMessageIds" in room && "setMessagePinned" in room;
}

export interface ChatRoomMembershipManagement {
    readonly name: Readable<string>;
    readonly myMembership: Readable<ChatRoomMembership>;
    readonly members: Readable<ChatRoomMember[]>;
    readonly joinRoom: () => Promise<void>;
    /**
     * Leaves the room. With `forget` it also forgets it, so it is gone from this person's apps for good (a deleted chat),
     * not left behind as an empty room.
     */
    readonly leaveRoom: (options?: { forget?: boolean }) => Promise<void>;
}

export interface ChatRoomNotificationControl {
    readonly areNotificationsMuted: Readable<boolean>;
    readonly unmuteNotification: () => Promise<void>;
    readonly muteNotification: () => Promise<void>;
}

export interface ChatRoomModeration {
    readonly id: string;
    readonly inviteUsers: (userIds: string[]) => Promise<void>;
    readonly hasPermissionTo: (action: ModerationAction, member?: ChatRoomMember) => Readable<boolean>;
    readonly hasPermissionForRoomStateEvent: (eventType: keyof StateEvents) => Readable<boolean>;
    readonly kick: (userID: string) => Promise<void>;
    readonly ban: (userID: string) => Promise<void>;
    readonly unban: (userID: string) => Promise<void>;
    readonly changePermissionLevelFor: (member: ChatRoomMember, permissionLevel: ChatPermissionLevel) => Promise<void>;
    readonly getAllowedRolesToAssign: () => ChatPermissionLevel[];
    readonly canModifyRoleOf: (permissionLevel?: ChatPermissionLevel) => boolean;
}

//Readonly attributes
/**
 * Why a voice bot's reply for one person alone was not heard to its end (#1993): `unsaid` when it was not said out loud
 * at all, `stopped` when its voice stopped part-way. Empty when there is nothing to say about it.
 */
export type KeptQuiet = "" | "unsaid" | "stopped";

export interface ChatMessage {
    id: string;
    sender: AnyKindOfUser | undefined;
    content: Readable<ChatMessageContent>;
    isMyMessage: boolean;
    isQuotedMessage: boolean | undefined;
    date: Date | null;
    quotedMessage: ChatMessage | undefined;
    type: ChatMessageType;
    reactions: MapStore<string, ChatMessageReaction>;
    remove: () => void;
    edit: (newContent: string) => Promise<void>;
    isDeleted: Readable<boolean>;
    isModified: Readable<boolean>;
    addReaction: (reaction: string) => Promise<void>;
    canDelete: Readable<boolean>;
    /** Set when a bot left a status note (resting, gone...) instead of an answer: drawn as a card, not a bubble. */
    botStatus?: BotStatusNote;
    /** When a bot's status note was sent, on this device's clock, so it compares with this device's lookups. */
    botStatusAt?: number;
    /** Set when a bot's reply names the room it lives in: a card under the message takes you there. */
    roomLink?: BotRoomLink;
    /** Set when a bot did not answer because the person reached a reply limit (#1159): drawn as the fixed card. */
    replyLimit?: BotReplyLimit;
    /** Set on a nearby line made from what its sender said out loud to a voice bot (#1664): a small mic mark beside its time. */
    spoken?: boolean;
    /** Set on a voice bot's reply whose voice stopped part-way because someone spoke over it (#1665): a quiet line under it. */
    stoppedBySpeech?: Readable<boolean>;
    /**
     * Set on a voice bot's reply written for this person alone (#1993), when its voice would have reached someone else
     * too: it was not said out loud, or it stopped part-way. A quiet line under it says which.
     */
    keptQuiet?: Readable<KeptQuiet>;
    /** Set on a voice bot's reply in nearby chat (round 8): which reply it is, so it can show Stop speaking while it is heard. */
    voiceReply?: { responseId: string; botSpaceUserId: string };
    /** Set when a bot's direct message carries an artifact it made: drawn as a card the person taps to open. */
    artifact?: ArtifactCard;
    /** Set on a bot's direct message that is the one copy of an answer it gave this person alone in nearby chat (#1993): a quiet line under it says so. */
    answeredNearby?: boolean;
    /** Set on a Brick's fixed "what I can do" answer (#1995): while it is the newest message, its ideas show above the message box. */
    brickIdeas?: boolean;
    /** The Bricks a Brick made while writing this answer (#1996): each is one tap from its chat, under the answer. */
    brickMade?: MadeBrick[];
    /**
     * Set on the one message a Brick leaves when someone signs in with a chat they had with the Brick for guests
     * (#1997): the lines of that chat, which the chat draws as they were said, then the Brick's welcome.
     */
    guestChat?: GuestChatLine[];
    /** Set on a guest Brick's answer that says something needs an account (#1997): while it is the newest message, "Keep Brick?" shows above the message box. */
    guestKeep?: boolean;
    /** Set on a message the game drew itself on this device (#1997): nothing was sent, so there is nothing to react to, reply to, edit or delete. */
    local?: boolean;
    /** Set on a Brick's suggestion of a Brick for a job that keeps coming back (#1996): while it is the newest message
     * it is a card above the message box, afterwards its question stays in the chat. */
    brickOffer?: BrickOffer;
    /** Set on a Brick's offer to connect an App (#2001): while it is the newest message it is a card above the message box. */
    appOffer?: AppOffer;
    /** Set when a bot's direct message is a card that waits for one answer (#1657): pinned above the message box while
     * it waits, then drawn in the chat as it ended. The bot server edits the same notice. */
    ask?: Readable<BotAsk | undefined>;
    /** Set when a bot's notice is the steps line of its reply (#1545): drawn as a quiet line that updates in place. */
    steps?: Readable<BotSteps | undefined>;
    /** Set when a bot's notice only carries what it heard in a voice note: never drawn, its words show in the note's bubble. */
    transcriptNotice?: boolean;
    /** Whether reactions on this message reach the other people in the chat. */
    canReact: Readable<boolean>;
    /** Whether a reply to this message is sent as a reply (with its quote) to the other people in the chat. */
    canReply: Readable<boolean>;
    /**
     * For a file, picture or video: its name and size as the message gives them, read without fetching the file, so
     * the chat's details can list everything shared without downloading it all.
     */
    readonly sharedFile?: SharedFileInfo;
}

export interface SharedFileInfo {
    name: string;
    /** In bytes, when the message says. */
    size: number | undefined;
    /** A voice message: it stays in the conversation, it is not listed with what the chat shared. */
    voice: boolean;
}

export interface ChatMessageReaction {
    key: string;
    users: MapStore<string, ChatUser>;
    react: () => void;
    reacted: Readable<boolean>;
}

export type ChatMessageType =
    | "proximity"
    | "text"
    | "incoming"
    | "outcoming"
    | "image"
    | "file"
    | "audio"
    | "video"
    | "gallery";
export type ChatMessageContent = {
    /**
     * The body can contain HTML. It will be run against DOMPurify before being outputted to the user.
     */
    body: string;
    url: string | undefined;
    urls: string[] | undefined;
    filename: string | undefined;
    fileNames: string[] | undefined;
    /** A recorded voice message (Matrix MSC3245), as opposed to an audio file. */
    isVoice?: boolean;
    /** How long a voice message is, in seconds, when its sender wrote it down. */
    voiceDuration?: number;
    /** The shape of a voice message: levels from 0 to 1, when its sender wrote it down. */
    voiceWaveform?: number[];
    /** The file could not be fetched (gone, or the network failed). It is tried again the next time it is shown. */
    mediaFailed?: boolean;
    /** The file no longer exists (a guest's file that did not come along after sign-in): its bubble says it is gone. */
    mediaGone?: boolean;
    /** What a bot heard in a voice message (shown inside the note's bubble), once it was asked to listen. */
    transcript?: NoteTranscript;
};
export const historyVisibilityOptions = ["joined", "invited", "world_readable"] as const;
export type historyVisibility = (typeof historyVisibilityOptions)[number];

export interface RoomFolder extends ChatRoom, ChatRoomMembershipManagement, ChatRoomModeration {
    id: string;
    name: Readable<string>;
    rooms: Readable<ChatRoom[]>;
    folders: Readable<RoomFolder[]>;
    invitations: Readable<ChatRoom[]>;
    suggestedRooms: Readable<{ name: string; id: string; avatarUrl: string }[]>;
    joinableRooms: Readable<{ name: string; id: string; avatarUrl: string }[]>;
    hasChildRoomsError: Writable<boolean>;
}

export interface CreateRoomOptions {
    name?: string;
    visibility?: "private" | "public" | "restricted";
    is_direct?: boolean;
    historyVisibility?: historyVisibility;
    invite?: { value: string; label: string }[];
    preset?: "private_chat" | "public_chat" | "trusted_private_chat";
    encrypt?: boolean;
    parentSpaceID?: string;
    description?: string;
    suggested?: boolean;
}

export type ConnectionStatus = "ONLINE" | "ON_ERROR" | "CONNECTING" | "OFFLINE";

export type userId = number;
export type ChatId = string & { __chatIdBrand: never };
export type UserUuid = string & { __userUuidBrand: never };
export type ChatSpaceRoom = ChatRoom;
export interface ChatConnectionInterface {
    connectionStatus: Readable<ConnectionStatus>;
    directRooms: Readable<ChatRoom[]>;
    rooms: Readable<(ChatRoom & ChatRoomMembershipManagement)[]>;
    invitations: Readable<ChatRoom[]>;
    folders: Readable<RoomFolder[]>;
    createRoom: (roomOptions: CreateRoomOptions) => Promise<{ room_id: string }>;
    createFolder: (roomOptions: CreateRoomOptions) => Promise<{ room_id: string }>;
    createDirectRoom(userChatId: string): Promise<(ChatRoom & ChatRoomMembershipManagement) | undefined>;
    roomCreationInProgress: Readable<boolean>;
    getDirectRoomFor(userChatId: string): (ChatRoom & ChatRoomMembershipManagement) | undefined;
    searchAccessibleRooms(searchText: string): Promise<
        {
            id: string;
            name: string | undefined;
        }[]
    >;

    joinRoom(roomId: string): Promise<ChatRoom | undefined>;

    destroy(): Promise<void>;
    searchChatUsers(searchText: string): Promise<{ id: string; name: string | undefined }[] | undefined>;
    isEncryptionRequiredAndNotSet: Readable<boolean>;
    initEndToEndEncryption(): Promise<void>;
    isGuest: Readable<boolean>;
    hasUnreadMessages: Readable<boolean>;
    clearListener: () => void;
    directRoomsUsers: Readable<ChatUser[]>;
    isUserExist: (address: string) => Promise<boolean>;
    getRoomByID(roomId: string): ChatRoom;
    retrySendingEvents: () => Promise<void>;
    shouldRetrySendingEvents: Readable<boolean>;
    /** Whether someone is online on chat, from any app (the game, Element...). */
    userPresence(userChatId: string): Readable<ChatPresence>;
    /** People you blocked in chat: their messages are hidden on every device. */
    ignoredUsers: Readable<string[]>;
    setUserIgnored(userChatId: string, ignored: boolean): Promise<void>;
    /**
     * Sends this account's notifications for one device to a push gateway while Universe is closed (#863). False when
     * this connection has nowhere to set it: no chat here, or a guest.
     */
    setPusher(pusher: ChatPusher): Promise<boolean>;
}

export type Connection = Pick<RoomConnection, "queryChatMembers" | "emitPlayerChatID" | "emitBanPlayerMessage">;
