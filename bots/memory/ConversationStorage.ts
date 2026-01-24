/**
 * ConversationStorage - Real-time conversation storage with Admin API deduplication
 * 
 * Features:
 * - Immediate conversation creation and updates (no duplicates)
 * - Tracks conversation IDs from Admin API
 * - Uses POST (create) then PUT (update) pattern
 * - Real-time visibility in Admin API 
 * - Support for conversation lifecycle (active/completed)
 * - Store essential data: botId, userUuid, messages array, timestamps
 * - Uses userUuid (WorkAdventure UUID) as primary identifier
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
    endReason?: 'user_left' | 'bot_restart' | 'manual' | 'timeout'; // Why conversation ended
    createdAt?: number;
}

export interface ConversationCreateResponse {
    conversationId: string;
    status: 'created' | 'updated';
}

export interface ConversationUpdateResponse {
    status: 'updated';
}

export interface ConversationQuery {
    botId: string;
    limit?: number;
    offset?: number;
    userId?: string; // Query by userUuid or userId
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
    private activeConversations: Map<string, ConversationRecord> = new Map(); // key: "botId_userUuid"
    private conversationIds: Map<string, string> = new Map(); // key: "botId_userUuid" → conversationId
    private creationLocks: Map<string, Promise<void>> = new Map(); // Prevent concurrent conversation creation

    constructor(adminApiService: AdminApiService) {
        this.adminApiService = adminApiService;
    }

    /**
     * Start tracking a conversation (prepare for first message)
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
        // Use provided UUID or the passed userUuid
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
            endedAt: now, // Active conversation: endedAt = startedAt
            messageCount: 0,
        });
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[ConversationStorage] Started conversation: botId=${botId}, userUuid=${finalUserUuid}, userName=${userInfo?.name}, isGuest=${isGuest}`);
        }
    }

    /**
     * Add a message to an active conversation (immediate save to Admin API)
     * @param userUuid - REQUIRED - User UUID (string) - WorkAdventure UUID
     */
    async addMessage(
        botId: string,
        userUuid: string,
        message: string,
        sender: 'bot' | 'person'
    ): Promise<void> {
        const key = `${botId}_${userUuid}`;
        let conversation = this.activeConversations.get(key);

        if (!conversation) {
            // Start conversation if it doesn't exist
            this.startConversation(botId, userUuid);
            conversation = this.activeConversations.get(key);
            if (!conversation) {
                console.error(`[ConversationStorage] Failed to create conversation for botId=${botId}, userUuid=${userUuid}`);
                return;
            }
        }

        // Add message to local conversation
        const now = Date.now();
        conversation.messages.push({
            sender,
            message,
            timestamp: now,
        });
        conversation.messageCount++;
        conversation.endedAt = now; // Keep as active (endedAt = startedAt for active conversations)

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[ConversationStorage] Added ${sender} message to conversation: botId=${botId}, userUuid=${userUuid}, totalMessages=${conversation.messageCount}`);
        }

        // Immediately save to Admin API
        await this.saveToAdminAPI(key, conversation);
    }

    /**
     * Save conversation to Admin API (handles race conditions)
     */
    private async saveToAdminAPI(key: string, conversation: ConversationRecord): Promise<void> {
        let conversationId = this.conversationIds.get(key);
        
        if (!conversationId) {
            // Check if another call is already creating this conversation
            const existingCreation = this.creationLocks.get(key);
            if (existingCreation) {
                // Wait for the other call to finish creating
                await existingCreation;
                // Try to get the conversationId that was created
                conversationId = this.conversationIds.get(key);
            }
            
            // If still no conversationId, create it ourselves
            if (!conversationId) {
                const creationPromise = this.createConversation(key, conversation);
                this.creationLocks.set(key, creationPromise);
                
                try {
                    await creationPromise;
                } finally {
                    // Always clean up the lock
                    this.creationLocks.delete(key);
                }
                
                conversationId = this.conversationIds.get(key);
            }
        }
        
        // Now update the conversation if we have an ID
        if (conversationId) {
            await this.updateConversation(conversationId, conversation);
        }
    }

    /**
     * Create a new conversation in Admin API (first message)
     */
    private async createConversation(key: string, conversation: ConversationRecord): Promise<void> {
        if (!this.adminApiService.isConfigured()) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[ConversationStorage] Admin API not configured, skipping conversation creation');
            }
            return;
        }

        const adminApiUrl = this.adminApiService['adminApiUrl'] || process.env.ADMIN_API_URL;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;

        if (!adminApiUrl || !botServiceToken) {
            return;
        }

        try {
            const response = await axios.post<ConversationCreateResponse>(
                `${adminApiUrl}/api/bots/${conversation.botId}/conversations`,
                conversation,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            // Store conversation ID for future updates
            this.conversationIds.set(key, response.data.conversationId);

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[ConversationStorage] Created conversation: botId=${conversation.botId}, userUuid=${conversation.userUuid}, conversationId=${response.data.conversationId}, status=${response.data.status}`);
            }
        } catch (error: any) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[ConversationStorage] Error creating conversation:', error);
            }
        }
    }

    /**
     * Update an existing conversation in Admin API
     */
    private async updateConversation(conversationId: string, conversation: ConversationRecord): Promise<void> {
        if (!this.adminApiService.isConfigured()) {
            return;
        }

        const adminApiUrl = this.adminApiService['adminApiUrl'] || process.env.ADMIN_API_URL;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;

        if (!adminApiUrl || !botServiceToken) {
            return;
        }

        try {
            await axios.put<ConversationUpdateResponse>(
                `${adminApiUrl}/api/bots/${conversation.botId}/conversations/${conversationId}`,
                conversation,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[ConversationStorage] Updated conversation: conversationId=${conversationId}, messages=${conversation.messageCount}`);
            }
        } catch (error: any) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error(`[ConversationStorage] Error updating conversation ${conversationId}:`, error);
            }
        }
    }

    /**
     * End a conversation and mark as completed
     * @param userUuid - REQUIRED - User UUID (string) - WorkAdventure UUID
     * @param endReason - Why the conversation ended
     */
    async endConversation(botId: string, userUuid: string, endReason: 'user_left' | 'bot_restart' | 'manual' | 'timeout' = 'manual'): Promise<void> {
        const key = `${botId}_${userUuid}`;
        const conversation = this.activeConversations.get(key);
        const conversationId = this.conversationIds.get(key);

        if (!conversation || !conversationId) {
            // Clean up if no active conversation
            this.activeConversations.delete(key);
            this.conversationIds.delete(key);
            return;
        }

        // Mark conversation as completed (endedAt > startedAt)
        conversation.endedAt = Date.now();
        conversation.endReason = endReason;

        // Final update to Admin API
        await this.updateConversation(conversationId, conversation);

        // Clean up local tracking
        this.activeConversations.delete(key);
        this.conversationIds.delete(key);

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[ConversationStorage] Ended conversation: conversationId=${conversationId}, reason=${endReason}`);
        }
    }

    /**
     * Cleanup method - end all active conversations
     */
    async cleanup(): Promise<void> {
        // Wait for any pending creations to complete
        const pendingCreations = Array.from(this.creationLocks.values());
        if (pendingCreations.length > 0) {
            await Promise.all(pendingCreations);
        }
        
        // End all active conversations with bot_restart reason
        const endPromises: Promise<void>[] = [];
        
        for (const [key, conversation] of this.activeConversations) {
            if (conversation.messages.length > 0) {
                const [botId, userUuid] = key.split('_', 2);
                endPromises.push(this.endConversation(botId, userUuid, 'bot_restart'));
            }
        }

        // Wait for all conversations to end
        await Promise.all(endPromises);

        // Clear all maps
        this.creationLocks.clear();

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[ConversationStorage] Cleanup completed, ended ${endPromises.length} conversations`);
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
