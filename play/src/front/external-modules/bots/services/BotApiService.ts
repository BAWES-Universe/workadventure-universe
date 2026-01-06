import type { BotData } from "../types";

export interface CreateBotDto {
    roomId: string;
    name: string;
    description?: string;
    characterTextureId?: string;
    enabled?: boolean;
    behaviorType: "idle" | "patrol" | "social";
    behaviorConfig: BotData["behaviorConfig"];
    chatInstructions?: string;
    movementInstructions?: string;
    aiProviderRef?: string;
}

export interface UpdateBotDto extends Partial<CreateBotDto> {
    id: string;
}

export class BotApiService {
    private accessToken: string | null = null;
    private adminUrl: string | null = null;
    private roomId: string | null = null;
    private botServerUrl: string | null = null;

    /**
     * Initialize the API service with extension options
     */
    initialize(
        userAccessToken: string | null,
        adminUrl: string | undefined,
        roomId: string,
        botServerUrl?: string
    ): void {
        this.accessToken = this.getAccessTokenFromJwt(userAccessToken);
        this.adminUrl = adminUrl || null;
        this.roomId = roomId;
        // Default to bot-server.workadventure.localhost if not provided
        this.botServerUrl = botServerUrl || "http://bot-server.workadventure.localhost";
    }

    /**
     * Check if the service is initialized
     */
    isInitialized(): boolean {
        return !!(this.adminUrl && this.accessToken && this.roomId);
    }

    /**
     * Extract OIDC access token from JWT (same pattern as admin-api module)
     */
    private getAccessTokenFromJwt(jwtToken: string | null): string | null {
        if (!jwtToken) {
            return null;
        }
        try {
            const base64Url = jwtToken.split(".")[1];
            const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
            const jsonPayload = decodeURIComponent(
                atob(base64)
                    .split("")
                    .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                    .join("")
            );
            const payload = JSON.parse(jsonPayload);
            return payload.accessToken || null;
        } catch (e) {
            console.error("[BotApiService] Error parsing JWT:", e);
            return null;
        }
    }

    /**
     * Make authenticated API request
     */
    private async fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
        if (!this.adminUrl || !this.accessToken) {
            throw new Error("BotApiService not initialized. Missing adminUrl or accessToken.");
        }

        const url = `${this.adminUrl}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.accessToken}`,
                ...options.headers,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `API error: ${response.status}`;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorJson.error || errorMessage;
            } catch {
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }

        return response;
    }

    /**
     * List all bots for the current room
     */
    async listBots(roomId?: string): Promise<BotData[]> {
        const id = roomId || this.roomId;
        if (!id) {
            throw new Error("roomId is required");
        }

        const response = await this.fetch(`/api/bots?roomId=${encodeURIComponent(id)}`);
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    }

    /**
     * Get a single bot by ID
     */
    async getBot(id: string): Promise<BotData> {
        const response = await this.fetch(`/api/bots/${id}`);
        return response.json();
    }

    /**
     * Create a new bot
     */
    async createBot(botData: CreateBotDto): Promise<BotData> {
        const payload = {
            ...botData,
            roomId: botData.roomId || this.roomId,
        };

        const response = await this.fetch("/api/bots", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        return response.json();
    }

    /**
     * Update an existing bot
     */
    async updateBot(id: string, botData: Partial<CreateBotDto>): Promise<BotData> {
        const response = await this.fetch(`/api/bots/${id}`, {
            method: "PUT",
            body: JSON.stringify(botData),
        });

        return response.json();
    }

    /**
     * Delete a bot
     */
    async deleteBot(id: string): Promise<void> {
        await this.fetch(`/api/bots/${id}`, {
            method: "DELETE",
        });
    }

    /**
     * Call bot-server API (for spawning/despawning bots)
     * Note: room-enter/leave endpoints don't require authentication
     */
    private async fetchBotServer(endpoint: string, options: RequestInit = {}): Promise<Response> {
        if (!this.botServerUrl) {
            throw new Error("BotApiService not initialized. Missing botServerUrl.");
        }

        const url = `${this.botServerUrl}${endpoint}`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string>),
        };

        // Only add Authorization header if we have a token (for authenticated users)
        if (this.accessToken) {
            headers.Authorization = `Bearer ${this.accessToken}`;
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `Bot-server API error: ${response.status}`;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorJson.error || errorMessage;
            } catch {
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }

        return response;
    }

    /**
     * Notify bot-server that a player entered a room (spawns bots)
     */
    async notifyRoomEnter(roomId?: string): Promise<{ botsSpawned: number; playerCount: number }> {
        const id = roomId || this.roomId;
        if (!id) {
            throw new Error("roomId is required");
        }

        try {
            const response = await this.fetchBotServer("/api/bots/room-enter", {
                method: "POST",
                body: JSON.stringify({ roomId: id }),
            });
            return response.json();
        } catch (error) {
            console.error("[BotApiService] Error notifying room enter:", error);
            // Don't throw - bot spawning failure shouldn't break the game
            return { botsSpawned: 0, playerCount: 0 };
        }
    }

    /**
     * Notify bot-server that a player left a room (may despawn bots if room is empty)
     */
    async notifyRoomLeave(roomId?: string): Promise<{ botsActive: number; playerCount: number }> {
        const id = roomId || this.roomId;
        if (!id) {
            throw new Error("roomId is required");
        }

        try {
            const response = await this.fetchBotServer("/api/bots/room-leave", {
                method: "POST",
                body: JSON.stringify({ roomId: id }),
            });
            return response.json();
        } catch (error) {
            console.error("[BotApiService] Error notifying room leave:", error);
            // Don't throw - bot despawning failure shouldn't break the game
            return { botsActive: 0, playerCount: 0 };
        }
    }

    /**
     * Spawn a specific bot immediately (called when bot is created)
     */
    async spawnBot(botId: string, roomId?: string): Promise<{ spawned: boolean; reason?: string }> {
        const id = roomId || this.roomId;
        if (!id) {
            throw new Error("roomId is required");
        }

        try {
            const response = await this.fetchBotServer("/api/bots/spawn", {
                method: "POST",
                body: JSON.stringify({ botId, roomId: id }),
            });
            return response.json();
        } catch (error) {
            console.error("[BotApiService] Error spawning bot:", error);
            return { spawned: false, reason: String(error) };
        }
    }

    /**
     * Despawn a specific bot immediately (called when bot is deleted)
     */
    async despawnBot(botId: string, roomId?: string): Promise<{ despawned: boolean; reason?: string }> {
        const id = roomId || this.roomId;

        try {
            const response = await this.fetchBotServer("/api/bots/despawn", {
                method: "POST",
                body: JSON.stringify({ botId, roomId: id }),
            });
            return response.json();
        } catch (error) {
            console.error("[BotApiService] Error despawning bot:", error);
            return { despawned: false, reason: String(error) };
        }
    }

    /**
     * Update a running bot's configuration (live update)
     * This is called when bot config changes in the editor
     */
    async updateRunningBot(
        botId: string,
        updates: {
            position?: { x: number; y: number };
            behaviorConfig?: Record<string, unknown>;
            behaviorType?: string;
        }
    ): Promise<{ updated: boolean; reason?: string; changes?: string[] }> {
        try {
            const response = await this.fetchBotServer(`/api/bots/${botId}/update`, {
                method: "POST",
                body: JSON.stringify(updates),
            });
            return response.json();
        } catch (error) {
            console.error("[BotApiService] Error updating running bot:", error);
            return { updated: false, reason: String(error) };
        }
    }
}

// Export singleton instance
export const botApiService = new BotApiService();
