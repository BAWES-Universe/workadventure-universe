import type { BotAiOptions, BotData } from "../types";
import {
    readPermissions,
    readRule,
    type BotPermissions,
    type BotRule,
    type RuleAction,
    type RuleValue,
} from "../accessModel";
import { resolveCredentialUrl } from "../../admin-api/iframeAuth";
import { freshOrbitAccessToken, type GameTokenHolder } from "../../admin-api/orbitAccessToken";
import type { PushOverview, PushSettings } from "../../../Notification/Push/PushSettings";
import { ChatPusherSchema, type ChatPusher, type PushActivityReport } from "../../../Notification/Push/PushChat";
import { classifySummonFailure, type SummonResult } from "./summonFailure";

interface AuthError extends Error {
    isAuthError: boolean;
    isSessionExpired: boolean;
    status?: number;
}

const SESSION_KEY = "orbit_admin_session_v2";
const SESSION_EXPIRES_KEY = "orbit_admin_session_v2_expires";
const OPAQUE_SESSION_PATTERN = /^orb_sess_v2_[0-9a-f]{64}$/;
/** How long the game waits to learn whether Summon is allowed before it shows the button anyway */
const ACCESS_CHECK_TIMEOUT_MS = 3000;
/** How long a read or change of who may use a bot waits for Orbit before it counts as failed */
const PERMISSIONS_TIMEOUT_MS = 20000;
/** How long a lookup of bot states waits before it counts as failed (and is asked again on the next look) */
const DM_STATUS_TIMEOUT_MS = 10000;

export function isOrbitSessionResponse(value: unknown): value is { version: 2; sessionId: string; expiresAt: number } {
    if (!value || typeof value !== "object") return false;
    const response = value as { version?: unknown; sessionId?: unknown; expiresAt?: unknown };
    return (
        response.version === 2 &&
        typeof response.sessionId === "string" &&
        OPAQUE_SESSION_PATTERN.test(response.sessionId) &&
        typeof response.expiresAt === "number" &&
        Number.isFinite(response.expiresAt)
    );
}

/** The shape the bot page reads without a guard: the key list and whether Universe AI is offered. Anything else is "no answer". */
export function isBotAiOptions(data: unknown): data is BotAiOptions {
    if (typeof data !== "object" || data === null) return false;
    const answer = data as Partial<BotAiOptions>;
    return Array.isArray(answer.keys) && typeof answer.universeAi?.available === "boolean";
}

/** Only the id and name of each of the player's own AI keys, which is all the bot page needs (#1375). */
export function myAiKeyNames(data: unknown): Array<{ id: string; name: string }> | null {
    if (typeof data !== "object" || data === null) return null;
    const keys = (data as { keys?: unknown }).keys;
    if (!Array.isArray(keys)) return null;
    return keys.flatMap((key: unknown) => {
        if (typeof key !== "object" || key === null) return [];
        const { id, name } = key as { id?: unknown; name?: unknown };
        return typeof id === "string" && typeof name === "string" ? [{ id, name }] : [];
    });
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
    aiProviderRef?: string;
    /** "Patience": how long the bot waits for a tool to answer, in seconds; null = the bot server's default */
    toolTimeoutSeconds?: number | null;
    /** The companion (pet) that walks with the bot: a companion texture id, or null for none */
    companionTextureId?: string | null;
}

/** Bot chat telemetry of one bot: on unless the bot or its universe turned it off. The universe's choice locks the switch. */
export interface BotTelemetry {
    universeHides: boolean;
    on: boolean;
}

function readTelemetry(value: unknown): BotTelemetry {
    const answer = value as { universeHides?: unknown; hidden?: unknown } | null;
    if (!answer || typeof answer.universeHides !== "boolean" || typeof answer.hidden !== "boolean") {
        throw new Error("Orbit answered with something the game does not understand");
    }
    return { universeHides: answer.universeHides, on: !answer.hidden };
}

export interface UpdateBotDto extends Partial<CreateBotDto> {
    id: string;
}

/** What the bot server says to "may I?": yes, no with the owner's line, or not known (`signIn`: sign in again first) */
type BotAccessAnswer = { allowed: true } | { allowed: false; reason: string } | { allowed: null; signIn?: true };

/** The membership button on a player's card, as Orbit names it. */
export interface MembershipButton {
    kind: "membership" | "pending" | "roles";
    label: string;
}

export class BotApiService {
    private accessToken: string | null = null;
    /** The game's token this service signs in with; renewed in place when its OIDC access token runs out. */
    private gameToken: GameTokenHolder | null = null;
    private adminUrl: string | null = null;
    /** Set up by a room yet: until then a missing Orbit address says nothing about the server */
    private initialized = false;
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
        this.initialized = true;
        const previousAdminUrl = this.adminUrl;
        const nextAccessToken = this.getAccessTokenFromJwt(userAccessToken);
        if (this.accessToken !== nextAccessToken) {
            this.clearSessionCache();
            this.sessionTokenPromise = null;
        }
        this.accessToken = nextAccessToken;
        if (!userAccessToken) this.gameToken = null;
        else if (this.gameToken?.userAccessToken === userAccessToken) this.gameToken.roomId = roomId;
        else this.gameToken = { userAccessToken, roomId };

        try {
            this.adminUrl = adminUrl ? resolveCredentialUrl(adminUrl, window.location.href).origin : null;
        } catch (error) {
            console.error("[BotApiService] Refusing insecure Admin credential target:", error);
            this.adminUrl = null;
        }
        if (this.adminUrl !== previousAdminUrl) {
            this.clearSessionCache();
            this.sessionTokenPromise = null;
        }

        try {
            this.botServerUrl = resolveCredentialUrl(
                botServerUrl || "http://bot-server.workadventure.localhost",
                window.location.href
            ).origin;
        } catch (error) {
            console.error("[BotApiService] Refusing insecure bot-server credential target:", error);
            this.botServerUrl = null;
        }
        this.roomId = roomId;
        return roomIdChanged;
    }

    /**
     * The bot server this service sends credentials to: null when the address was refused as unsafe. Anything that
     * sends the player's tokens to the bot server must use this, never the raw setting.
     */
    getBotServerUrl(): string | null {
        return this.botServerUrl;
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
     * Get the opaque Admin API session from this tab's sessionStorage.
     */
    /** The saved Orbit session while it has not run out yet, however soon it will. */
    private unexpiredSessionToken(): string | null {
        if (typeof sessionStorage === "undefined") return null;
        const sessionToken = sessionStorage.getItem(SESSION_KEY);
        const expiresAt = parseInt(sessionStorage.getItem(SESSION_EXPIRES_KEY) ?? "", 10);
        if (!sessionToken || !OPAQUE_SESSION_PATTERN.test(sessionToken) || !(expiresAt > Date.now())) return null;
        return sessionToken;
    }

    private async getAdminApiSessionToken(): Promise<string | null> {
        if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
            return null;
        }

        // Remove credentials created by the legacy URL/base64 implementation.
        localStorage.removeItem("admin_session_token");
        localStorage.removeItem("admin_session_token_expires_at");
        localStorage.removeItem("admin_session_id");

        const sessionToken = sessionStorage.getItem(SESSION_KEY);
        const expiresAtStr = sessionStorage.getItem(SESSION_EXPIRES_KEY);

        if (sessionToken && OPAQUE_SESSION_PATTERN.test(sessionToken) && expiresAtStr) {
            const expirationTime = parseInt(expiresAtStr, 10);
            const now = Date.now();

            // If token expires in more than 5 minutes, use it
            // Otherwise, refresh proactively
            if (expirationTime > now + 5 * 60 * 1000) {
                return sessionToken;
            }

            // Token expires soon or is expired - clear it and fetch new one
            sessionStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(SESSION_EXPIRES_KEY);
        }
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_EXPIRES_KEY);

        // No valid token found - fetch new one from Admin API
        if (this.accessToken && this.adminUrl) {
            // Use cached promise if login is already in progress
            if (this.sessionTokenPromise) {
                return this.sessionTokenPromise;
            }

            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.log("[BotApiService] Fetching new session token from Admin API");
            }
            const loginAttempt = this.fetchSessionTokenFromAdminApi();
            this.sessionTokenPromise = loginAttempt;
            const token = await loginAttempt;
            if (this.sessionTokenPromise === loginAttempt) {
                this.sessionTokenPromise = null;
            }
            return token;
        }

        return null;
    }

    /**
     * Fetch session token from Admin API /api/auth/session endpoint
     * Uses OIDC accessToken in Authorization header, renewed first when it has run out. If Orbit refuses it anyway,
     * renews it once more (forced) and tries again.
     */
    private async fetchSessionTokenFromAdminApi(): Promise<string | null> {
        if (!this.adminUrl || !this.accessToken) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.warn("[BotApiService] Cannot fetch session token: missing adminUrl or accessToken");
            }
            return null;
        }

        const accessToken = await this.freshAccessToken(false);
        if (!accessToken) return null;
        const session = await this.exchangeForOrbitSession(accessToken);
        if (session !== "refused") return session;

        // Orbit refused the access token (run out, or revoked early): renew it through the refresh token and retry.
        const renewed = await this.freshAccessToken(true);
        if (!renewed || renewed === accessToken) return null;
        const retried = await this.exchangeForOrbitSession(renewed);
        return retried === "refused" ? null : retried;
    }

    /**
     * The OIDC access token to exchange for an Orbit session. The one captured when the room loaded lasts an hour
     * or so; this renews it through the pusher's /me (shared with Orbit's own sign-in) when it has run out.
     */
    private async freshAccessToken(force: boolean): Promise<string | null> {
        const holder = this.gameToken;
        if (!holder) return this.accessToken;
        const accessToken = await freshOrbitAccessToken(holder, force, () => this.gameToken === holder);
        if (!accessToken || this.gameToken !== holder) return null;
        // Same player, renewed token: an Orbit session already cached is still theirs.
        this.accessToken = accessToken;
        return accessToken;
    }

    /** Exchanges an OIDC access token for an opaque Orbit session; "refused" when Orbit says the token is bad. */
    private async exchangeForOrbitSession(accessToken: string): Promise<string | null | "refused"> {
        const adminUrl = this.adminUrl;
        if (!adminUrl) return null;

        try {
            const response = await fetch(`${adminUrl}/api/auth/session`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                credentials: "omit",
            });

            if (!response.ok) {
                const errorText = await response.text();
                if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                    console.warn(
                        `[BotApiService] Failed to fetch session token: ${response.status} ${response.statusText}`,
                        errorText
                    );
                }
                return response.status === 401 ? "refused" : null;
            }

            const data = await response.json();

            if (!isOrbitSessionResponse(data)) {
                if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                    console.warn("[BotApiService] Session token not found in response");
                }
                return null;
            }

            // The authenticated user or Admin origin changed while the exchange
            // was in flight. Never cache or return the previous identity's session.
            if (this.accessToken !== accessToken || this.adminUrl !== adminUrl) {
                return null;
            }

            sessionStorage.setItem(SESSION_KEY, data.sessionId);
            sessionStorage.setItem(SESSION_EXPIRES_KEY, data.expiresAt.toString());

            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.log("[BotApiService] Session token fetched and cached successfully");
            }
            return data.sessionId;
        } catch (error) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error fetching session token from Admin API:", error);
            }
            return null;
        }
    }

    private clearSessionCache(): void {
        if (typeof sessionStorage === "undefined") return;
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_EXPIRES_KEY);
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
     * Uses only an opaque Admin API session in the Authorization header.
     */
    private async fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
        if (!this.adminUrl) {
            throw new Error("BotApiService not initialized. Missing adminUrl.");
        }

        // Try to get Admin API session token first (async - may fetch new one if missing/expired). A keepalive
        // request goes out while the page closes, when renewing first would be cut off: it takes the session as it
        // is while that still works.
        const sessionToken =
            (options.keepalive ? this.unexpiredSessionToken() : null) ?? (await this.getAdminApiSessionToken());

        const url = `${this.adminUrl}${endpoint}`;

        // Build headers
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string>),
        };
        if (sessionToken) {
            headers.Authorization = `Bearer ${sessionToken}`;
        } else {
            throw new Error("BotApiService not initialized. Missing Orbit session.");
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
                sessionStorage.removeItem(SESSION_KEY);
                sessionStorage.removeItem(SESSION_EXPIRES_KEY);

                // If we have accessToken, try to fetch a new session token and retry
                if (this.accessToken) {
                    const newToken = await this.fetchSessionTokenFromAdminApi();
                    if (newToken) {
                        const retryUrl = `${this.adminUrl}${endpoint}`;
                        const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };

                        const retryResponse = await fetch(retryUrl, {
                            ...options,
                            headers: retryHeaders,
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

            const error = new Error(errorMessage) as Error & { status?: number };
            error.status = response.status;
            throw error;
        }

        return response;
    }

    /**
     * How many things in Orbit wait for this player's answer (pending invitations for now), for the count on the
     * Orbit button. Null when it can't be known: a guest, no Orbit, or Orbit didn't answer.
     */
    async getAttentionCount(): Promise<number | null> {
        if (!this.adminUrl || !this.accessToken) return null;
        try {
            const response = await this.fetch("/api/me/attention");
            const data = (await response.json()) as { count?: unknown };
            return typeof data.count === "number" && Number.isFinite(data.count) ? Math.max(0, data.count) : null;
        } catch {
            return null;
        }
    }

    /**
     * What the bot page offers under "Runs on" (#374): Universe AI and the viewer's own keys lent to this universe.
     * Pass the bot's id, or nothing (this room) for a bot not made yet. Null when Orbit can't say (an older Orbit, no
     * permission, offline): the page then keeps the provider list it always had.
     */
    async getBotAiOptions(target: { botId?: string; roomId?: string } = {}): Promise<BotAiOptions | null> {
        const roomId = target.roomId ?? this.roomId;
        const query = target.botId
            ? `botId=${encodeURIComponent(target.botId)}`
            : roomId
            ? `roomId=${encodeURIComponent(roomId)}`
            : null;
        if (!query) return null;
        try {
            const response = await this.fetch(`/api/me/bot-ai?${query}`);
            const data: unknown = await response.json();
            return isBotAiOptions(data) ? data : null;
        } catch {
            return null;
        }
    }

    /**
     * The player's own AI keys, lent anywhere or nowhere (#1375): the bot page uses them to say which keys aren't lent to
     * this universe yet. Null when Orbit can't say (offline, an older Orbit).
     */
    async getMyAiKeys(): Promise<Array<{ id: string; name: string }> | null> {
        try {
            const response = await this.fetch("/api/me/ai-keys");
            return myAiKeyNames(await response.json());
        } catch {
            return null;
        }
    }

    /**
     * Whether Orbit can send this player notifications (#863): the key a browser subscribes with, or null when there
     * is none (no Orbit on this server, or notifications are not set up there). Undefined when it can't be known: a
     * guest, or Orbit didn't answer.
     */
    async getPushPublicKey(): Promise<string | null | undefined> {
        if (!this.adminUrl) return this.orbitAnswer();
        if (!this.accessToken) return undefined;
        try {
            const response = await this.fetch("/api/me/push");
            const data = (await response.json()) as { publicKey?: unknown };
            if (data.publicKey === null) return null;
            return typeof data.publicKey === "string" && data.publicKey ? data.publicKey : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * No Orbit address: null (a server without Orbit) once a room has set this service up, or when the server has
     * none. Undefined (not known yet) while a room that has not set it up runs on a server with Orbit, so nothing
     * saved for this device is forgotten there.
     */
    private orbitAnswer(): null | undefined {
        // Read from the page's config directly: this service is also used where that config is not loaded
        const serverHasOrbit = typeof window !== "undefined" && !!window.env?.ADMIN_URL;
        return this.initialized || !serverHasOrbit ? null : undefined;
    }

    /** Saves this browser's push subscription for the player, under a name for Your devices. The device id, or null. */
    async registerPushDevice(subscription: PushSubscriptionJSON, label: string): Promise<string | null> {
        if (!this.adminUrl || !this.accessToken) return null;
        try {
            const response = await this.fetch("/api/me/push/devices", {
                method: "POST",
                body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys, label }),
            });
            const data = (await response.json()) as { device?: { id?: unknown } };
            return typeof data.device?.id === "string" ? data.device.id : null;
        } catch {
            return null;
        }
    }

    /**
     * What Synapse needs (`pushers/set`) so direct messages reach this device while Universe is closed: Orbit's
     * gateway and the device's secret (#863). Null when Orbit has none for it.
     */
    async getChatPusher(deviceId: string): Promise<ChatPusher | null> {
        if (!this.adminUrl || !this.accessToken) return null;
        try {
            const response = await this.fetch(`/api/me/push/devices/${encodeURIComponent(deviceId)}/pusher`, {
                method: "POST",
            });
            const parsed = ChatPusherSchema.safeParse(((await response.json()) as { pusher?: unknown }).pusher);
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }

    /**
     * Where this tab is (#863): Universe in front or not, and the chat open there, so Orbit sends no notification for
     * what is already seen. `keepalive` for the last report of a page that is closing. True when Orbit has it.
     */
    async reportPushActivity(report: PushActivityReport, keepalive = false): Promise<boolean> {
        if (!this.adminUrl || !this.accessToken) return false;
        try {
            const response = await this.fetch("/api/me/push/activity", {
                method: "POST",
                body: JSON.stringify(report),
                keepalive,
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Everything Settings > Notifications shows. Null when this server has no Orbit, so nothing is sent while Universe
     * is closed; undefined when Orbit can't be reached.
     */
    async getPushOverview(): Promise<PushOverview | null | undefined> {
        if (!this.adminUrl) return this.orbitAnswer();
        if (!this.accessToken) return undefined;
        try {
            const response = await this.fetch("/api/me/push");
            if (!response.ok) return undefined;
            const data = (await response.json()) as Partial<PushOverview>;
            if (!data.settings || !Array.isArray(data.devices)) return undefined;
            return { publicKey: data.publicKey ?? null, settings: data.settings, devices: data.devices };
        } catch {
            return undefined;
        }
    }

    /** Changes some notification settings. All of them as saved, or undefined when Orbit refused or can't be reached. */
    async updatePushSettings(change: Partial<PushSettings>): Promise<PushSettings | undefined> {
        if (!this.adminUrl || !this.accessToken) return undefined;
        try {
            // Settings queues its saves one after another: one that hangs gives up rather than hold back the rest
            return await this.withPermissionsTimeout(async (signal) => {
                const response = await this.fetch("/api/me/push/settings", {
                    method: "PATCH",
                    body: JSON.stringify(change),
                    signal,
                });
                if (!response.ok) return undefined;
                const data = (await response.json()) as { settings?: PushSettings };
                return data.settings;
            });
        } catch {
            return undefined;
        }
    }

    /** A device's own switch in Orbit. True when saved. */
    async setPushDeviceEnabled(deviceId: string, enabled: boolean): Promise<boolean> {
        if (!this.adminUrl || !this.accessToken) return false;
        try {
            const response = await this.fetch(`/api/me/push/devices/${encodeURIComponent(deviceId)}`, {
                method: "PATCH",
                body: JSON.stringify({ enabled }),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Remove in Your devices. True when it is gone, including when it already was. `keepalive` on the way out of the
     * account: it goes on the saved Orbit session and outlives the page.
     */
    async removePushDevice(deviceId: string, keepalive = false): Promise<boolean> {
        if (!this.adminUrl || !this.accessToken) return false;
        try {
            const response = await this.fetch(`/api/me/push/devices/${encodeURIComponent(deviceId)}`, {
                method: "DELETE",
                keepalive,
            });
            return response.ok;
        } catch (error) {
            // Orbit answers 404 for a device it already removed, and the fetch throws on it
            return (error as { status?: number }).status === 404;
        }
    }

    /**
     * What the membership button on another player's card says for this player, in the universe of the current room:
     * Give membership, Pending invite, Roles or Membership. Null when Orbit says there is none, and when it can't be
     * known: no Orbit, or Orbit didn't answer.
     */
    async getMembershipButton(userUuid: string): Promise<MembershipButton | null> {
        if (!this.adminUrl || !this.accessToken || !this.roomId) return null;
        try {
            const response = await this.fetch(
                `/api/me/membership-button?roomId=${encodeURIComponent(this.roomId)}&userUuid=${encodeURIComponent(
                    userUuid
                )}`
            );
            const data = (await response.json()) as { button?: { kind?: unknown; label?: unknown } | null };
            const button = data.button;
            if (!button || typeof button.label !== "string" || !button.label) return null;
            const kind = button.kind;
            if (kind !== "membership" && kind !== "pending" && kind !== "roles") return null;
            return { kind, label: button.label };
        } catch {
            return null;
        }
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
     * Each bot's state for direct messages (online, resting, unready, gone), for the chat header and People list.
     * Null when the bot server can't say (not signed in, direct messages off, unreachable, or stalled): one lookup
     * runs at a time, so one that hung would hold back every later state.
     */
    async getDmStatus(botIds: string[]): Promise<Record<string, string> | null> {
        if (!this.botServerUrl || botIds.length === 0) return null;
        const stop = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        // Raced as well as aborted: the Orbit sign-in that comes first in a request does not listen for the abort
        const late = new Promise<null>((resolve) => {
            timer = setTimeout(() => {
                stop.abort();
                resolve(null);
            }, DM_STATUS_TIMEOUT_MS);
        });
        const asking = (async () => {
            try {
                const response = await this.fetchBotServer(
                    `/api/bots/dm-status?ids=${botIds.map(encodeURIComponent).join(",")}`,
                    { signal: stop.signal }
                );
                const data = (await response.json()) as { bots?: Record<string, string> };
                return data.bots ?? null;
            } catch {
                return null;
            }
        })();
        return Promise.race([asking, late]).finally(() => {
            clearTimeout(timer);
        });
    }

    /**
     * Orbit's live view (who is where, as you may see it), for the "Now in" on a person's profile in a direct message.
     * Null when signed out, on no answer in time, or on any error: the profile then just doesn't say.
     */
    async getLiveView(): Promise<unknown> {
        if (!this.adminUrl) return null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), DM_STATUS_TIMEOUT_MS);
        });
        const asking = (async () => {
            try {
                return (await (await this.fetch("/api/live")).json()) as unknown;
            } catch {
                return null;
            }
        })();
        return Promise.race([asking, late]).finally(() => {
            clearTimeout(timer);
        });
    }

    /**
     * The room a bot lives in, as the bot server tells someone who may message it (null for anyone else, a bot with no
     * room, or no answer in time). Read as a room card's link, so it only ever opens on this game.
     */
    async getDmRoom(botId: string): Promise<unknown> {
        if (!this.botServerUrl) return null;
        const stop = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<null>((resolve) => {
            timer = setTimeout(() => {
                stop.abort();
                resolve(null);
            }, DM_STATUS_TIMEOUT_MS);
        });
        const asking = (async () => {
            try {
                const response = await this.fetchBotServer(`/api/bots/${encodeURIComponent(botId)}/dm-room`, {
                    signal: stop.signal,
                });
                if (!response.ok) return null;
                const data = (await response.json()) as { room?: unknown };
                return data.room ?? null;
            } catch {
                return null;
            }
        })();
        return Promise.race([asking, late]).finally(() => {
            clearTimeout(timer);
        });
    }

    /**
     * Save the bot's own model on its AI key (Orbit #575). Sent to Orbit itself: the bot server's save of a bot's
     * settings doesn't carry a model. The bot server asks Orbit for the model each time the bot replies.
     */
    async saveBotModel(id: string, aiModel: string): Promise<void> {
        await this.fetch(`/api/bots/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify({ aiModel }),
        });
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
     * The player's game token. The bot server checks it on the routes every player uses (room enter/leave, a bot's
     * feelings), guests included.
     */
    getGameToken(): string | null {
        return this.gameToken?.userAccessToken ?? null;
    }

    /**
     * Headers for reading a bot's feelings about the local player: the game token, plus the Orbit session when the
     * person is signed in (the bot server asks for it to know the feelings are about them).
     */
    async getEmotionsHeaders(): Promise<Record<string, string>> {
        const headers: Record<string, string> = {};
        const gameToken = this.getGameToken();
        if (gameToken) {
            headers["X-WA-Auth"] = gameToken;
        }
        try {
            const sessionToken = await this.getAdminApiSessionToken();
            if (sessionToken) {
                headers.Authorization = `Bearer ${sessionToken}`;
            }
        } catch {
            // No session (a guest): the game token alone is enough for them.
        }
        return headers;
    }

    /**
     * Call bot-server API (for spawning/despawning bots)
     * Note: room-enter/leave only need the game token, so guests can spawn bots too
     * Uses Admin API session tokens (same as Admin API) for authenticated endpoints
     */
    private async fetchBotServer(endpoint: string, options: RequestInit = {}): Promise<Response> {
        if (!this.botServerUrl) {
            throw new Error("BotApiService not initialized. Missing botServerUrl.");
        }

        // Try to get Admin API session token first (preferred method)
        const sessionToken = await this.getAdminApiSessionToken();

        const url = `${this.botServerUrl}${endpoint}`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string>),
        };
        // Room enter/leave, Summon and "may I?" are for every player, guests included: the game token is enough for them.
        const isPublicRoomLifecycle =
            endpoint === "/api/bots/room-enter" ||
            endpoint === "/api/bots/room-leave" ||
            /^\/api\/bots\/[^/]+\/(summon|access)$/.test(endpoint);
        const gameToken = this.getGameToken();
        if (gameToken) {
            headers["X-WA-Auth"] = gameToken;
        }

        if (sessionToken) {
            headers.Authorization = `Bearer ${sessionToken}`;
        } else if (!isPublicRoomLifecycle) {
            throw new Error("BotApiService not initialized. Missing Orbit session.");
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `Bot-server API error: ${response.status}`;
            let isSessionExpired = false;
            let errorCode: string | undefined;

            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorJson.error || errorMessage;
                errorCode = typeof errorJson.code === "string" ? errorJson.code : undefined;
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
                sessionStorage.removeItem(SESSION_KEY);
                sessionStorage.removeItem(SESSION_EXPIRES_KEY);

                // If we have accessToken, try to fetch a new session token and retry
                if (this.accessToken) {
                    const newToken = await this.fetchSessionTokenFromAdminApi();
                    if (newToken) {
                        const retryUrl = `${this.botServerUrl}${endpoint}`;
                        const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };

                        const retryResponse = await fetch(retryUrl, {
                            ...options,
                            headers: retryHeaders,
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
                authError.status = response.status;
                throw authError;
            }

            const failure = new Error(errorMessage) as Error & { status?: number; code?: string };
            failure.status = response.status;
            failure.code = errorCode;
            throw failure;
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
            /** Put a route bot on stop 1 to start its route again (Done after editing the route). */
            restartRoute?: boolean;
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
     * Never throws: a refusal comes back as `failure`, so the caller can tell the player why.
     */
    async summonBot(botId: string, playerUuid: string, playerX: number, playerY: number): Promise<SummonResult> {
        try {
            const response = await this.fetchBotServer(`/api/bots/${botId}/summon`, {
                method: "POST",
                body: JSON.stringify({
                    playerUuid,
                    playerX,
                    playerY,
                }),
            });
            const body = (await response.json()) as { summoned?: boolean } | null;
            return body?.summoned === false ? { summoned: false, failure: "failed" } : { summoned: true };
        } catch (error) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error summoning bot:", error);
            }
            // The owner's limits (or Orbit not answering) come back as a line meant for the person: pass it on as it is
            const failure = classifySummonFailure(error);
            if ((failure === "not_allowed" || failure === "cannot_check") && error instanceof Error) {
                return { summoned: false, failure, reason: error.message };
            }
            return { summoned: false, failure };
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
            model: string;
            supportsStreaming: boolean;
            supportsVision: boolean | null;
            visionModel: string | null;
            defaultVision: boolean;
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

    // ─── Who may use a bot ────────────────────────────────────────────────────────────

    /**
     * Whether the local player may do this with a bot, asked of the bot server (which asks Orbit): the game uses it to
     * hide Summon and Message from people the owner has refused. `allowed: null` means it could not be found out (a
     * guest with no Orbit session, Orbit not answering): Summon then shows, and the real answer comes when it is used;
     * Message only shows on a yes, since the bot could not answer a chat it cannot check either.
     * `playerUuid` is who is asking. A signed-in player whose Orbit session did not come along is then told so
     * (`signIn`) instead of being asked about as a guest.
     */
    async getBotAccess(botId: string, action: "summon" | "chat" | "dm", playerUuid?: string): Promise<BotAccessAnswer> {
        // A bot server or sign-in that stalls must not hold the Summon button back: after a few seconds it is "unknown"
        const stop = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const unknown = new Promise<{ allowed: null }>((resolve) => {
            timer = setTimeout(() => {
                stop.abort();
                resolve({ allowed: null });
            }, ACCESS_CHECK_TIMEOUT_MS);
        });
        return Promise.race([this.askBotAccess(botId, action, playerUuid, stop.signal), unknown]).finally(() => {
            clearTimeout(timer);
        });
    }

    private async askBotAccess(
        botId: string,
        action: "summon" | "chat" | "dm",
        playerUuid: string | undefined,
        signal: AbortSignal
    ): Promise<BotAccessAnswer> {
        try {
            const response = await this.fetchBotServer(`/api/bots/${encodeURIComponent(botId)}/access`, {
                method: "POST",
                body: JSON.stringify(playerUuid ? { action, playerUuid } : { action }),
                signal,
            });
            const body = (await response.json()) as { allowed?: unknown; reason?: unknown };
            if (body.allowed === true) return { allowed: true };
            if (body.allowed === false) {
                return { allowed: false, reason: typeof body.reason === "string" ? body.reason : "" };
            }
            return { allowed: null };
        } catch (error) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.warn("[BotApiService] Could not check bot access:", error);
            }
            // The server could not tell who this is without their Orbit session: they need to sign in again
            if ((error as { code?: unknown } | undefined)?.code === "not_you") return { allowed: null, signIn: true };
            return { allowed: null };
        }
    }

    /**
     * Run one request about who may use a bot, and give up when Orbit does not answer. The page queues these one after
     * another, so a request that hangs would otherwise hold back every change after it.
     */
    private async withPermissionsTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
        const stop = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        // Raced as well as aborted: the Orbit sign-in that comes first in a request does not listen for the abort
        const late = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                stop.abort();
                reject(new Error("Orbit did not answer in time. Check again in a moment."));
            }, PERMISSIONS_TIMEOUT_MS);
        });
        const running = run(stop.signal);
        // When the timeout wins, the request that was left behind may still fail later: nobody waits for it
        running.catch(() => undefined);
        try {
            return await Promise.race([running, late]);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * "Ask <bot>'s maker" on the reply limit card (#1159): tells the bot's maker that this person wants more replies, as
     * a count, never who. True once Orbit has it (also when this person already asked in this window).
     */
    async askBotMaker(botId: string): Promise<boolean> {
        try {
            await this.fetch(`/api/bots/${encodeURIComponent(botId)}/limit-ask`, { method: "POST", body: "{}" });
            return true;
        } catch {
            return false;
        }
    }

    /** Who may use this bot: Private bot, the line refused people hear, every rule, and the roles a rule can name */
    async getBotPermissions(botId: string): Promise<BotPermissions> {
        return this.withPermissionsTimeout(async (signal) => {
            const response = await this.fetch(`/api/bots/${encodeURIComponent(botId)}/permissions`, { signal });
            return readPermissions(await response.json());
        });
    }

    /** Private bot and the line refused people hear; only what is sent changes. Answers with all of it. */
    async saveBotPermissions(
        botId: string,
        change: { privateBot?: boolean; refusalReply?: string | null }
    ): Promise<BotPermissions> {
        return this.withPermissionsTimeout(async (signal) => {
            const response = await this.fetch(`/api/bots/${encodeURIComponent(botId)}/permissions`, {
                method: "PUT",
                body: JSON.stringify(change),
                signal,
            });
            return readPermissions(await response.json());
        });
    }

    /** Bot chat telemetry of this bot: whether it is on, and whether its universe has turned it off for every bot */
    async getBotTelemetry(botId: string): Promise<BotTelemetry> {
        return this.withPermissionsTimeout(async (signal) => {
            const response = await this.fetch(`/api/bots/${encodeURIComponent(botId)}/privacy`, { signal });
            return readTelemetry(await response.json());
        });
    }

    /** Turn bot chat telemetry on (the bot follows its universe again) or off for this bot. Answers with how it stands. */
    async saveBotTelemetry(botId: string, on: boolean): Promise<BotTelemetry> {
        return this.withPermissionsTimeout(async (signal) => {
            const response = await this.fetch(`/api/bots/${encodeURIComponent(botId)}/privacy`, {
                method: "PUT",
                body: JSON.stringify({ choice: on ? "follow" : "private" }),
                signal,
            });
            return readTelemetry(await response.json());
        });
    }

    /**
     * Set a role's or a person's No / Default / Yes for this bot. Only the actions named change; a row that does not
     * exist yet is added. A person is named by their identifier (what the members search gives).
     */
    async saveBotRule(
        botId: string,
        subject: { roleId: string } | { identifier: string } | { userId: string },
        values: Partial<Record<RuleAction, RuleValue>>
    ): Promise<BotRule> {
        return this.withPermissionsTimeout(async (signal) => {
            const response = await this.fetch(`/api/bots/${encodeURIComponent(botId)}/permissions/rules`, {
                method: "PUT",
                body: JSON.stringify({ ...subject, ...values }),
                signal,
            });
            const rule = readRule(await response.json());
            if (!rule) throw new Error("Orbit answered with something the game does not understand");
            return rule;
        });
    }

    /** Take a role's or a person's row off this bot: they follow the roles again */
    async deleteBotRule(botId: string, subject: { roleId: string } | { userId: string }): Promise<void> {
        const query =
            "roleId" in subject
                ? `roleId=${encodeURIComponent(subject.roleId)}`
                : `userId=${encodeURIComponent(subject.userId)}`;
        await this.withPermissionsTimeout((signal) =>
            this.fetch(`/api/bots/${encodeURIComponent(botId)}/permissions/rules?${query}`, {
                method: "DELETE",
                signal,
            })
        );
    }

    // ─── MCP Server management ──────────────────────────────────────────────────────

    /**
     * Discover OAuth endpoints for an MCP server URL.
     * Uses the BotApiService's fetch for consistent auth (session token, JWT fallback, session refresh).
     */
    async discoverMcpOAuthEndpoints(
        serverUrl: string,
        callbackUrl: string,
        signal?: AbortSignal
    ): Promise<{
        discovered: boolean;
        authorizeUrl?: string;
        tokenUrl?: string;
        clientId?: string;
        clientSecret?: string;
        scopesSupported?: string[];
        registrationStatus?: string;
    }> {
        if (!this.isInitialized()) throw new Error("BotApiService not initialized");
        const response = await this.fetch(
            `/api/mcp/oauth-discover?serverUrl=${encodeURIComponent(serverUrl)}&callbackUrl=${encodeURIComponent(
                callbackUrl
            )}`,
            { signal }
        );
        return response.json();
    }

    async startOAuth(botId: string, serverId: string, redirectUrl: string, callbackUrl?: string): Promise<string> {
        if (!this.isInitialized()) throw new Error("BotApiService not initialized");
        let endpoint = `/api/bots/${botId}/mcp-servers/${serverId}/oauth/start?redirectUrl=${encodeURIComponent(
            redirectUrl
        )}`;
        if (callbackUrl) {
            endpoint += `&callbackUrl=${encodeURIComponent(callbackUrl)}`;
        }
        const response = await this.fetch(endpoint);
        const data = await response.json();
        if (!data.authorizeUrl) {
            throw new Error("OAuth start failed: server did not return an authorization URL");
        }
        return data.authorizeUrl;
    }

    /**
     * Get MCP servers for a bot
     */
    async getBotMcpServers(botId: string): Promise<McpServer[]> {
        try {
            const response = await this.fetch(`/api/bots/${botId}/mcp-servers`, {
                method: "GET",
            });
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.error("[BotApiService] Error getting MCP servers:", error);
            }
            throw error;
        }
    }

    /**
     * Create an MCP server for a bot
     */
    async createBotMcpServer(botId: string, data: CreateMcpServerDto): Promise<McpServer> {
        const response = await this.fetch(`/api/bots/${botId}/mcp-servers`, {
            method: "POST",
            body: JSON.stringify(data),
        });
        return response.json();
    }

    /**
     * Update an MCP server for a bot
     */
    async updateBotMcpServer(botId: string, id: string, data: Partial<CreateMcpServerDto>): Promise<McpServer> {
        const response = await this.fetch(`/api/bots/${botId}/mcp-servers/${id}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        });
        return response.json();
    }

    /**
     * Delete an MCP server for a bot
     */
    async deleteBotMcpServer(botId: string, id: string): Promise<void> {
        await this.fetch(`/api/bots/${botId}/mcp-servers/${id}`, {
            method: "DELETE",
        });
    }

    /**
     * Test connection to an MCP server and return tool names
     */
    async testBotMcpServer(botId: string, id: string): Promise<McpServerTestResponse> {
        const response = await this.fetch(`/api/bots/${botId}/mcp-servers/${id}/test`, {
            method: "POST",
        });
        return response.json();
    }
}

// ─── MCP Server Types ─────────────────────────────────────────────────────────────

export interface McpServer {
    id: string;
    name: string;
    serverUrl: string;
    authType: "none" | "bearer" | "api-key" | "oauth";
    authConfig?: string;
    oauthConnected?: boolean;
    headers?: Record<string, string>;
    enabled: boolean;
    lastTestedAt?: string | null;
    lastTestResult?: {
        success: boolean;
        toolCount: number;
        toolNames: string[];
        error: string | null;
    } | null;
    createdAt: string;
}

export interface CreateMcpServerDto {
    name: string;
    serverUrl: string;
    authType: "none" | "bearer" | "api-key" | "oauth";
    authConfig?: string;
    headers?: Record<string, string>;
}

export interface McpServerTestResponse {
    success: boolean;
    toolCount: number;
    toolNames: string[];
    error?: string | null;
}

export interface McpServerTestResult {
    success: boolean;
    tools: Array<{ name: string; description?: string }>;
    error?: string;
}

// Export singleton instance
export const botApiService = new BotApiService();
