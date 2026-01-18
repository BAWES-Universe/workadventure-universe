/**
 * ConversationCleanup - Manual cleanup service for conversations
 * 
 * Features:
 * - Manual cleanup only (no background jobs)
 * - Methods for cleaning up old conversations
 * - Returns cleanup stats
 * - Called only via admin API endpoints
 */

import { AdminApiService } from '../server/AdminApiService';
import axios from 'axios';

export interface CleanupOptions {
    olderThanDays?: number;
    keepRecent?: number; // Keep only last N conversations
    maxPerBot?: number; // Maximum conversations per bot
    maxTotal?: number; // Maximum total conversations across all bots
}

export interface CleanupStats {
    deletedCount: number;
    spaceFreed?: number; // Approximate space freed in bytes
    botsAffected: number;
    errors?: string[];
}

export class ConversationCleanup {
    private adminApiService: AdminApiService;

    constructor(adminApiService: AdminApiService) {
        this.adminApiService = adminApiService;
    }

    /**
     * Cleanup old conversations for a specific bot
     */
    async cleanupOldConversations(botId: string, olderThanDays: number): Promise<CleanupStats> {
        if (!this.adminApiService.isConfigured()) {
            return { deletedCount: 0, botsAffected: 0 };
        }

        const adminApiUrl = this.adminApiService['adminApiUrl'] || process.env.ADMIN_API_URL;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;

        if (!adminApiUrl || !botServiceToken) {
            return { deletedCount: 0, botsAffected: 0 };
        }

        try {
            const response = await axios.delete(
                `${adminApiUrl}/api/bots/${botId}/conversations/cleanup`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                    params: {
                        olderThanDays,
                    },
                }
            );

            return response.data || { deletedCount: 0, botsAffected: 0 };
        } catch (error: any) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[ConversationCleanup] Error cleaning up old conversations:', error);
            }
            return {
                deletedCount: 0,
                botsAffected: 0,
                errors: [error.message || 'Unknown error'],
            };
        }
    }

    /**
     * Keep only last N conversations for a bot
     */
    async cleanupByBot(botId: string, keepRecent: number): Promise<CleanupStats> {
        if (!this.adminApiService.isConfigured()) {
            return { deletedCount: 0, botsAffected: 0 };
        }

        const adminApiUrl = this.adminApiService['adminApiUrl'] || process.env.ADMIN_API_URL;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;

        if (!adminApiUrl || !botServiceToken) {
            return { deletedCount: 0, botsAffected: 0 };
        }

        try {
            const response = await axios.delete(
                `${adminApiUrl}/api/bots/${botId}/conversations/cleanup`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                    params: {
                        keepRecent,
                    },
                }
            );

            return response.data || { deletedCount: 0, botsAffected: 0 };
        } catch (error: any) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[ConversationCleanup] Error cleaning up by bot:', error);
            }
            return {
                deletedCount: 0,
                botsAffected: 0,
                errors: [error.message || 'Unknown error'],
            };
        }
    }

    /**
     * Cleanup all bots with limits
     */
    async cleanupAll(options: CleanupOptions): Promise<CleanupStats> {
        if (!this.adminApiService.isConfigured()) {
            return { deletedCount: 0, botsAffected: 0 };
        }

        const adminApiUrl = this.adminApiService['adminApiUrl'] || process.env.ADMIN_API_URL;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;

        if (!adminApiUrl || !botServiceToken) {
            return { deletedCount: 0, botsAffected: 0 };
        }

        try {
            const params: Record<string, any> = {};
            if (options.olderThanDays) params.olderThanDays = options.olderThanDays;
            if (options.maxPerBot) params.maxPerBot = options.maxPerBot;
            if (options.maxTotal) params.maxTotal = options.maxTotal;

            const response = await axios.delete(
                `${adminApiUrl}/api/bots/conversations/cleanup`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                    params,
                }
            );

            return response.data || { deletedCount: 0, botsAffected: 0 };
        } catch (error: any) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[ConversationCleanup] Error cleaning up all:', error);
            }
            return {
                deletedCount: 0,
                botsAffected: 0,
                errors: [error.message || 'Unknown error'],
            };
        }
    }
}
