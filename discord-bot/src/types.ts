export interface RoomStats {
    [roomUrl: string]: number;
}

/** Who is in one open room (the pusher's GET /rooms/details, #1389). */
export interface RoomDetails {
    /** People, bots left out. */
    people: number;
    bots: number;
    /** The people's names as shown in game, one per account. */
    names: string[];
}

export interface RoomDetailsMap {
    [roomUrl: string]: RoomDetails;
}

/** A room's names in Orbit (GET /api/room/info). universeColour is missing on an Orbit that predates it. */
export interface RoomMetadata {
    universeName: string;
    worldName: string;
    roomName: string;
    universeColour?: string;
}

export interface UserCacheEntry {
    name: string;
    roomId: string;
}

export interface DiscordEmbed {
    title?: string;
    description?: string;
    color?: number;
    timestamp?: string;
    fields?: Array<{
        name: string;
        value: string;
        inline?: boolean;
    }>;
    footer?: {
        text: string;
    };
}

export interface DiscordButton {
    type: 2; // Button component type
    style: 1 | 2 | 3 | 4 | 5; // 1=Primary, 2=Secondary, 3=Success, 4=Danger, 5=Link
    label: string;
    url?: string; // Required for Link buttons (style 5)
    custom_id?: string; // Required for non-link buttons
    emoji?: {
        name?: string;
        id?: string;
    };
    disabled?: boolean;
}

export interface DiscordActionRow {
    type: 1; // ActionRow component type
    components: DiscordButton[];
}

export interface DiscordMessagePayload {
    content?: string;
    embeds?: DiscordEmbed[];
    components?: DiscordActionRow[]; // For buttons
}

export interface WebSocketMessage {
    type: string;
    data?: {
        uuid?: string;
        name?: string;
        ipAddress?: string;
        roomId?: string;
    };
}

export interface MemberJoinData {
    uuid: string;
    name: string;
    ipAddress: string;
    roomId: string;
}

export interface MemberLeaveData {
    uuid: string;
}

