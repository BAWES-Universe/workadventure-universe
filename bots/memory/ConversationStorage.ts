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
    userUuid: string; // REQUIRED - WorkAdventure UUID (ephemeral for guests) - primary identifier
    userId?: string; // Optional - Foreign key to User.id (only set if authenticated) - Admin API will set this
    userName?: string; // Optional - Display name (from request or User.name)
    isGuest?: boolean; // Optional - true if unauthenticated (defaults to true)
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
    userId?: string; // Changed from playerId: number
    startDate?: number;
    endDate?: number;
    // Backward compatibility
    /** @deprecated Use userId instead */
    playerId?: number;
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
     * @param userUuid - REQUIRED - WorkAdventure UUID (string) - primary identifier
     * @param userInfo - Optional user information (name, uuid, isLogged)
     * Note: userId (User.id) will be set by Admin API when storing if user is authenticated
     */
    startConversation(
        botId: string, 
        userUuid: string, 
        userInfo?: {
            name?: string;
            uuid?: string;
            isLogged?: boolean;
        }
    ): void {
        // Use provided UUID or fallback to the passed userUuid
        const finalUserUuid = userInfo?.uuid || userUuid;
        const key = `${botId}_${finalUserUuid}`;
        
        // Don't overwrite existing conversation
        if (this.activeConversations.has(key)) {
            return;
        }

        const now = Date.now();
        const isGuest = userInfo?.isLogged === undefined ? true : !userInfo.isLogged;
        this.activeConversations.set(key, {
            botId,
            userUuid: finalUserUuid, // REQUIRED
            userId: undefined, // Will be set by Admin API if user is authenticated
            userName: userInfo?.name,
            isGuest: isGuest,
            messages: [],
            startedAt: now,
            endedAt: now,
            messageCount: 0,
        });
    }

    /**
     * Add a message to an active conversation
     * @param userUuid - REQUIRED - User UUID (string) - WorkAdventure UUID
     */
    addMessage(
        botId: string,
        userUuid: string,
        message: string,
        sender: 'bot' | 'person'
    ): void {
        const key = `${botId}_${userUuid}`;
        const conversation = this.activeConversations.get(key);

        if (!conversation) {
            // Start conversation if it doesn't exist (userUuid is required)
            this.startConversation(botId, userUuid);
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
     * @param userUuid - REQUIRED - User UUID (string) - WorkAdventure UUID
     */
    async endConversation(botId: string, userUuid: string): Promise<void> {
        const key = `${botId}_${userUuid}`;
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
                console.log(`[ConversationStorage] Stored conversation for bot ${conversation.botId}, userUuid ${conversation.userUuid}`);
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
            if (query.userId) params.userId = query.userId;
            // Backward compatibility
            if (query.playerId) params.userId = String(query.playerId);
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
