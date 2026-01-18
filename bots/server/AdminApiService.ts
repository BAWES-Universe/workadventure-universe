/**
 * AdminApiService - Integration with WorkAdventure Admin API for bot tracking
 * 
 * This service tracks bot configuration and usage across rooms, worlds, and universes.
 */

import axios, { type AxiosResponse } from 'axios';

// Optional Sentry integration (uncomment if @sentry/node is installed)
// import * as Sentry from '@sentry/node';

// Helper to safely capture exceptions (works with or without Sentry)
const captureException = (error: Error) => {
    // Uncomment if Sentry is configured:
    // Sentry.captureException(error);
    console.error('AdminApiService error:', error);
};

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

export class AdminApiService {
    private adminApiUrl: string;
    // Cache for room metadata (room URL -> metadata, cached for 5 minutes)
    private roomMetadataCache: Map<string, { data: { universeName: string; worldName: string; roomName: string }; cachedAt: number }> = new Map();
    private readonly ROOM_METADATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private adminApiToken: string;

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
    async saveBotConfiguration(config: BotConfiguration): Promise<void> {
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
                        Authorization: `Bearer ${this.adminApiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Successfully saved bot config for ${config.botId}`);
            }
        } catch (error) {
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
    async getBotConfiguration(botId: string): Promise<BotConfiguration | null> {
        if (!this.isConfigured()) {
            return null;
        }

        try {
            const response: AxiosResponse<BotConfiguration> = await axios.get(
                `${this.adminApiUrl}/api/bots/configuration/${botId}`,
                {
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
        } catch (error) {
            console.error('[AdminApiService] Error tracking conversation:', error);
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
        } catch (error) {
            console.error('[AdminApiService] Error tracking message:', error);
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
     * Get available AI providers
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     */
    async getAvailableAIProviders(enabled?: boolean): Promise<Array<{
        providerId: string;
        name: string;
        type: string;
        enabled: boolean;
        supportsStreaming: boolean;
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
     * Validate Admin API session token
     * Session tokens are base64-encoded JSON with userId, uuid, email, name, tags, createdAt, expiresAt
     * Validates by decoding and checking expiration
     * Returns user info if token is valid, null otherwise
     */
    async validateSessionToken(sessionToken: string): Promise<{
        userId: string;
        uuid: string;
        email: string | null;
        name: string | null;
        tags: string[];
    } | null> {
        if (!this.isConfigured()) {
            return null;
        }

        try {
            // Decode base64 session token
            const decoded = Buffer.from(sessionToken, 'base64').toString('utf-8');
            const sessionData = JSON.parse(decoded);

            // Check if token has required fields
            if (!sessionData.userId || !sessionData.uuid || !sessionData.expiresAt) {
                return null;
            }

            // Check if token is expired
            const now = Date.now();
            if (sessionData.expiresAt <= now) {
                return null;
            }

            // Return user info from session token
            return {
                userId: sessionData.userId,
                uuid: sessionData.uuid,
                email: sessionData.email || null,
                name: sessionData.name || null,
                tags: sessionData.tags || [],
            };
        } catch (error) {
            // Invalid token format (not base64, not JSON, missing fields, etc.)
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[AdminApiService] Error validating session token:', error);
            }
            return null;
        }
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
            await axios.post(
                `${this.adminApiUrl}/api/bots/metrics`,
                { metrics },
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Saved ${metrics.length} metrics`);
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
        if (!this.isConfigured()) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] Admin API not configured, skipping test results save');
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
     * Save improvement cycle to Admin API
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     * Fire-and-forget (doesn't throw errors)
     */
    async saveImprovement(improvement: {
        botId: string;
        improvementType: string;
        changes: any;
        metricsBefore?: any;
        metricsAfter?: any;
        deployed?: boolean;
    }): Promise<void> {
        if (!this.isConfigured()) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] Admin API not configured, skipping improvement save');
            }
            return;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, skipping improvement save');
            }
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/improvements`,
                improvement,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Saved improvement: ${improvement.improvementType} for bot ${improvement.botId}`);
            }
        } catch (error: any) {
            // Fire-and-forget: don't throw, just log
            console.error('[AdminApiService] Error saving improvement:', error);
            if (error.response) {
                console.error('[AdminApiService] Error response status:', error.response.status);
                console.error('[AdminApiService] Error response data:', error.response.data);
            }
        }
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

