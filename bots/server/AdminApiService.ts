/**
 * AdminApiService - Integration with WorkAdventure Admin API for bot tracking
 * 
 * This service tracks bot configuration and usage across rooms, worlds, and universes.
 */

import axios, { type AxiosResponse } from 'axios';
import { parseForgetNotice, type MemoryForgetHandler } from '../memory/ForgetNotice';

// Optional Sentry integration (uncomment if @sentry/node is installed)
// import * as Sentry from '@sentry/node';

// Helper to safely capture exceptions (works with or without Sentry)
const captureException = (error: Error) => {
    // Uncomment if Sentry is configured:
    // Sentry.captureException(error);
    console.error('AdminApiService error:', error);
};

export function resolveAdminApiEndpoint(adminApiUrl: string | URL, endpoint: string): string {
    const baseUrl = new URL(adminApiUrl.toString());
    if (!baseUrl.pathname.endsWith('/')) {
        baseUrl.pathname += '/';
    }
    baseUrl.search = '';
    baseUrl.hash = '';
    return new URL(endpoint.replace(/^\/+/, ''), baseUrl).toString();
}

let warnedInsecureAdminUrl = false;

/**
 * Whether an Orbit session may be sent to this Admin API URL. Production needs https. Outside production,
 * plain http is also allowed to hosts that only exist on a local or docker network (loopback, *.localhost,
 * single-label docker service names, host.docker.internal and private IPv4 ranges), never to public hosts.
 */
export function canSendSessionTo(adminApiUrl: URL, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
    if (adminApiUrl.protocol === 'https:') return true;
    if (adminApiUrl.protocol !== 'http:' || nodeEnv === 'production') return false;

    const hostname = adminApiUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]') return true;
    if (hostname === 'host.docker.internal' || hostname.endsWith('.internal')) return true;
    if (!hostname.includes('.')) return true; // docker compose service name, e.g. http://admin:3000

    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** What people do with a bot, as Orbit's check names it. */
export type BotAccessAction = 'chat' | 'dm' | 'summon';

/** Who is asking: a signed-in person is named by their uuid or email, a guest only by being a guest. */
export interface BotAccessPerson {
    signedIn: boolean;
    identifier?: string | null;
}

/** Orbit's answer to "can this person do this with this bot?" (POST /api/bots/:id/access). */
export interface BotAccessAnswer {
    allowed: boolean;
    code: 'allowed' | 'sign_in_required' | 'not_allowed' | 'no_room_access';
    /** A line to show as it is. Null when allowed. */
    reason: string | null;
    /** The owner's own line for people who may not chat with the bot, only when the owner wrote one. */
    reply?: string;
}

/** How long a bot waits for Orbit's access answer before it counts as "could not check". */
const BOT_ACCESS_TIMEOUT_MS = 4_000;

export interface BotConfiguration {
    botId: string;
    name: string;
    roomUrl: string;
    worldUrl: string;
    universeUrl?: string;
    userId?: string; // User who created the bot
    behaviorType: 'idle' | 'patrol' | 'social';
    behaviorConfig: Record<string, any>;
    
    // AI Configuration (Sensitive - stored in Admin API only)
    aiProviderRef?: string; // Reference to AI provider (e.g., "lmstudio-local")
    
    // Chat Instructions (Sensitive - stored in Admin API only)
    chatInstructions?: string; // System prompt/instructions for AI behavior

    // How long the bot waits for a tool (MCP) call to answer, in seconds ("Patience").
    // Null or missing means the bot server's default (REQUEST_TIMEOUT, 90 s).
    toolTimeoutSeconds?: number | null;
    
    // Assigned space defines where the bot operates (center + radius)
    // Required: All bots must have an assigned space
    // For idle bots: radius=0 means they won't move
    // For social/patrol bots: radius defines the operational area
    assignedSpace: {
        center: { x: number; y: number };
        radius: number;
    };
    enabled?: boolean; // Whether bot is active (defaults to true if not specified)
    characterTextureIds?: string[]; // Character texture IDs for bot appearance
    // The companion (pet) that walks with the bot: a companion texture id from the room's companion list.
    // Null or missing means none.
    companionTextureId?: string | null;
    position?: { x: number; y: number }; // Teleport position (runtime-only, not persisted)
    createdAt: Date;
    updatedAt: Date;
}

export interface BotUsageMetrics {
    botId: string;
    roomUrl: string;
    worldUrl: string;
    universeUrl?: string;
    userId?: string;
    totalConversations: number;
    totalMessages: number;
    totalActiveTime: number; // milliseconds
    lastActiveAt: Date;
    conversationsByDate: Array<{
        date: string;
        count: number;
    }>;
}

export interface BotUsageQuery {
    roomUrl?: string;
    worldUrl?: string;
    universeUrl?: string;
    userId?: string;
    botId?: string;
    startDate?: Date;
    endDate?: Date;
}

/** Orbit turned a bot save down and said why, in words meant for the person saving. */
export class BotConfigRefused extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BotConfigRefused';
    }
}

/** The fields of one provider, as Orbit serves them. */
export interface AIProviderCredentials {
    providerId: string;
    name: string;
    type: string;
    enabled: boolean;
    endpoint: string;
    apiKeyEncrypted: string | null;
    model: string;
    temperature: number;
    maxTokens: number;
    supportsStreaming: boolean;
    supportsVision: boolean | null;
    visionModel: string | null;
    defaultVision: boolean;
    settings?: Record<string, any>;
}

/**
 * Orbit's answer for a bot (#374): a provider and where it came from, or "resting". `own-key` is a person's own key
 * (`keyAddressTyped` says the person typed its address, so the address guard applies); `universe-ai` may stand in for
 * a key that is down (`standingInFor`); `resting` means the owner chose Stop replying: say the line, call nothing.
 */
export type BotAiCredentialsAnswer =
    | (AIProviderCredentials & {
          source: 'provider' | 'universe-ai' | 'own-key';
          keyOwnerId?: string;
          keyAddressTyped?: boolean;
          standingInFor?: string;
          movedFromKey?: string;
      })
    | { source: 'resting'; keyOwnerId: string; restingLine: string };

export class AdminApiService {
    private adminApiUrl: string;
    // Cache for room metadata (room URL -> metadata, cached for 5 minutes)
    private roomMetadataCache: Map<string, { data: { universeName: string; worldName: string; roomName: string }; cachedAt: number }> = new Map();
    private readonly ROOM_METADATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private adminApiToken: string;
    // Hide bot conversations (#1166): the answer per bot, asked of Orbit at most every 30 seconds
    private botPrivacyCache: Map<string, { hidden: boolean; cachedAt: number; notFoundInARow?: number }> = new Map();
    private botPrivacyRequests: Map<string, Promise<boolean>> = new Map();
    private readonly BOT_PRIVACY_CACHE_TTL = 30 * 1000;
    // "Not found" answers in a row (30 seconds apart) before a bot is taken as deleted
    private readonly BOT_GONE_AFTER = 3;
    private forgetHandler: MemoryForgetHandler | null = null;
    private privacySyncTimer: NodeJS.Timeout | null = null;

    constructor(adminApiUrl?: string, adminApiToken?: string) {
        this.adminApiUrl = adminApiUrl || process.env.ADMIN_API_URL || '';
        this.adminApiToken = adminApiToken || process.env.ADMIN_API_TOKEN || '';
    }

    /**
     * Check if admin API is configured
     */
    isConfigured(): boolean {
        return !!this.adminApiUrl && !!this.adminApiToken;
    }

    /**
     * Save bot configuration to admin API
     */
    async saveBotConfiguration(config: BotConfiguration, actingSession?: string): Promise<void> {
        if (!this.isConfigured()) {
            console.warn('[AdminApiService] Admin API not configured, skipping bot configuration save');
            return;
        }

        try {
            const payload = {
                ...config,
                createdAt: config.createdAt.toISOString(),
                updatedAt: config.updatedAt.toISOString(),
            };
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Saving bot config for ${config.botId}:`, {
                    botId: payload.botId,
                    name: payload.name,
                    behaviorType: payload.behaviorType,
                    hasBehaviorConfig: !!payload.behaviorConfig,
                    hasAiProviderRef: !!payload.aiProviderRef,
                    aiProviderRef: payload.aiProviderRef,
                    hasChatInstructions: !!payload.chatInstructions,
                });
            }
            
            await axios.post(
                `${this.adminApiUrl}/api/bots/configuration`,
                payload,
                {
                    headers: {
                        // A change only a person may make (a bot on their own AI key) goes with their session, so Orbit can see whose it is
                        Authorization: `Bearer ${actingSession ?? this.adminApiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Successfully saved bot config for ${config.botId}`);
            }
        } catch (error) {
            // Orbit turned the save down and said why: that is an answer for the person, not a crash
            if (axios.isAxiosError(error) && error.response?.status === 400 && typeof error.response.data?.error === 'string') {
                throw new BotConfigRefused(error.response.data.error);
            }
            console.error('[AdminApiService] Error saving bot configuration:', error);
            if ((process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') && axios.isAxiosError(error) && error.response) {
                console.error('[AdminApiService] Response status:', error.response.status);
                console.error('[AdminApiService] Response data:', error.response.data);
            }
            captureException(error);
            throw error;
        }
    }

    /**
     * Get bot configuration from admin API
     */
    async getBotConfiguration(botId: string, timeoutMs?: number): Promise<BotConfiguration | null> {
        if (!this.isConfigured()) {
            return null;
        }

        try {
            const response: AxiosResponse<BotConfiguration> = await axios.get(
                `${this.adminApiUrl}/api/bots/configuration/${botId}`,
                {
                    timeout: timeoutMs,
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                    },
                }
            );

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Fetched bot config for ${botId}:`, {
                    botId: response.data.botId,
                    name: response.data.name,
                    behaviorType: response.data.behaviorType,
                    hasBehaviorConfig: !!response.data.behaviorConfig,
                    hasAiProviderRef: !!response.data.aiProviderRef,
                    aiProviderRef: response.data.aiProviderRef,
                    hasChatInstructions: !!response.data.chatInstructions,
                });
            }

            return {
                ...response.data,
                createdAt: new Date(response.data.createdAt),
                updatedAt: new Date(response.data.updatedAt),
            };
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null;
            }
            console.error('[AdminApiService] Error getting bot configuration:', error);
            captureException(error);
            throw error;
        }
    }

    /**
     * Get all bot configurations for a room/world/universe
     */
    async getBotConfigurations(query: {
        roomUrl?: string;
        worldUrl?: string;
        universeUrl?: string;
        userId?: string;
    }): Promise<BotConfiguration[]> {
        if (!this.isConfigured()) {
            return [];
        }

        try {
            const response: AxiosResponse<BotConfiguration[]> = await axios.get(
                `${this.adminApiUrl}/api/bots/configuration`,
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                    },
                    params: query,
                }
            );

            return response.data.map((config) => ({
                ...config,
                createdAt: new Date(config.createdAt),
                updatedAt: new Date(config.updatedAt),
            }));
        } catch (error) {
            console.error('[AdminApiService] Error getting bot configurations:', error);
            captureException(error);
            throw error;
        }
    }

    /**
     * Delete bot configuration
     */
    async deleteBotConfiguration(botId: string): Promise<void> {
        if (!this.isConfigured()) {
            return;
        }

        try {
            await axios.delete(`${this.adminApiUrl}/api/bots/configuration/${botId}`, {
                headers: {
                    Authorization: `Bearer ${this.adminApiToken}`,
                },
            });
        } catch (error) {
            console.error('[AdminApiService] Error deleting bot configuration:', error);
            captureException(error);
            throw error;
        }
    }

    /**
     * Track bot usage metrics
     */
    async trackBotUsage(metrics: Partial<BotUsageMetrics>): Promise<void> {
        if (!this.isConfigured()) {
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/usage`,
                {
                    ...metrics,
                    lastActiveAt: metrics.lastActiveAt?.toISOString(),
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error) {
            console.error('[AdminApiService] Error tracking bot usage:', error);
            captureException(error);
            // Don't throw - usage tracking shouldn't break bot functionality
        }
    }

    /**
     * Get bot usage metrics
     */
    async getBotUsage(query: BotUsageQuery): Promise<BotUsageMetrics[]> {
        if (!this.isConfigured()) {
            return [];
        }

        try {
            const params: Record<string, string> = {};
            if (query.roomUrl) params.roomUrl = query.roomUrl;
            if (query.worldUrl) params.worldUrl = query.worldUrl;
            if (query.universeUrl) params.universeUrl = query.universeUrl;
            if (query.userId) params.userId = query.userId;
            if (query.botId) params.botId = query.botId;
            if (query.startDate) params.startDate = query.startDate.toISOString();
            if (query.endDate) params.endDate = query.endDate.toISOString();

            const response: AxiosResponse<BotUsageMetrics[]> = await axios.get(
                `${this.adminApiUrl}/api/bots/usage`,
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                    },
                    params,
                }
            );

            return response.data.map((metrics) => ({
                ...metrics,
                lastActiveAt: new Date(metrics.lastActiveAt),
            }));
        } catch (error) {
            console.error('[AdminApiService] Error getting bot usage:', error);
            captureException(error);
            throw error;
        }
    }

    /**
     * Track bot conversation event
     */
    async trackConversation(botId: string, playerId: number, roomUrl: string, duration: number): Promise<void> {
        if (!this.isConfigured()) {
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/conversations`,
                {
                    botId,
                    playerId,
                    roomUrl,
                    duration,
                    timestamp: new Date().toISOString(),
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error: any) {
            const msg = error?.response?.data?.message || error?.message || 'Unknown error';
            console.error(`[AdminApiService] Error tracking conversation: ${msg}`);
            // Don't throw - tracking shouldn't break functionality
        }
    }

    /**
     * Track bot message sent
     */
    async trackMessage(botId: string, roomUrl: string, messageLength: number): Promise<void> {
        if (!this.isConfigured()) {
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/messages`,
                {
                    botId,
                    roomUrl,
                    messageLength,
                    timestamp: new Date().toISOString(),
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error: any) {
            const msg = error?.response?.data?.message || error?.message || 'Unknown error';
            console.error(`[AdminApiService] Error tracking message: ${msg}`);
            // Don't throw
        }
    }

    /**
     * Get AI provider credentials from Admin API
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     */
    async getAIProviderCredentials(providerId: string): Promise<{
        providerId: string;
        name: string;
        type: string;
        enabled: boolean;
        endpoint: string;
        apiKeyEncrypted: string | null;
        model: string;
        temperature: number;
        maxTokens: number;
        supportsStreaming: boolean;
        supportsVision: boolean | null;
        visionModel: string | null;
        defaultVision: boolean;
        settings?: Record<string, any>;
    } | null> {
        if (!this.isConfigured()) {
            return null;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            throw new Error('BOT_SERVICE_TOKEN environment variable is not set');
        }

        try {
            const response: AxiosResponse = await axios.get(
                `${this.adminApiUrl}/api/bots/ai-providers/${providerId}/credentials`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                }
            );

            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null;
            }
            console.error('[AdminApiService] Error getting AI provider credentials:', error);
            captureException(error as Error);
            throw error;
        }
    }

    /**
     * How one bot talks to its AI, asked by bot id (#374). Needed for bots on Universe AI or on a person's own key:
     * Orbit decides, per bot, whether that key may run it now, and answers with the key, with Universe AI's provider,
     * or (when the owner chose "Stop replying" for a key that is down) with a resting line and no provider at all.
     * Returns null when Orbit does not know the bot or has no such route yet.
     */
    async getBotAiCredentials(botId: string): Promise<BotAiCredentialsAnswer | null> {
        if (!this.isConfigured()) {
            return null;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            throw new Error('BOT_SERVICE_TOKEN environment variable is not set');
        }

        try {
            const response: AxiosResponse = await axios.get(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/ai-credentials`,
                { headers: { Authorization: `Bearer ${botServiceToken}` }, timeout: 15000 }
            );
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null;
            }
            console.error('[AdminApiService] Error getting bot AI credentials:', error);
            captureException(error as Error);
            throw error;
        }
    }

    /**
     * Tells Orbit how a reply through a person's own key went (#374), so it can mark the key Down after two failed
     * replies in a row or a rejected key. `status` is the HTTP status the provider answered with, when it did: Orbit decides
     * which statuses count against the key (a 400 or a 429 says nothing about the key). Fire-and-forget: a report never
     * slows or breaks a reply.
     */
    async reportAiHealth(botId: string, outcome: { ok: true } | { ok: false; rejected: boolean; status?: number }): Promise<void> {
        if (!this.isConfigured()) return;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) return;
        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/ai-health`,
                outcome,
                { headers: { Authorization: `Bearer ${botServiceToken}` }, timeout: 10000 }
            );
        } catch (error) {
            const msg = (axios.isAxiosError(error) && error.response?.data?.message) || (error as Error)?.message || 'Unknown error';
            console.error(`[AdminApiService] Error reporting AI health: ${msg}`);
        }
    }

    /**
     * Get available AI providers
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     */
    async getAvailableAIProviders(enabled?: boolean): Promise<Array<{
        providerId: string;
        name: string;
        type: string;
        enabled: boolean;
        model: string;
        supportsStreaming: boolean;
        supportsVision: boolean | null;
        visionModel: string | null;
        defaultVision: boolean;
    }>> {
        if (!this.isConfigured()) {
            return [];
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            throw new Error('BOT_SERVICE_TOKEN environment variable is not set');
        }

        try {
            const params: Record<string, any> = {};
            if (enabled !== undefined) {
                params.enabled = enabled;
            }

            const response: AxiosResponse = await axios.get(
                `${this.adminApiUrl}/api/bots/ai-providers`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                    params,
                }
            );

            return response.data;
        } catch (error) {
            console.error('[AdminApiService] Error getting available AI providers:', error);
            captureException(error as Error);
            return [];
        }
    }

    /**
     * Does this bot hide its conversations (Orbit "Hide bot conversations", #435)? The universe default and the
     * bot's own choice are resolved by Orbit; this only asks. A private bot sends nothing to PostHog or Sentry
     * spans; chats, memory, usage counts and everything else work as always.
     *
     * Orbit is asked at most every 30 seconds per bot. A bot Orbit does not know, or an Orbit without the setting
     * yet, is "not private", as every bot was before this setting existed. If Orbit cannot answer (down, timeout,
     * refused), the last answer is kept, and with none yet the bot counts as private until Orbit answers. Never throws. `fresh` skips the 30 second wait (the bot server's own check).
     *
     * Orbit's answer also carries the people a manager asked the bot to forget; those go to the forget handler.
     */
    async isBotPrivate(botId: string, options: { fresh?: boolean } = {}): Promise<boolean> {
        const cached = this.botPrivacyCache.get(botId);
        if (!options.fresh && cached && Date.now() - cached.cachedAt < this.BOT_PRIVACY_CACHE_TTL) {
            return cached.hidden;
        }
        if (!this.isConfigured()) {
            return cached?.hidden ?? false;
        }
        const inFlight = this.botPrivacyRequests.get(botId);
        if (inFlight) return inFlight;

        const request = this.fetchBotPrivacy(botId, cached?.hidden).finally(() => {
            this.botPrivacyRequests.delete(botId);
        });
        this.botPrivacyRequests.set(botId, request);
        return request;
    }

    /**
     * Ask Orbit about each running bot every 30 seconds. The answer keeps the privacy setting fresh and carries the
     * people a manager asked the bot to forget, so a Forget lands even while nobody is talking to the bot.
     */
    startPrivacySync(getBotIds: () => Iterable<string>, onGone?: (botId: string) => void): void {
        if (this.privacySyncTimer || !this.isConfigured()) {
            return;
        }
        this.privacySyncTimer = setInterval(() => {
            for (const botId of getBotIds()) {
                void this.isBotPrivate(botId, { fresh: true }).then(() => {
                    // Orbit has said "not found" several times running (the bot was deleted, not a hiccup): stop asking,
                    // and let the caller stop tracking it
                    if ((this.botPrivacyCache.get(botId)?.notFoundInARow ?? 0) >= this.BOT_GONE_AFTER) {
                        this.botPrivacyCache.delete(botId);
                        onGone?.(botId);
                    }
                });
            }
        }, this.BOT_PRIVACY_CACHE_TTL);
        // Never keep the process alive for this
        this.privacySyncTimer.unref?.();
    }

    stopPrivacySync(): void {
        if (this.privacySyncTimer) {
            clearInterval(this.privacySyncTimer);
            this.privacySyncTimer = null;
        }
    }

    /** Called with the people Orbit asks the bot server to forget. */
    setForgetHandler(handler: MemoryForgetHandler | null): void {
        this.forgetHandler = handler;
    }

    private applyForgetNotice(botId: string, forget: unknown): void {
        const notice = parseForgetNotice(forget);
        if (!this.forgetHandler || !notice) return;
        try {
            this.forgetHandler(botId, notice);
        } catch (error) {
            console.error('[AdminApiService] Could not drop forgotten memories:', error);
        }
    }

    private async fetchBotPrivacy(botId: string, lastKnown: boolean | undefined): Promise<boolean> {
        // BOT_SERVICE_TOKEN is preferred, the admin token is the fallback (same as the memory endpoints)
        const token = process.env.BOT_SERVICE_TOKEN || this.adminApiToken;
        try {
            const response: AxiosResponse = await axios.get(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/privacy`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 5000,
                }
            );
            const hidden = response.data?.hidden === true;
            this.botPrivacyCache.set(botId, { hidden, cachedAt: Date.now() });
            this.applyForgetNotice(botId, response.data?.forget);
            return hidden;
        } catch (error) {
            // Not found (or an Orbit without the setting yet) is a plain "not private", except for a bot last known as
            // private: its proxy can answer "not found" while Orbit restarts, so it stays private until Orbit has said
            // it BOT_GONE_AFTER times running, the same rule that decides the bot is gone. Anything else keeps what we knew.
            // With nothing known yet (a bot server that just started, while Orbit restarts too), the bot counts as
            // private until Orbit answers: a hidden bot must never send its text out because Orbit was slow to say so.
            // Only telemetry waits; replies, memory and saved chats are the same either way.
            const notFound = axios.isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 405);
            const notFoundInARow = notFound ? (this.botPrivacyCache.get(botId)?.notFoundInARow ?? 0) + 1 : 0;
            const hidden = notFound ? lastKnown === true && notFoundInARow < this.BOT_GONE_AFTER : lastKnown ?? true;
            // Retry soon, not after the full 30 seconds, when Orbit could not answer
            this.botPrivacyCache.set(botId, { hidden, cachedAt: notFound ? Date.now() : Date.now() - this.BOT_PRIVACY_CACHE_TTL + 5000, ...(notFoundInARow ? { notFoundInARow } : {}) });
            if (!notFound) {
                console.warn('[AdminApiService] Could not read the bot privacy setting, keeping the last answer:', axios.isAxiosError(error) ? error.message : 'unknown error');
            }
            return hidden;
        }
    }

    /**
     * Validate an opaque Orbit session with the Admin API, which owns the
     * server-side session record. The bot server never decodes credentials.
     */
    async validateSessionToken(sessionToken: string): Promise<{
        userId: string;
        uuid: string;
        email: string | null;
        name: string | null;
        tags: string[];
    } | null> {
        if (!this.adminApiUrl || !/^orb_sess_v2_[0-9a-f]{64}$/.test(sessionToken)) {
            return null;
        }

        let adminApiUrl: URL;
        try {
            adminApiUrl = new URL(this.adminApiUrl);
        } catch {
            return null;
        }
        if (!canSendSessionTo(adminApiUrl)) {
            if (!warnedInsecureAdminUrl) {
                warnedInsecureAdminUrl = true;
                console.warn(
                    `[AdminApiService] Not validating Orbit sessions against ${adminApiUrl.origin}: ` +
                        'ADMIN_API_URL must be https, or http to a local or private host outside production'
                );
            }
            return null;
        }

        try {
            const response: AxiosResponse = await axios.get(resolveAdminApiEndpoint(adminApiUrl, 'api/auth/me'), {
                headers: {
                    Authorization: `Bearer ${sessionToken}`,
                    'Cache-Control': 'no-store',
                },
                timeout: 5_000,
            });
            const user = response.data?.user;
            if (!user?.id || !user?.uuid) return null;
            return {
                userId: user.id,
                uuid: user.uuid,
                email: user.email || null,
                name: user.name || null,
                tags: Array.isArray(user.tags) ? user.tags : [],
            };
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[AdminApiService] Admin API rejected Orbit session');
            }
            return null;
        }
    }

    /**
     * Ask the Admin API whether the person behind an Orbit session may manage a bot. The Admin API answers a bot's
     * configuration only to people who can manage bots in that bot's room (or super admins), so a 200 means yes and
     * anything else means no. Fails closed.
     */
    async canSessionManageBot(sessionToken: string, botId: string): Promise<boolean> {
        if (!this.adminApiUrl || !/^orb_sess_v2_[0-9a-f]{64}$/.test(sessionToken) || !botId) {
            return false;
        }

        let adminApiUrl: URL;
        try {
            adminApiUrl = new URL(this.adminApiUrl);
        } catch {
            return false;
        }
        if (!canSendSessionTo(adminApiUrl)) {
            return false;
        }

        try {
            const response: AxiosResponse = await axios.get(
                resolveAdminApiEndpoint(adminApiUrl, `api/bots/configuration/${encodeURIComponent(botId)}`),
                {
                    headers: {
                        Authorization: `Bearer ${sessionToken}`,
                        'Cache-Control': 'no-store',
                    },
                    timeout: 5_000,
                    validateStatus: () => true,
                }
            );
            return response.status === 200;
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[AdminApiService] Bot permission check failed');
            }
            return false;
        }
    }

    /**
     * Ask Orbit whether a person may do something with a bot (Orbit #426/#427): chat in its bubble, message it, or
     * summon it. A no is an answer ({ allowed: false }); anything that stops Orbit answering throws, so the caller
     * can tell "no" from "could not check". Uses BOT_SERVICE_TOKEN.
     */
    async checkBotAccess(
        botId: string,
        action: BotAccessAction,
        person: BotAccessPerson
    ): Promise<BotAccessAnswer> {
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            throw new Error('BOT_SERVICE_TOKEN environment variable is not set');
        }

        const response: AxiosResponse<BotAccessAnswer> = await axios.post(
            resolveAdminApiEndpoint(this.adminApiUrl, `api/bots/${encodeURIComponent(botId)}/access`),
            { action, person: { signedIn: person.signedIn, ...(person.identifier ? { identifier: person.identifier } : {}) } },
            {
                headers: {
                    Authorization: `Bearer ${botServiceToken}`,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                },
                timeout: BOT_ACCESS_TIMEOUT_MS,
            }
        );
        const answer = response.data;
        if (!answer || typeof answer.allowed !== 'boolean') {
            throw new Error('Orbit answered the bot access check with something unexpected');
        }
        return answer;
    }

    /**
     * Track AI usage
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     * Fire-and-forget (doesn't throw errors)
     */
    async trackAIUsage(usage: {
        botId: string;
        providerId: string;
        tokensUsed?: number;
        promptTokens?: number;
        completionTokens?: number;
        /** Part of the input read from / written to the provider's cache (inside the input, not on top of it) */
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        apiCalls?: number;
        durationSeconds?: number | null;
        cost?: number;
        latency?: number;
        error?: boolean;
        timestamp?: string;
    }): Promise<void> {
        if (!this.isConfigured()) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] Admin API not configured, skipping AI usage tracking');
            }
            return;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, skipping AI usage tracking');
            return;
        }

        try {
            const payload = {
                botId: usage.botId,
                providerId: usage.providerId,
                tokensUsed: usage.tokensUsed || 0,
                // Orbit ignores what it doesn't store yet; its usage table takes these with the cost rework (#1173)
                ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}),
                ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
                apiCalls: usage.apiCalls || 1,
                durationSeconds: usage.durationSeconds ?? null,
                cost: usage.cost ?? null,
                latency: usage.latency ?? null,
                error: usage.error || false,
                timestamp: usage.timestamp || new Date().toISOString(),
            };

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Sending usage tracking:`, JSON.stringify(payload, null, 2));
            }

            const response = await axios.post(
                `${this.adminApiUrl}/api/bots/ai-usage`,
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Usage tracking response:`, response.status, JSON.stringify(response.data, null, 2));
            }
        } catch (error: any) {
            // Fire-and-forget: don't throw, just log
            console.error('[AdminApiService] Error tracking AI usage:', error);
            if (error.response) {
                console.error('[AdminApiService] Error response status:', error.response.status);
                console.error('[AdminApiService] Error response data:', error.response.data);
            } else if (error.message) {
                console.error('[AdminApiService] Error message:', error.message);
            }
        }
    }

    /**
     * Save bot metrics to Admin API
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     * Fire-and-forget (doesn't throw errors)
     */
    async saveBotMetrics(metrics: Array<{
        botId: string;
        timestamp: number;
        metrics: {
            responseTime?: number;
            tokenUsage?: {
                prompt: number;
                completion: number;
                total: number;
            };
            repetitionScore?: number;
            systemPromptLeakage?: boolean;
            personalityCompliance?: number;
            conversationQuality?: number;
            errorCount?: number;
        };
        metadata?: Record<string, any>;
    }>): Promise<void> {
        if (!this.isConfigured()) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] Admin API not configured, skipping metrics save');
            }
            return;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, skipping metrics save');
            return;
        }

        try {
            // Filter out test metrics one more time (defense in depth)
            const realMetrics = metrics.filter(metric => {
                const playerId = metric.metadata?.playerId;
                return playerId !== 999999 && playerId !== '999999';
            });

            if (realMetrics.length === 0) {
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[AdminApiService] Skipped saving ${metrics.length} test metrics`);
                }
                return; // No real metrics to save
            }

            await axios.post(
                `${this.adminApiUrl}/api/bots/metrics`,
                { metrics: realMetrics },
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                const filteredCount = metrics.length - realMetrics.length;
                if (filteredCount > 0) {
                    console.log(`[AdminApiService] Saved ${realMetrics.length} metrics (filtered ${filteredCount} test metrics)`);
                } else {
                    console.log(`[AdminApiService] Saved ${realMetrics.length} metrics`);
                }
            }
        } catch (error: any) {
            // Fire-and-forget: don't throw, just log
            console.error('[AdminApiService] Error saving bot metrics:', error);
            if (error.response) {
                console.error('[AdminApiService] Error response status:', error.response.status);
                console.error('[AdminApiService] Error response data:', error.response.data);
            }
        }
    }

    /**
     * Save test results to Admin API
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     * Fire-and-forget (doesn't throw errors)
     */
    async saveTestResults(testResult: {
        testId: string;
        botId: string;
        testSuite: string;
        results: any;
        passed: boolean;
        summary?: {
            total: number;
            passed: number;
            failed: number;
            skipped: number;
        };
        startedAt?: number;
        completedAt?: number;
        duration?: number;
    }): Promise<void> {
        // Check only adminApiUrl (not adminApiToken - test results use BOT_SERVICE_TOKEN)
        if (!this.adminApiUrl) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] Admin API URL not configured, skipping test results save');
            }
            return;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, skipping test results save');
            }
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/test/results`,
                testResult,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Saved test result: ${testResult.testId}`);
            }
        } catch (error: any) {
            // Fire-and-forget: don't throw, just log
            console.error('[AdminApiService] Error saving test results:', error);
            if (error.response) {
                console.error('[AdminApiService] Error response status:', error.response.status);
                console.error('[AdminApiService] Error response data:', error.response.data);
            }
        }
    }

    /**
     * @deprecated This method is no longer used - improvements endpoint was removed
     * Task files in bots/improvement-tasks/ are now the source of truth
     * This method is kept for backward compatibility but does nothing
     */
    async saveImprovement(improvement: {
        botId: string;
        improvementType: string;
        changes: any;
        metricsBefore?: any;
        metricsAfter?: any;
        deployed?: boolean;
        recommendations?: any[];
        testRunId?: string;
    }): Promise<void> {
        // No-op: Improvements endpoint was removed, task files are now the source of truth
        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[AdminApiService] saveImprovement called but ignored (endpoint removed, using task files instead)`);
        }
        return;
    }

    /**
     * Get bot metrics from Admin API
     */
    async getBotMetrics(botId: string, query?: {
        metricType?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
        offset?: number;
    }): Promise<Array<{
        botId: string;
        timestamp: number;
        metrics: Record<string, any>;
        metadata?: Record<string, any>;
    }>> {
        if (!this.isConfigured()) {
            return [];
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, cannot get metrics');
            return [];
        }

        try {
            const params: Record<string, any> = { botId };
            if (query) {
                if (query.metricType) params.metricType = query.metricType;
                if (query.startTime) params.startTime = query.startTime;
                if (query.endTime) params.endTime = query.endTime;
                if (query.limit) params.limit = query.limit;
                if (query.offset) params.offset = query.offset;
            }

            const response = await axios.get(
                `${this.adminApiUrl}/api/bots/${botId}/metrics`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                    params,
                }
            );

            return response.data || [];
        } catch (error: any) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return [];
            }
            console.error('[AdminApiService] Error getting bot metrics:', error);
            return [];
        }
    }

    /**
     * Get room metadata (universe, world, room names)
     * Calls the Admin API's /api/room/info endpoint or extracts from URL
     * Results are cached for 5 minutes to improve performance
     */
    async getRoomMetadata(roomUrl: string): Promise<{ universeName: string; worldName: string; roomName: string } | null> {
        // Check cache first
        const cached = this.roomMetadataCache.get(roomUrl);
        const cacheAge = cached ? Date.now() - cached.cachedAt : Infinity;
        
        if (cached && cacheAge < this.ROOM_METADATA_CACHE_TTL) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Using cached room metadata for ${roomUrl} (cached ${Math.round(cacheAge / 1000)}s ago):`, cached.data);
            }
            return cached.data;
        }
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            if (cached) {
                console.log(`[AdminApiService] Cache expired for ${roomUrl} (age: ${Math.round(cacheAge / 1000)}s, TTL: ${this.ROOM_METADATA_CACHE_TTL / 1000}s), fetching fresh data`);
            } else {
                console.log(`[AdminApiService] No cache for ${roomUrl}, fetching fresh data`);
            }
        }

        let result: { universeName: string; worldName: string; roomName: string } | null = null;

        try {
            // Extract slug from roomUrl: "https://universe.bawes.net/@/bawes/bawes/headquarters" -> "bawes/bawes/headquarters"
            const urlObj = new URL(roomUrl);
            const pathMatch = /^\/@\/(.+)/.exec(urlObj.pathname);
            
            if (pathMatch) {
                const slug = pathMatch[1]; // "bawes/bawes/headquarters"
                
                // Call Admin API's /api/room/info endpoint (public, no auth required)
                const adminApiUrl = this.adminApiUrl || process.env.ADMIN_API_URL;
                if (adminApiUrl) {
                    const infoUrl = `${adminApiUrl}/api/room/info?slug=${encodeURIComponent(slug)}`;
                    
                    const response = await axios.get(infoUrl, {
                        timeout: 10000,
                    });

                    if (response.data && response.data.roomName && response.data.worldName && response.data.universeName) {
                        result = {
                            universeName: response.data.universeName,
                            worldName: response.data.worldName,
                            roomName: response.data.roomName,
                        };
                    }
                }
            }
        } catch (error) {
            console.warn(`[AdminApiService] Failed to get room metadata from Admin API for ${roomUrl}, using URL fallback:`, error);
        }

        // Fallback: extract from URL if API call failed
        if (!result) {
            try {
                const urlObj = new URL(roomUrl);
                const pathMatch = /^\/@\/(.+)/.exec(urlObj.pathname);
                if (pathMatch) {
                    const parts = pathMatch[1].split('/').filter(p => p);
                    if (parts.length >= 3) {
                        result = {
                            universeName: parts[0] || '',
                            worldName: parts[1] || '',
                            roomName: parts[2] || '',
                        };
                    }
                }
            } catch (error) {
                console.error(`[AdminApiService] Failed to parse room URL: ${roomUrl}`, error);
            }
        }

        // Cache the result (even if null, to avoid repeated failed lookups)
        if (result) {
            this.roomMetadataCache.set(roomUrl, {
                data: result,
                cachedAt: Date.now(),
            });
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Cached room metadata for ${roomUrl}: ${result.universeName}/${result.worldName}/${result.roomName}`);
            }
        } else {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[AdminApiService] Failed to get room metadata for ${roomUrl}, result is null`);
            }
        }

        return result;
    }
}

// Singleton instance
export const adminApiService = new AdminApiService();
