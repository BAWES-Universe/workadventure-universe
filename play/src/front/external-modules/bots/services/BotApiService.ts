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

    /**
     * Initialize the API service with extension options
     */
    initialize(userAccessToken: string | null, adminUrl: string | undefined, roomId: string): void {
        this.accessToken = this.getAccessTokenFromJwt(userAccessToken);
        this.adminUrl = adminUrl || null;
        this.roomId = roomId;
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
}

// Export singleton instance
export const botApiService = new BotApiService();
