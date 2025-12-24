import type { DiscordEmbed, RoomStats, DiscordActionRow } from "../types";

/**
 * Parse room URL to extract universe/world/room structure
 * Example: https://play.workadventure.localhost/@/universe/world/room -> universe/world/room
 */
export function parseRoomUrl(roomUrl: string): string {
    try {
        const url = new URL(roomUrl);
        const pathParts = url.pathname.split("/").filter(Boolean);
        
        // Look for the @ symbol in the path
        const atIndex = pathParts.indexOf("@");
        if (atIndex !== -1 && pathParts.length > atIndex + 3) {
            // Format: @/universe/world/room
            return `${pathParts[atIndex + 1]}/${pathParts[atIndex + 2]}/${pathParts[atIndex + 3]}`;
        }
        
        // Fallback: return last 3 parts or the full path
        if (pathParts.length >= 3) {
            return pathParts.slice(-3).join("/");
        }
        
        return roomUrl;
    } catch {
        // If URL parsing fails, try to extract from string directly
        const match = roomUrl.match(/@\/([^/]+)\/([^/]+)\/([^/]+)/);
        if (match) {
            return `${match[1]}/${match[2]}/${match[3]}`;
        }
        return roomUrl;
    }
}

/**
 * Get the full clickable room URL
 */
function getRoomClickableUrl(roomUrl: string, baseUrl?: string): string {
    // If it's already a full URL, return it
    if (roomUrl.startsWith("http://") || roomUrl.startsWith("https://")) {
        return roomUrl;
    }
    // If we have a base URL, construct the full URL
    if (baseUrl) {
        try {
            const base = new URL(baseUrl);
            // If roomUrl is a path, append it
            if (roomUrl.startsWith("/")) {
                return `${base.origin}${roomUrl}`;
            }
            // If roomUrl is a full path like @/universe/world/room, construct it
            if (roomUrl.startsWith("@/")) {
                return `${base.origin}/${roomUrl}`;
            }
        } catch {
            // If base URL parsing fails, return roomUrl as-is
        }
    }
    return roomUrl;
}

/**
 * Create summary stats embed (first message)
 */
export function createSummaryStatsEmbed(roomStats: RoomStats): DiscordEmbed {
    // Filter out rooms with 0 users
    const activeRooms = Object.entries(roomStats).filter(([, count]) => count > 0);
    const totalUsers = activeRooms.reduce((sum, [, count]) => sum + count, 0);
    const totalRooms = activeRooms.length;

    return {
        title: "🌌 Universe Activity Report",
        description: `**Live statistics from across the Universe**`,
        color: totalUsers > 0 ? 0x5865f2 : 0xffaa00, // Discord blurple if active, orange if empty
        fields: [
            {
                name: "👥 Total Users Online",
                value: `**${totalUsers}** ${totalUsers === 1 ? "person" : "people"}`,
                inline: true,
            },
            {
                name: "🏠 Active Rooms",
                value: `**${totalRooms}** ${totalRooms === 1 ? "room" : "rooms"}`,
                inline: true,
            },
            {
                name: "⏰ Last Updated",
                value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                inline: true,
            },
        ],
    };
}

/**
 * Create individual room embed messages with metadata
 * Returns an array of embeds, one per room with clickable links
 */
export function createRoomEmbeds(
    roomStats: RoomStats, 
    baseUrl?: string,
    roomMetadataMap?: Map<string, { universeName: string; worldName: string; roomName: string }>
): DiscordEmbed[] {
    // Filter out rooms with 0 users and sort by user count (descending)
    const activeRooms = Object.entries(roomStats)
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a);

    if (activeRooms.length === 0) {
        return [{
            title: "🌙 All Quiet",
            description: "No active rooms at the moment. Be the first to explore!",
            color: 0x99aab5,
        }];
    }

    const embeds: DiscordEmbed[] = [];

    // Group rooms by universe/world for better organization
    const roomGroups = new Map<string, Array<{ 
        roomUrl: string; 
        roomPath: string;
        metadata: { universeName: string; worldName: string; roomName: string } | null;
        count: number;
    }>>();

    for (const [roomUrl, count] of activeRooms) {
        const roomPath = parseRoomUrl(roomUrl);
        const metadata = roomMetadataMap?.get(roomPath) || null;
        
        // Use metadata if available, otherwise parse from path
        const universeName = metadata?.universeName || roomPath.split("/")[0] || "Unknown";
        const worldName = metadata?.worldName || (roomPath.split("/")[1] || "Unknown");
        
        const groupKey = `${universeName}/${worldName}`;
        
        if (!roomGroups.has(groupKey)) {
            roomGroups.set(groupKey, []);
        }
        roomGroups.get(groupKey)!.push({ 
            roomUrl, 
            roomPath,
            metadata,
            count 
        });
    }

    // Create one embed per room with improved design
    for (const [group, rooms] of roomGroups.entries()) {
        // Sort rooms within group by user count
        rooms.sort((a, b) => b.count - a.count);

        for (const { roomUrl, metadata, count } of rooms) {
            const clickableUrl = getRoomClickableUrl(roomUrl, baseUrl);
            const emoji = count >= 10 ? "🔥" : count >= 5 ? "⭐" : "💫";
            
            // Use metadata names if available
            const displayRoomName = metadata?.roomName || parseRoomUrl(roomUrl).split("/").pop() || "Unknown Room";
            const displayWorldName = metadata?.worldName || group.split("/")[1] || "Unknown World";
            const displayUniverseName = metadata?.universeName || group.split("/")[0] || "Unknown Universe";
            
            embeds.push({
                title: `${emoji} ${displayRoomName}`,
                description: `**${count}** ${count === 1 ? "person" : "people"} exploring`,
                color: count >= 10 ? 0xff6b6b : count >= 5 ? 0x4ecdc4 : 0x95e1d3,
                fields: [
                    {
                        name: "🌍 Location",
                        value: `**${displayWorldName}** • ${displayUniverseName}`,
                        inline: false,
                    },
                    {
                        name: "🔗 Join Room",
                        value: `[Click to Join →](${clickableUrl})`,
                        inline: false,
                    },
                ],
            });
        }
    }

    return embeds;
}

/**
 * Check if UUID is an email address
 */
function isEmail(uuid: string): boolean {
    return uuid.includes("@") && uuid.includes(".");
}

/**
 * Format user identifier (UUID or "member" if email)
 */
function formatUserIdentifier(uuid: string): string {
    return isEmail(uuid) ? "member" : uuid;
}

/**
 * Create compact one-line join message with button
 */
export function createJoinMessage(
    userName: string,
    roomId: string,
    uuid: string,
    baseUrl?: string,
    roomMetadata?: { universeName: string; worldName: string; roomName: string } | null
): { content: string; components?: DiscordActionRow[] } {
    const roomPath = parseRoomUrl(roomId);
    const clickableUrl = getRoomClickableUrl(roomId, baseUrl);
    const userIdentifier = formatUserIdentifier(uuid);
    
    // Use metadata if available, otherwise fallback to path
    let locationText: string;
    if (roomMetadata) {
        locationText = `in **${roomMetadata.roomName}** in **${roomMetadata.worldName}** at **${roomMetadata.universeName}**`;
    } else {
        // Fallback to path format
        locationText = `\`${roomPath}\``;
    }
    
    return {
        content: `🟢 **${userName}** (${userIdentifier}) has spawned ${locationText}`,
        components: [
            {
                type: 1, // ActionRow
                components: [
                    {
                        type: 2, // Button
                        style: 5, // Link button (opens URL)
                        label: "Join Room",
                        url: clickableUrl,
                        emoji: {
                            name: "🚀"
                        }
                    }
                ]
            }
        ]
    };
}

/**
 * Create Discord embed for user join event (legacy, for compatibility)
 */
export function createJoinEmbed(
    userName: string,
    roomId: string,
    uuid: string,
    baseUrl?: string
): DiscordEmbed {
    const roomPath = parseRoomUrl(roomId);
    const clickableUrl = getRoomClickableUrl(roomId, baseUrl);
    const userIdentifier = formatUserIdentifier(uuid);
    
    return {
        title: "✨ User Joined",
        description: `**${userName}** entered the Universe`,
        color: 0x4ecdc4, // Teal
        fields: [
            {
                name: "👤 User",
                value: userName,
                inline: true,
            },
            {
                name: "🏠 Room",
                value: `\`${roomPath}\``,
                inline: true,
            },
            {
                name: "🔗 Join",
                value: `[Click to Join →](${clickableUrl})`,
                inline: false,
            },
        ],
        footer: {
            text: "Universe Activity",
        },
    };
}

/**
 * Create compact one-line leave message
 */
export function createLeaveMessage(
    userName: string,
    roomId: string,
    uuid: string,
    roomMetadata?: { universeName: string; worldName: string; roomName: string } | null
): { content: string } {
    const roomPath = parseRoomUrl(roomId);
    const userIdentifier = formatUserIdentifier(uuid);
    
    // Use metadata if available, otherwise fallback to path
    let locationText: string;
    if (roomMetadata) {
        locationText = `left **${roomMetadata.roomName}** in **${roomMetadata.worldName}** at **${roomMetadata.universeName}**`;
    } else {
        // Fallback to path format
        locationText = `left \`${roomPath}\``;
    }
    
    return {
        content: `🔴 **${userName}** (${userIdentifier}) ${locationText}`
    };
}

/**
 * Create Discord embed for user leave event (legacy, for compatibility)
 */
export function createLeaveEmbed(
    userName: string,
    roomId: string,
    uuid: string,
    baseUrl?: string
): DiscordEmbed {
    const roomPath = parseRoomUrl(roomId);
    const clickableUrl = getRoomClickableUrl(roomId, baseUrl);
    const userIdentifier = formatUserIdentifier(uuid);
    
    return {
        title: "👋 User Left",
        description: `**${userName}** left the Universe`,
        color: 0x99aab5, // Gray
        fields: [
            {
                name: "👤 User",
                value: userName,
                inline: true,
            },
            {
                name: "🏠 Room",
                value: `\`${roomPath}\``,
                inline: true,
            },
            {
                name: "🔗 Room Link",
                value: `[View Room →](${clickableUrl})`,
                inline: false,
            },
        ],
        footer: {
            text: "Universe Activity",
        },
    };
}

