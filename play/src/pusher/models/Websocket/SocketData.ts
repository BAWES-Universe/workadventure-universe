import type { ClientDuplexStream } from "@grpc/grpc-js";
import type {
    PusherToBackMessage,
    ServerToClientMessage,
    BackToPusherSpaceMessage,
    PusherToBackSpaceMessage,
    ApplicationDefinitionInterface,
    AvailabilityStatus,
    CharacterTextureMessage,
    CompanionTextureMessage,
    BatchMessage,
    SubMessage,
} from "@workadventure/messages";
import type { PusherRoom } from "../PusherRoom";
import type { PointInterface } from "./PointInterface";
import type { ViewportInterface } from "./ViewportMessage";

export type BackConnection = ClientDuplexStream<PusherToBackMessage, ServerToClientMessage>;
export type BackSpaceConnection_ = ClientDuplexStream<PusherToBackSpaceMessage, BackToPusherSpaceMessage>;

export interface BackSpaceConnection extends BackSpaceConnection_ {
    pingTimeout: NodeJS.Timeout | undefined;
}

export type SpaceName = string;

export type SocketData = {
    rejected: false;
    disconnecting: boolean;
    token: string;
    roomId: string;
    userId?: number; // User Id served by the back
    userUuid: string; // Admin UUID
    isLogged: boolean;
    ipAddress: string;
    name: string;
    characterTextures: CharacterTextureMessage[];
    companionTexture?: CompanionTextureMessage;
    position: PointInterface;
    viewport: ViewportInterface;
    availabilityStatus: AvailabilityStatus;
    lastCommandId?: string;
    messages: unknown[];
    tags: string[];
    visitCardUrl: string | null;
    userRoomToken: string | undefined;
    activatedInviteUser: boolean | undefined;
    applications?: Array<ApplicationDefinitionInterface> | null;
    canEdit: boolean;
    spaceUserId: string;
    emitInBatch: (payload: SubMessage) => void;
    batchedMessages: BatchMessage;
    batchTimeout: NodeJS.Timeout | null;
    backConnection?: BackConnection;
    listenedZones: Set<string>;
    pusherRoom: PusherRoom | undefined;
    spaces: Set<SpaceName>;
    joinSpacesPromise: Map<SpaceName, Promise<void>>;
    // The proximity bubbles the back has asked this user to join, by the name the back gives them (without the world
    // prefix). Only these bubble spaces may be joined.
    grantedBubbleSpaces: Set<SpaceName>;
    // Only ever a checked ID: the one Orbit has on file, one the Matrix server confirmed, or a bot's own account.
    chatID?: string;
    // Set while the server checks a chat ID the player just sent proof for (see SocketManager.handleUpdateChatId).
    chatIdVerification?: Promise<void>;
    // What every space of the room is named under: the world, with the universe in front for Orbit rooms
    // (see worldSpaceNamespace).
    world: string;
    currentChatRoomArea: string[];
    roomName: string;
    microphoneState: boolean;
    cameraState: boolean;
    // The broadcast channels of the room, by the space name the front joins them with, and whether this user may go
    // live on each (undefined until the room is joined)
    megaphoneChannels: Map<string, boolean> | undefined;
    // The meeting rooms and speaker zones of the room this user may not join (areas limited to roles they do not
    // have), by the space name the front joins them with. The back sends it with the broadcast channels.
    refusedAreaSpaces?: ReadonlySet<string>;
    // True when the back could not say which meeting rooms and speaker zones this user may join (it has never been
    // able to read the room's areas): they are all refused until it can.
    areaSpacePolicyUnknown?: boolean;
    // The stages of the room this user may listen to but not speak on, by the space name the front joins them with
    // (the back sends it with the broadcast channels), and the ones where a speaker invited them to speak.
    listenOnlyAreaSpaces?: ReadonlySet<string>;
    invitedToSpeak?: Set<string>;
    // The abort controllers for each queries received
    queryAbortControllers: Map<number, AbortController>;
    keepAliveInterval: NodeJS.Timeout | undefined;
};
