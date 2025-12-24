import WebSocket from "ws";
import jwt from "jsonwebtoken";
import type { WebSocketMessage, UserCacheEntry, MemberJoinData, MemberLeaveData } from "../types";

export interface WebSocketEventHandlers {
    onUserJoin: (data: MemberJoinData) => void;
    onUserLeave: (data: MemberLeaveData & { name: string; roomId: string }) => void;
    onError: (error: Error) => void;
    onReconnect: () => void;
}

export class WorkAdventureWebSocket {
    private pusherUrl: string;
    private adminSocketsToken: string;
    private ws: WebSocket | null = null;
    private isConnecting: boolean = false;
    private reconnectInterval: number = 5000;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private userCache: Map<string, UserCacheEntry> = new Map();
    private subscribedRooms: Set<string> = new Set();
    private authorizedRoomIds: string[] = [];
    private eventHandlers: WebSocketEventHandlers;

    constructor(
        pusherUrl: string,
        adminSocketsToken: string,
        eventHandlers: WebSocketEventHandlers
    ) {
        this.pusherUrl = pusherUrl;
        this.adminSocketsToken = adminSocketsToken;
        this.eventHandlers = eventHandlers;
    }

    /**
     * Generate JWT token with authorized room IDs
     */
    private generateJWT(roomIds: string[]): string {
        return jwt.sign({ authorizedRoomIds: roomIds }, this.adminSocketsToken, {
            expiresIn: "1h",
        });
    }

    /**
     * Update authorized rooms and regenerate JWT if needed
     */
    updateAuthorizedRooms(roomIds: string[]): void {
        // Only update if the list has changed
        const newRooms = new Set(roomIds);
        const currentRooms = new Set(this.authorizedRoomIds);

        if (
            newRooms.size !== currentRooms.size ||
            !Array.from(newRooms).every((room) => currentRooms.has(room))
        ) {
            this.authorizedRoomIds = roomIds;
            // If connected, we need to reconnect with new JWT
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                console.log("Authorized rooms changed, reconnecting WebSocket...");
                this.ws.close();
            }
        }
    }

    /**
     * Connect to Admin WebSocket
     */
    async connect(): Promise<void> {
        if (this.isConnecting) {
            return;
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        this.isConnecting = true;

        try {
            const wsUrl = `${this.pusherUrl.replace(/^http/, "ws")}/ws/admin/rooms`;
            const jwtToken = this.generateJWT(this.authorizedRoomIds);

            this.ws = new WebSocket(wsUrl);

            this.ws.on("open", () => {
                console.log("Connected to WorkAdventure Admin WebSocket");
                this.isConnecting = false;

                // Send JWT and subscribe to all rooms
                const subscribeMessage = {
                    event: "listen",
                    jwt: jwtToken,
                    roomIds: this.authorizedRoomIds,
                };

                this.ws?.send(JSON.stringify(subscribeMessage));
                console.log(`Subscribed to ${this.authorizedRoomIds.length} rooms`);
            });

            this.ws.on("message", (data: WebSocket.Data) => {
                try {
                    const message: WebSocketMessage = JSON.parse(data.toString());
                    this.handleMessage(message);
                } catch (error) {
                    console.error("Error parsing WebSocket message:", error);
                }
            });

            this.ws.on("error", (error) => {
                console.error("WebSocket error:", error);
                this.isConnecting = false;
                this.scheduleReconnect();
            });

            this.ws.on("close", () => {
                console.log("WebSocket closed. Reconnecting in 5 seconds...");
                this.isConnecting = false;
                this.scheduleReconnect();
            });
        } catch (error) {
            console.error("Failed to connect to WebSocket:", error);
            this.isConnecting = false;
            this.scheduleReconnect();
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    private handleMessage(message: WebSocketMessage): void {
        switch (message.type) {
            case "MemberJoin":
                if (message.data?.uuid && message.data?.name && message.data?.roomId) {
                    // Cache user information
                    this.userCache.set(message.data.uuid, {
                        name: message.data.name,
                        roomId: message.data.roomId,
                    });

                    this.eventHandlers.onUserJoin({
                        uuid: message.data.uuid,
                        name: message.data.name,
                        ipAddress: message.data.ipAddress || "",
                        roomId: message.data.roomId,
                    });
                }
                break;

            case "MemberLeave":
                if (message.data?.uuid) {
                    const cached = this.userCache.get(message.data.uuid);
                    if (cached) {
                        this.eventHandlers.onUserLeave({
                            uuid: message.data.uuid,
                            name: cached.name,
                            roomId: cached.roomId,
                        });
                        // Remove from cache after use
                        this.userCache.delete(message.data.uuid);
                    } else {
                        // Still send event even without cached name
                        this.eventHandlers.onUserLeave({
                            uuid: message.data.uuid,
                            name: "Unknown User",
                            roomId: "Unknown Room",
                        });
                    }
                }
                break;

            case "Error":
                console.error("Error from WorkAdventure server:", message.data);
                break;

            default:
                console.log("Unknown message type:", message.type);
        }
    }

    /**
     * Schedule reconnection
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            return;
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.eventHandlers.onReconnect();
            this.connect();
        }, this.reconnectInterval);
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Check if WebSocket is connected
     */
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}

