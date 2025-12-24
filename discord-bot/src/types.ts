export interface RoomStats {
    [roomUrl: string]: number;
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

export interface DiscordMessagePayload {
    content?: string;
    embeds?: DiscordEmbed[];
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

