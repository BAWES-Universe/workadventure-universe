import type { DiscordEmbed, RoomStats } from "../types";

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
 * Create Discord embed for stats report
 */
export function createStatsEmbed(roomStats: RoomStats): DiscordEmbed {
    const totalUsers = Object.values(roomStats).reduce((sum, count) => sum + count, 0);
    const totalRooms = Object.keys(roomStats).length;

    // Sort rooms by user count (descending) and take top 20
    const roomEntries = Object.entries(roomStats)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20);

    const fields: Array<{ name: string; value: string; inline: boolean }> = [
        {
            name: "Total Users Online",
            value: totalUsers.toString(),
            inline: true,
        },
        {
            name: "Active Rooms",
            value: totalRooms.toString(),
            inline: true,
        },
        {
            name: "\u200b", // Empty field for spacing
            value: "\u200b",
            inline: true,
        },
    ];

    if (totalUsers > 0 && roomEntries.length > 0) {
        fields.push({
            name: "Room Breakdown",
            value: "Top active rooms:",
            inline: false,
        });

        // Group rooms by universe/world for better organization
        const roomGroups = new Map<string, Array<{ room: string; count: number }>>();

        for (const [roomUrl, count] of roomEntries) {
            const roomPath = parseRoomUrl(roomUrl);
            const parts = roomPath.split("/");
            if (parts.length >= 2) {
                const groupKey = `${parts[0]}/${parts[1]}`;
                if (!roomGroups.has(groupKey)) {
                    roomGroups.set(groupKey, []);
                }
                roomGroups.get(groupKey)!.push({ room: parts[2] || roomPath, count });
            } else {
                // Fallback for rooms that don't match expected format
                if (!roomGroups.has("Other")) {
                    roomGroups.set("Other", []);
                }
                roomGroups.get("Other")!.push({ room: roomPath, count });
            }
        }

        // Add room breakdown fields
        for (const [group, rooms] of roomGroups.entries()) {
            const roomList = rooms
                .sort((a, b) => b.count - a.count)
                .map((r) => `• **${r.room}**: ${r.count} ${r.count === 1 ? "user" : "users"}`)
                .join("\n");

            fields.push({
                name: group,
                value: roomList || "No active rooms",
                inline: false,
            });
        }

        if (totalRooms > 20) {
            fields.push({
                name: `+${totalRooms - 20} more rooms`,
                value: "...",
                inline: false,
            });
        }
    }

    return {
        title: "📊 WorkAdventure Room Activity",
        description: "Current room activity and user distribution",
        color: totalUsers > 0 ? 0x00ff00 : 0xffaa00, // Green if users online, orange if empty
        fields,
        timestamp: new Date().toISOString(),
        footer: {
            text: "Universe Admin - Activity Report",
        },
    };
}

/**
 * Create Discord embed for user join event
 */
export function createJoinEmbed(
    userName: string,
    roomId: string,
    uuid: string
): DiscordEmbed {
    return {
        title: "✅ User Connected",
        description: `**${userName}** joined the room`,
        color: 0x00ff00, // Green
        timestamp: new Date().toISOString(),
        fields: [
            {
                name: "User",
                value: userName,
                inline: true,
            },
            {
                name: "Room",
                value: parseRoomUrl(roomId),
                inline: true,
            },
            {
                name: "UUID",
                value: uuid,
                inline: false,
            },
        ],
    };
}

/**
 * Create Discord embed for user leave event
 */
export function createLeaveEmbed(
    userName: string,
    roomId: string,
    uuid: string
): DiscordEmbed {
    return {
        title: "❌ User Disconnected",
        description: `**${userName}** left the room`,
        color: 0xff0000, // Red
        timestamp: new Date().toISOString(),
        fields: [
            {
                name: "User",
                value: userName,
                inline: true,
            },
            {
                name: "Room",
                value: parseRoomUrl(roomId),
                inline: true,
            },
            {
                name: "UUID",
                value: uuid,
                inline: false,
            },
        ],
    };
}

