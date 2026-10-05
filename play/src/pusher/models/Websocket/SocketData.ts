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
    chatID?: string;
    world: string;
    currentChatRoomArea: string[];
    roomName: string;
    microphoneState: boolean;
    cameraState: boolean;
    // The room's megaphone space (as the front names it; null when the room has none, undefined until the room is
    // joined) and whether this user may go live in it
    megaphoneSpaceName: string | null | undefined;
    canUseMegaphone: boolean;
    // The abort controllers for each queries received
    queryAbortControllers: Map<number, AbortController>;
    keepAliveInterval: NodeJS.Timeout | undefined;
};
