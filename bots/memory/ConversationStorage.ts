/**
 * ConversationStorage - Stores recent conversations in production for admin viewing
 * 
 * Features:
 * - Store recent conversations (no automatic cleanup)
 * - Manual admin control only
 * - Store essential data: botId, playerId, messages array, timestamps
 * - Support querying by bot, player, date range
 * - Track conversation metadata (start time, end time, message count)
 */

import { AdminApiService } from '../server/AdminApiService';
import axios from 'axios';

export interface ConversationMessage {
    sender: 'bot' | 'person';
    message: string;
    timestamp: number;
}

export interface ConversationRecord {
    id?: number;
    botId: string;
    playerId: number;
    playerName?: string;
    messages: ConversationMessage[];
    startedAt: number;
    endedAt: number;
    messageCount: number;
    createdAt?: number;
}

export interface ConversationQuery {
    botId: string;
    limit?: number;
    offset?: number;
    playerId?: number;
    startDate?: number;
    endDate?: number;
}

export interface ConversationStats {
    botId: string;
    totalConversations: number;
    oldestConversation?: number;
    newestConversation?: number;
    totalSize?: number; // Approximate size in bytes
}

export class ConversationStorage {
    private adminApiService: AdminApiService;
    private activeConversations: Map<string, ConversationRecord> = new Map(); // key: "botId_playerId"

    constructor(adminApiService: AdminApiService) {
        this.adminApiService = adminApiService;
    }

    /**
     * Start tracking a conversation
     */
    startConversation(botId: string, playerId: number, playerName?: string): void {
        const key = `${botId}_${playerId}`;
        
        // Don't overwrite existing conversation
        if (this.activeConversations.has(key)) {
            return;
        }

        const now = Date.now();
        this.activeConversations.set(key, {
            botId,
            playerId,
            playerName,
            messages: [],
            startedAt: now,
            endedAt: now,
            messageCount: 0,
        });
    }

    /**
     * Add a message to an active conversation
     */
    addMessage(
        botId: string,
        playerId: number,
        message: string,
        sender: 'bot' | 'person'
    ): void {
        const key = `${botId}_${playerId}`;
        const conversation = this.activeConversations.get(key);

        if (!conversation) {
            // Start conversation if it doesn't exist
            this.startConversation(botId, playerId);
            const newConversation = this.activeConversations.get(key);
            if (newConversation) {
                newConversation.messages.push({
                    sender,
                    message,
                    timestamp: Date.now(),
                });
                newConversation.messageCount++;
                newConversation.endedAt = Date.now();
            }
            return;
        }

        conversation.messages.push({
            sender,
            message,
            timestamp: Date.now(),
        });
        conversation.messageCount++;
        conversation.endedAt = Date.now();
    }

    /**
     * End a conversation and store it
     */
    async endConversation(botId: string, playerId: number): Promise<void> {
        const key = `${botId}_${playerId}`;
        const conversation = this.activeConversations.get(key);

        if (!conversation || conversation.messages.length === 0) {
            // No conversation to store
            this.activeConversations.delete(key);
            return;
        }

        conversation.endedAt = Date.now();

        // Store conversation (non-blocking)
        this.storeConversation(conversation).catch(error => {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error(`[ConversationStorage] Error storing conversation:`, error);
            }
        });

        // Remove from active conversations
        this.activeConversations.delete(key);
    }

    /**
     * Store conversation to Admin API
     */
    private async storeConversation(conversation: ConversationRecord): Promise<void> {
        if (!this.adminApiService.isConfigured()) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[ConversationStorage] Admin API not configured, skipping conversation storage');
            }
            return;
        }

        const adminApiUrl = this.adminApiService['adminApiUrl'] || process.env.ADMIN_API_URL;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;

        if (!adminApiUrl || !botServiceToken) {
            return;
        }

        try {
            await axios.post(
                `${adminApiUrl}/api/bots/${conversation.botId}/conversations`,
                conversation,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[ConversationStorage] Stored conversation for bot ${conversation.botId}, player ${conversation.playerId}`);
            }
        } catch (error: any) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[ConversationStorage] Error storing conversation:', error);
            }
        }
    }

    /**
     * Get conversations from Admin API
     */
    async getConversations(query: ConversationQuery): Promise<ConversationRecord[]> {
        if (!this.adminApiService.isConfigured()) {
            return [];
        }

        const adminApiUrl = this.adminApiService['adminApiUrl'] || process.env.ADMIN_API_URL;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;

        if (!adminApiUrl || !botServiceToken) {
            return [];
        }

        try {
            const params: Record<string, any> = {};
            if (query.limit) params.limit = query.limit;
            if (query.offset) params.offset = query.offset;
            if (query.playerId) params.playerId = query.playerId;
            if (query.startDate) params.startDate = query.startDate;
            if (query.endDate) params.endDate = query.endDate;

            const response = await axios.get(
                `${adminApiUrl}/api/bots/${query.botId}/conversations`,
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
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[ConversationStorage] Error getting conversations:', error);
            }
            return [];
        }
    }

    /**
     * Get conversation statistics
     */
    async getConversationStats(botId: string): Promise<ConversationStats> {
        if (!this.adminApiService.isConfigured()) {
            return { botId, totalConversations: 0 };
        }

        const adminApiUrl = this.adminApiService['adminApiUrl'] || process.env.ADMIN_API_URL;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;

        if (!adminApiUrl || !botServiceToken) {
            return { botId, totalConversations: 0 };
        }

        try {
            const response = await axios.get(
                `${adminApiUrl}/api/bots/${botId}/conversations/stats`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                }
            );

            return response.data || { botId, totalConversations: 0 };
        } catch (error: any) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[ConversationStorage] Error getting conversation stats:', error);
            }
            return { botId, totalConversations: 0 };
        }
    }
}
