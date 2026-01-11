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
    
    // Movement Instructions (Sensitive - stored in Admin API only)
    movementInstructions?: string; // Instructions for who to approach and when
    
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
                    hasAiProviderRef: !!payload.aiProviderRef,
                    aiProviderRef: payload.aiProviderRef,
                    hasChatInstructions: !!payload.chatInstructions,
                    hasMovementInstructions: !!payload.movementInstructions,
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
                    hasAiProviderRef: !!response.data.aiProviderRef,
                    aiProviderRef: response.data.aiProviderRef,
                    hasChatInstructions: !!response.data.chatInstructions,
                    hasMovementInstructions: !!response.data.movementInstructions,
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
            return;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, skipping AI usage tracking');
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/ai-usage`,
                {
                    botId: usage.botId,
                    providerId: usage.providerId,
                    tokensUsed: usage.tokensUsed || 0,
                    apiCalls: usage.apiCalls || 1,
                    durationSeconds: usage.durationSeconds ?? null,
                    cost: usage.cost ?? null,
                    latency: usage.latency ?? null,
                    error: usage.error || false,
                    timestamp: usage.timestamp || new Date().toISOString(),
                },
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error) {
            // Fire-and-forget: don't throw, just log
            console.error('[AdminApiService] Error tracking AI usage:', error);
        }
    }
}

// Singleton instance
export const adminApiService = new AdminApiService();

