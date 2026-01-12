import type { BotData } from "../types";

interface AuthError extends Error {
    isAuthError: boolean;
    isSessionExpired: boolean;
}

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
    private jwtToken: string | null = null; // Store original JWT for bot server auth
    private adminUrl: string | null = null;
    private roomId: string | null = null;
    private botServerUrl: string | null = null;
    private sessionTokenPromise: Promise<string | null> | null = null; // Cache login attempt to avoid multiple simultaneous calls

    /**
     * Initialize the API service with extension options
     * @returns true if roomId changed (useful for detecting room navigation)
     */
    initialize(
        userAccessToken: string | null,
        adminUrl: string | undefined,
        roomId: string,
        botServerUrl?: string
    ): boolean {
        const roomIdChanged = this.roomId !== null && this.roomId !== roomId;
        this.accessToken = this.getAccessTokenFromJwt(userAccessToken);
        this.jwtToken = userAccessToken; // Store original JWT for bot server authentication
        this.adminUrl = adminUrl || null;
        this.roomId = roomId;
        // Default to bot-server.workadventure.localhost if not provided
        this.botServerUrl = botServerUrl || "http://bot-server.workadventure.localhost";
        return roomIdChanged;
    }

    /**
     * Get the current roomId
     */
    getRoomId(): string | null {
        return this.roomId;
    }

    /**
     * Check if the service is initialized
     */
    isInitialized(): boolean {
        // Service is initialized if we have adminUrl and roomId
        // Authentication can be via session token OR accessToken
        return !!(this.adminUrl && this.roomId);
    }

    /**
     * Get Admin API session token from localStorage
     * Primary key: admin_session_token (base64-encoded session data)
     * Fallback key: admin_session_id (session ID - less preferred)
     * If not found or expired, fetches new session token from Admin API
     */
    private async getAdminApiSessionToken(): Promise<string | null> {
        if (typeof window === "undefined" || typeof localStorage === "undefined") {
            return null;
        }

        // Check if we have a cached token
        const sessionToken = localStorage.getItem("admin_session_token");
        const expiresAtStr = localStorage.getItem("admin_session_token_expires_at");

        // Check if token exists and is not expired
        if (sessionToken && expiresAtStr) {
            const expirationTime = parseInt(expiresAtStr, 10);
            const now = Date.now();

            // If token expires in more than 5 minutes, use it
            // Otherwise, refresh proactively
            if (expirationTime > now + 5 * 60 * 1000) {
                return sessionToken;
            }

            // Token expires soon or is expired - clear it and fetch new one
            localStorage.removeItem("admin_session_token");
            localStorage.removeItem("admin_session_token_expires_at");
        }

        // Fallback: admin_session_id (session ID - for backward compatibility)
        const sessionId = localStorage.getItem("admin_session_id");
        if (sessionId) {
            return sessionId;
        }

        // No valid token found - fetch new one from Admin API
        if (this.accessToken && this.adminUrl) {
            // Use cached promise if login is already in progress
            if (this.sessionTokenPromise) {
                return this.sessionTokenPromise;
            }

            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.log("[BotApiService] Fetching new session token from Admin API");
            }
            this.sessionTokenPromise = this.fetchSessionTokenFromAdminApi();
            const token = await this.sessionTokenPromise;
            this.sessionTokenPromise = null; // Clear cache after completion
            return token;
        }

        return null;
    }

    /**
     * Fetch session token from Admin API /api/auth/session endpoint
     * Uses OIDC accessToken in Authorization header
     */
    private async fetchSessionTokenFromAdminApi(): Promise<string | null> {
        if (!this.adminUrl || !this.accessToken) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.warn("[BotApiService] Cannot fetch session token: missing adminUrl or accessToken");
            }
            return null;
        }

        try {
            const response = await fetch(`${this.adminUrl}/api/auth/session`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.accessToken}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                    console.warn(
                        `[BotApiService] Failed to fetch session token: ${response.status} ${response.statusText}`,
                        errorText
                    );
                }
                return null;
            }

            const data = await response.json();
            const sessionToken = data.sessionToken || data.token;
            const expiresAt = data.expiresAt;

            if (!sessionToken) {
                if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                    console.warn("[BotApiService] Session token not found in response");
                }
                return null;
            }

            // Store session token and expiration in localStorage
            localStorage.setItem("admin_session_token", sessionToken);
            if (expiresAt && typeof expiresAt === "number") {
                localStorage.setItem("admin_session_token_expires_at", expiresAt.toString());
            }

            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.log("[BotApiService] Session token fetched and cached successfully");
            }
            return sessionToken;
        } catch (error) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error fetching session token from Admin API:", error);
            }
            return null;
        }
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
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error parsing JWT:", e);
            }
            return null;
        }
    }

    /**
     * Make authenticated API request
     * Uses Admin API session token if available, falls back to JWT accessToken
     */
    private async fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
        if (!this.adminUrl) {
            throw new Error("BotApiService not initialized. Missing adminUrl.");
        }

        // Try to get Admin API session token first (async - may fetch new one if missing/expired)
        const sessionToken = await this.getAdminApiSessionToken();

        // Build base URL
        let url = `${this.adminUrl}${endpoint}`;

        // Build headers
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string>),
        };

        // PRIMARY METHOD: Use session token as _token query parameter
        if (sessionToken) {
            const separator = endpoint.includes("?") ? "&" : "?";
            url = `${url}${separator}_token=${encodeURIComponent(sessionToken)}`;
        } else if (this.accessToken) {
            // FALLBACK METHOD: Use JWT accessToken in Authorization header
            headers.Authorization = `Bearer ${this.accessToken}`;
        } else {
            throw new Error("BotApiService not initialized. Missing session token or accessToken.");
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `API error: ${response.status}`;
            let isSessionExpired = false;

            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorJson.error || errorMessage;
                // Check if it's a session expiration error
                if (
                    errorMessage.toLowerCase().includes("session expired") ||
                    errorMessage.toLowerCase().includes("session invalid")
                ) {
                    isSessionExpired = true;
                }
            } catch {
                errorMessage = errorText || errorMessage;
            }

            // If 401 and we were using session token, clear it and try to refresh
            if (response.status === 401 && sessionToken) {
                if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                    console.warn("[BotApiService] Session token may be expired, clearing cache and refreshing");
                }
                localStorage.removeItem("admin_session_token");
                localStorage.removeItem("admin_session_token_expires_at");

                // If we have accessToken, try to fetch a new session token and retry
                if (this.accessToken) {
                    const newToken = await this.fetchSessionTokenFromAdminApi();
                    if (newToken) {
                        // Retry the request with new token
                        const retryUrl = `${this.adminUrl}${endpoint}`;
                        const retrySeparator = endpoint.includes("?") ? "&" : "?";
                        const retryUrlWithToken = `${retryUrl}${retrySeparator}_token=${encodeURIComponent(newToken)}`;

                        const retryResponse = await fetch(retryUrlWithToken, {
                            ...options,
                            headers,
                        });

                        if (retryResponse.ok) {
                            return retryResponse;
                        }
                    }
                }
            }

            // Create a more specific error for session expiration
            if (isSessionExpired || response.status === 401) {
                const authError = new Error(
                    sessionToken
                        ? "Your session has expired. Please re-authenticate to continue managing bots."
                        : "Authentication failed. Please ensure you are logged in."
                ) as AuthError;
                authError.isAuthError = true;
                authError.isSessionExpired = isSessionExpired;
                throw authError;
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
     * Calls bot server API which handles both saving to Admin API and updating running bot
     */
    async updateBot(id: string, botData: Partial<CreateBotDto>): Promise<BotData> {
        // Call bot server API - it handles saving to Admin API AND updating running bot
        const response = await this.fetchBotServer(`/api/bots/${id}`, {
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
     * Uses Admin API session tokens (same as Admin API) for authenticated endpoints
     */
    private async fetchBotServer(endpoint: string, options: RequestInit = {}): Promise<Response> {
        if (!this.botServerUrl) {
            throw new Error("BotApiService not initialized. Missing botServerUrl.");
        }

        // Try to get Admin API session token first (preferred method)
        const sessionToken = await this.getAdminApiSessionToken();

        // Build URL - add session token as query parameter if available (same as Admin API)
        let url = `${this.botServerUrl}${endpoint}`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string>),
        };

        // PRIMARY METHOD: Use Admin API session token (same as Admin API authentication)
        if (sessionToken) {
            const separator = endpoint.includes("?") ? "&" : "?";
            url = `${url}${separator}_token=${encodeURIComponent(sessionToken)}`;
        } else if (this.jwtToken) {
            // FALLBACK METHOD: Use JWT token (for backward compatibility or initial auth)
            headers.Authorization = `Bearer ${this.jwtToken}`;
        } else if (this.accessToken) {
            // FALLBACK METHOD: Use accessToken if JWT not available
            headers.Authorization = `Bearer ${this.accessToken}`;
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `Bot-server API error: ${response.status}`;
            let isSessionExpired = false;

            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorJson.error || errorMessage;
                // Check if it's a session expiration error
                if (
                    errorMessage.toLowerCase().includes("session expired") ||
                    errorMessage.toLowerCase().includes("session invalid") ||
                    errorMessage.toLowerCase().includes("invalid or expired session token")
                ) {
                    isSessionExpired = true;
                }
            } catch {
                errorMessage = errorText || errorMessage;
            }

            // If 401 and we were using session token, clear it and try to refresh
            if (response.status === 401 && sessionToken) {
                if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                    console.warn(
                        "[BotApiService] Bot server session token may be expired, clearing cache and refreshing"
                    );
                }
                localStorage.removeItem("admin_session_token");
                localStorage.removeItem("admin_session_token_expires_at");

                // If we have accessToken, try to fetch a new session token and retry
                if (this.accessToken) {
                    const newToken = await this.fetchSessionTokenFromAdminApi();
                    if (newToken) {
                        // Retry the request with new token
                        const retryUrl = `${this.botServerUrl}${endpoint}`;
                        const retrySeparator = endpoint.includes("?") ? "&" : "?";
                        const retryUrlWithToken = `${retryUrl}${retrySeparator}_token=${encodeURIComponent(newToken)}`;

                        const retryResponse = await fetch(retryUrlWithToken, {
                            ...options,
                            headers,
                        });

                        if (retryResponse.ok) {
                            return retryResponse;
                        }
                    }
                }
            }

            // Create a more specific error for session expiration
            if (isSessionExpired || response.status === 401) {
                const authError = new Error(
                    sessionToken
                        ? "Your session has expired. Please re-authenticate to continue managing bots."
                        : "Authentication failed. Please ensure you are logged in."
                ) as AuthError;
                authError.isAuthError = true;
                authError.isSessionExpired = isSessionExpired;
                throw authError;
            }

            throw new Error(errorMessage);
        }

        return response;
    }

    /**
     * Notify bot-server that a player entered a room (spawns bots)
     */
    async notifyRoomEnter(roomId?: string): Promise<{ botsSpawned: number }> {
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
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error notifying room enter:", error);
            }
            // Don't throw - bot spawning failure shouldn't break the game
            return { botsSpawned: 0 };
        }
    }

    /**
     * Notify bot-server that a player left a room (verification will despawn bots if room is empty)
     */
    async notifyRoomLeave(roomId?: string): Promise<{ botsActive: number }> {
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
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error notifying room leave:", error);
            }
            // Don't throw - bot despawning failure shouldn't break the game
            return { botsActive: 0 };
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
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error spawning bot:", error);
            }
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
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error despawning bot:", error);
            }
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
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error updating running bot:", error);
            }
            return { updated: false, reason: String(error) };
        }
    }

    /**
     * Summon a bot to the player's position
     * The bot will pathfind to the player, stop at their position, and initiate a bubble
     * When the player leaves, the bot will return to its original position
     */
    async summonBot(
        botId: string,
        playerUuid: string,
        playerX: number,
        playerY: number
    ): Promise<{ summoned: boolean; reason?: string }> {
        try {
            const response = await this.fetchBotServer(`/api/bots/${botId}/summon`, {
                method: "POST",
                body: JSON.stringify({
                    playerUuid,
                    playerX,
                    playerY,
                }),
            });
            return response.json();
        } catch (error) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error summoning bot:", error);
            }
            return { summoned: false, reason: String(error) };
        }
    }

    /**
     * Get available AI providers (for bot editor UI)
     */
    async getAvailableAIProviders(enabled: boolean = true): Promise<
        Array<{
            providerId: string;
            name: string;
            type: string;
            enabled: boolean;
            supportsStreaming: boolean;
        }>
    > {
        try {
            const response = await this.fetchBotServer(`/api/bots/ai-providers?enabled=${enabled}`, {
                method: "GET",
            });
            return response.json();
        } catch (error) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error getting AI providers:", error);
            }
            return [];
        }
    }
}

// Export singleton instance
export const botApiService = new BotApiService();
