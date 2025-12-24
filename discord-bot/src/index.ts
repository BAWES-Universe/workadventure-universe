import * as dotenv from "dotenv";
import { DiscordBot } from "./discord/bot";
import { createJoinMessage, createLeaveMessage, createSummaryStatsEmbed, createRoomEmbeds, parseRoomUrl } from "./discord/channels";
import { RoomDiscovery } from "./workadventure/roomDiscovery";
import { WorkAdventureWebSocket } from "./workadventure/websocket";

dotenv.config();

class DiscordBotService {
    private discordBot: DiscordBot;
    private roomDiscovery: RoomDiscovery;
    private websocket: WorkAdventureWebSocket;
    private statsUpdateInterval: number;
    private statsTimer: NodeJS.Timeout | null = null;
    private pusherUrl: string;

    constructor() {
        let pusherUrl = process.env.PUSHER_URL || "http://play.workadventure.localhost";
        this.pusherUrl = pusherUrl;
        const adminSocketsToken = process.env.ADMIN_SOCKETS_TOKEN || "";
        const adminApiToken = process.env.ADMIN_API_TOKEN || "";
        const discordBotToken = process.env.DISCORD_BOT_TOKEN || "";
        const eventChannelId = process.env.DISCORD_EVENT_CHANNEL_ID || "";
        const statsChannelId = process.env.DISCORD_STATS_CHANNEL_ID || "";
        const roomDiscoveryInterval = parseInt(process.env.ROOM_DISCOVERY_INTERVAL || "30000", 10);
        this.statsUpdateInterval = parseInt(process.env.STATS_UPDATE_INTERVAL || "600000", 10); // 10 minutes

        // Validate required environment variables
        if (!adminSocketsToken) {
            throw new Error("ADMIN_SOCKETS_TOKEN environment variable is required");
        }
        if (!adminApiToken) {
            throw new Error("ADMIN_API_TOKEN environment variable is required");
        }
        if (!discordBotToken) {
            throw new Error("DISCORD_BOT_TOKEN environment variable is required");
        }
        if (!eventChannelId) {
            throw new Error("DISCORD_EVENT_CHANNEL_ID environment variable is required");
        }
        if (!statsChannelId) {
            throw new Error("DISCORD_STATS_CHANNEL_ID environment variable is required");
        }

        // Convert PUSHER_URL to use Docker service name for dev environments
        // In Docker containers, hostnames like "play.workadventure.localhost" don't resolve
        // We need to use the Docker service name "play" directly
        try {
            const url = new URL(pusherUrl);
            const isLocalhost = url.hostname === "localhost" || 
                               url.hostname === "127.0.0.1" ||
                               url.hostname.endsWith(".localhost") ||
                               url.hostname === "play";
            
            if (isLocalhost && url.hostname !== "play") {
                // Replace hostname with Docker service name and use port 3000 for HTTP
                pusherUrl = `${url.protocol}//play:3000`;
                console.log(`Converted PUSHER_URL to use Docker service name: ${pusherUrl}`);
            }
        } catch (e) {
            console.warn(`Failed to parse PUSHER_URL: ${pusherUrl}`, e);
        }

        // Initialize components
        const adminApiUrl = process.env.ADMIN_API_URL;
        this.discordBot = new DiscordBot(discordBotToken, eventChannelId, statsChannelId);
        this.roomDiscovery = new RoomDiscovery(pusherUrl, adminApiToken, roomDiscoveryInterval, adminApiUrl);

        // Initialize WebSocket with event handlers
        this.websocket = new WorkAdventureWebSocket(pusherUrl, adminSocketsToken, {
            onUserJoin: async (data) => {
                console.log(`User joined: ${data.name} (${data.uuid}) in room ${data.roomId}`);
                const roomPath = parseRoomUrl(data.roomId);
                const roomMetadata = await this.roomDiscovery.getRoomMetadata(roomPath);
                const message = createJoinMessage(data.name, data.roomId, data.uuid, this.pusherUrl, roomMetadata);
                this.discordBot.sendEventMessage(message);
            },
            onUserLeave: async (data) => {
                console.log(`User left: ${data.name} (${data.uuid}) from room ${data.roomId}`);
                const roomPath = parseRoomUrl(data.roomId);
                const roomMetadata = await this.roomDiscovery.getRoomMetadata(roomPath);
                const message = createLeaveMessage(data.name, data.roomId, data.uuid, roomMetadata);
                this.discordBot.sendEventMessage(message);
            },
            onError: (error) => {
                console.error("WebSocket error:", error);
            },
            onReconnect: () => {
                console.log("Reconnecting WebSocket...");
            },
        });
    }

    async start(): Promise<void> {
        console.log("Starting Discord Bot Service...");
        console.log(`Pusher URL: ${process.env.PUSHER_URL || "http://play.workadventure.localhost"}`);
        console.log(`Room discovery interval: ${process.env.ROOM_DISCOVERY_INTERVAL || "30000"}ms`);
        console.log(`Stats update interval: ${this.statsUpdateInterval / 1000 / 60} minutes`);

        // Start room discovery
        this.roomDiscovery.startPolling(async (newRooms) => {
            console.log(`Discovered ${newRooms.length} new rooms:`, newRooms);
            
            // Update WebSocket authorized rooms
            const allRooms = this.roomDiscovery.getAllRooms();
            this.websocket.updateAuthorizedRooms(allRooms);

            // If WebSocket is not connected, connect now
            if (!this.websocket.isConnected()) {
                await this.websocket.connect();
            }
        });

        // Initial room fetch and WebSocket connection
        const initialRooms = await this.roomDiscovery.getNewRooms();
        if (initialRooms.length > 0) {
            console.log(`Initial discovery: ${initialRooms.length} rooms found`);
            const allRooms = this.roomDiscovery.getAllRooms();
            this.websocket.updateAuthorizedRooms(allRooms);
        }

        // Connect WebSocket
        await this.websocket.connect();

        // Start stats update scheduler
        this.startStatsScheduler();

        // Handle graceful shutdown
        process.on("SIGINT", () => this.shutdown());
        process.on("SIGTERM", () => this.shutdown());
    }

    /**
     * Start the stats update scheduler
     */
    private startStatsScheduler(): void {
        // Run immediately on startup
        this.updateStatsChannel();

        // Then run on schedule
        this.statsTimer = setInterval(() => {
            this.updateStatsChannel();
        }, this.statsUpdateInterval);
    }

    /**
     * Update the stats channel with current room activity
     */
    private async updateStatsChannel(): Promise<void> {
        try {
            console.log("Updating stats channel...");
            const roomStats = await this.roomDiscovery.getRoomStats();
            
            // Fetch metadata for all active rooms
            const roomMetadataMap = new Map<string, { universeName: string; worldName: string; roomName: string }>();
            const activeRooms = Object.entries(roomStats).filter(([, count]) => count > 0);
            
            // Fetch metadata for all rooms in parallel
            const metadataPromises = activeRooms.map(async ([roomUrl]) => {
                const roomPath = parseRoomUrl(roomUrl);
                const metadata = await this.roomDiscovery.getRoomMetadata(roomPath);
                if (metadata) {
                    roomMetadataMap.set(roomPath, metadata);
                }
                return metadata;
            });
            
            // Wait for all metadata fetches
            await Promise.all(metadataPromises);
            
            // Create summary embed
            const summaryEmbed = createSummaryStatsEmbed(roomStats);
            
            // Create individual room embeds with metadata
            const roomEmbeds = createRoomEmbeds(roomStats, this.pusherUrl, roomMetadataMap);
            
            // Send all messages (clears channel first, then sends summary + room messages)
            await this.discordBot.sendStatsReport(
                { embeds: [summaryEmbed] },
                roomEmbeds.map(embed => ({ embeds: [embed] }))
            );
            
            console.log(`Stats channel updated successfully with ${roomEmbeds.length} room${roomEmbeds.length === 1 ? '' : 's'}`);
        } catch (error) {
            console.error("Failed to update stats channel:", error);
        }
    }

    /**
     * Graceful shutdown
     */
    private shutdown(): void {
        console.log("Shutting down Discord Bot Service...");
        
        if (this.statsTimer) {
            clearInterval(this.statsTimer);
            this.statsTimer = null;
        }

        this.roomDiscovery.stopPolling();
        this.websocket.disconnect();

        process.exit(0);
    }
}

// Start the service
const service = new DiscordBotService();
service.start().catch((err) => {
    console.error("Failed to start service:", err);
    process.exit(1);
});

