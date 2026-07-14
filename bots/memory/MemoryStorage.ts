/**
 * MemoryStorage - Persists conversation memory to Admin API
 * 
 * Handles saving and loading conversation memories to/from Admin API
 * for persistence across bot restarts.
 */

import type { BotPlayerMemory } from './ConversationMemory';
import axios from 'axios';

export interface MemoryStorageConfig {
    adminApiUrl?: string;
    adminApiToken?: string;
    botServiceToken?: string; // Use BOT_SERVICE_TOKEN for bot endpoints
    saveInterval: number; // Save interval in milliseconds (default: 5 minutes)
    maxRetries: number;
}

export class MemoryStorage {
    private adminApiUrl?: string;
    private adminApiToken?: string;
    private botServiceToken?: string;
    private saveInterval: number;
    private maxRetries: number;
    private saveTimer: NodeJS.Timeout | null = null;

    constructor(config: MemoryStorageConfig) {
        this.adminApiUrl = config.adminApiUrl || process.env.ADMIN_API_URL;
        this.adminApiToken = config.adminApiToken || process.env.ADMIN_API_TOKEN;
        this.botServiceToken = config.botServiceToken || process.env.BOT_SERVICE_TOKEN;
        this.saveInterval = config.saveInterval || 5 * 60 * 1000; // 5 minutes
        this.maxRetries = config.maxRetries || 3;
    }

    /**
     * Check if storage is configured
     */
    isConfigured(): boolean {
        return !!(this.adminApiUrl && (this.botServiceToken || this.adminApiToken));
    }

    /**
     * Start periodic saving
     */
    startAutoSave(saveCallback: () => { botId: string; memories: BotPlayerMemory[] }): void {
        if (!this.isConfigured()) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[MemoryStorage] Admin API not configured, auto-save disabled');
            }
            return;
        }

        if (this.saveTimer) {
            clearInterval(this.saveTimer);
        }

        this.saveTimer = setInterval(async () => {
            const { botId, memories } = saveCallback();
            if (memories.length > 0) {
                await this.saveMemories(botId, memories);
            }
        }, this.saveInterval);

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[MemoryStorage] Auto-save started (interval: ${this.saveInterval}ms)`);
        }
    }

    /**
     * Stop periodic saving
     */
    stopAutoSave(): void {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
    }

    /**
     * Save memories for a bot
     * @param saveType - "immediate" for emotion-only updates, "periodic" for full memory saves
     */
    async saveMemories(botId: string, memories: BotPlayerMemory[], saveType: 'immediate' | 'periodic' = 'periodic'): Promise<void> {
        if (!this.isConfigured() || memories.length === 0) {
            return;
        }

        if (!botId) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[MemoryStorage] botId is required');
            }
            return;
        }

        // Use BOT_SERVICE_TOKEN for bot endpoints (preferred), fallback to ADMIN_API_TOKEN
        const authToken = this.botServiceToken || this.adminApiToken;
        if (!authToken) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[MemoryStorage] No authentication token available');
            }
            return;
        }

        let retries = 0;
        while (retries < this.maxRetries) {
            try {
                const serializedMemories = memories.map(mem => this.serializeMemory(mem));
                
                // Debug: Log what we're sending (dev only)
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    for (const mem of serializedMemories) {
                        console.log(`[MemoryStorage] Saving memory for userUuid=${mem.userUuid}, saveType=${saveType}:`);
                        console.log(`  - memories.conversationHistory: ${mem.memories?.conversationHistory?.length || 0} messages`);
                        console.log(`  - memories.personalInfo.name: ${mem.memories?.personalInfo?.name || 'not set'}`);
                        console.log(`  - memories.personalInfo.birthday: ${mem.memories?.personalInfo?.birthday || 'not set'}`);
                        console.log(`  - memories.personalInfo.facts: ${mem.memories?.personalInfo?.facts?.length || 0} facts`);
                        console.log(`  - memories.relationship.totalConversations: ${mem.memories?.relationship?.totalConversations || 0}`);
                        console.log(`  - memories.relationship.importantEvents: ${mem.memories?.relationship?.importantEvents?.length || 0} events`);
                        console.log(`  - emotions: ${mem.emotions ? 'present' : 'missing'}`);
                    }
                }
                
                await axios.post(
                    `${this.adminApiUrl}/api/bots/memory/${botId}`,
                    {
                        memories: serializedMemories,
                        timestamp: Date.now(),
                        saveType: saveType, // "immediate" for emotions, "periodic" for full saves
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${authToken}`,
                            'Content-Type': 'application/json',
                        },
                    }
                );
                return; // Success
            } catch (error: any) {
                retries++;
                if (retries >= this.maxRetries) {
                    // Always log critical errors (max retries exceeded)
                    console.error(`[MemoryStorage] Failed to save memories after ${this.maxRetries} retries:`, error);
                    // Don't throw - memory persistence shouldn't break bot functionality
                } else {
                    // Wait before retry (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, 1000 * retries));
                }
            }
        }
    }

    /**
     * Load memories for a bot
     */
    async loadMemories(botId: string): Promise<BotPlayerMemory[]> {
        if (!this.isConfigured()) {
            return [];
        }

        // Use BOT_SERVICE_TOKEN for bot endpoints (preferred), fallback to ADMIN_API_TOKEN
        const authToken = this.botServiceToken || this.adminApiToken;
        if (!authToken) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[MemoryStorage] No authentication token available');
            }
            return [];
        }

        const url = `${this.adminApiUrl}/api/bots/memory/${botId}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[MemoryStorage] Admin API response for bot ${botId}: status=${response.status}, hasMemories=${!!response.data?.memories}, count=${response.data?.memories?.length || 0}`);
            }

            if (response.data && response.data.memories) {
                const deserialized = response.data.memories.map((mem: any) => this.deserializeMemory(mem));
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    const uuids = deserialized.map(m => m.userUuid).filter(Boolean);
                    console.log(`[MemoryStorage] Loaded ${deserialized.length} memories for bot ${botId}: uuids=[${uuids.join(', ')}]`);
                }
                return deserialized;
            }

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[MemoryStorage] Admin API returned no memories data for bot ${botId}:`, response.data ? JSON.stringify(response.data).substring(0, 200) : 'empty body');
            }

            return [];
        } catch (error: any) {
            if (error.response?.status === 404) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[MemoryStorage] Admin API returned 404 for bot ${botId} (no memories yet)`);
                }
                return [];
            }
            if (error.response?.status === 405) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn('[MemoryStorage] Admin API returned 405 - endpoint may not be available');
                }
                return [];
            }
            if (error.response) {
                console.error(`[MemoryStorage] Admin API error loading memories for bot ${botId}: status=${error.response.status}, body=${JSON.stringify(error.response.data || '')}`);
            } else {
                console.error('[MemoryStorage] Error loading memories:', error.message);
            }
            throw error;
        }
    }

    /**
     * Save a single memory update (for immediate persistence)
     * @param saveType - "immediate" for emotion-only updates, "periodic" for full memory saves
     */
    async saveMemory(botId: string, memory: BotPlayerMemory, saveType: 'immediate' | 'periodic' = 'periodic'): Promise<void> {
        await this.saveMemories(botId, [memory], saveType);
    }

    /**
     * Serialize memory for storage (convert Maps to objects)
     * Admin API expects nested structure: { userUuid, memories: {...}, emotions: {...} }
     */
    private serializeMemory(memory: BotPlayerMemory): any {
        return {
            // Top-level identification
            userUuid: memory.userUuid,
            userId: memory.userId,
            userName: memory.playerName,
            isGuest: memory.isGuest,
            pendingMedia: memory.pendingMedia || [],
            pendingAutoSend: memory.pendingAutoSend || [],
            maxPendingMedia: memory.maxPendingMedia ?? 5,
            
            // Nested memories object (what Admin API looks for)
            memories: {
                personalInfo: {
                    ...memory.personalInfo,
                    facts: Array.from(memory.personalInfo.facts.entries()),
                },
                relationship: memory.relationship,
                conversationHistory: memory.conversationHistory,
                lastUpdated: memory.lastUpdated,
                createdAt: memory.createdAt,
            },
            
            // Emotions at top level (matches Admin API expectation)
            emotions: memory.emotions,
            lastEmotionUpdate: memory.emotions.lastEmotionUpdate,
        };
    }

    /**
     * Deserialize memory from storage (convert objects back to Maps)
     * Handles both nested format (from Admin API) and flat format (legacy)
     */
    private deserializeMemory(data: any): BotPlayerMemory {
        // Handle nested format from Admin API: { userUuid, memories: {...}, emotions: {...} }
        const memoryData = data.memories || data; // Use nested memories if present, otherwise assume flat
        const emotions = data.emotions || memoryData.emotions;
        const personalInfo = memoryData.personalInfo || {};
        
        return {
            userUuid: data.userUuid || memoryData.userUuid || '',
            userId: data.userId || memoryData.userId,
            isGuest: data.isGuest ?? memoryData.isGuest ?? true,
            playerId: memoryData.playerId || 0,
            playerName: data.userName || memoryData.playerName,
            conversationHistory: memoryData.conversationHistory || [],
            maxHistorySize: memoryData.maxHistorySize || 50,
            pendingMedia: data.pendingMedia || memoryData.pendingMedia || [],
            pendingAutoSend: memoryData.pendingAutoSend || [],
            maxPendingMedia: data.maxPendingMedia ?? memoryData.maxPendingMedia ?? 5,
            personalInfo: {
                ...personalInfo,
                facts: new Map(personalInfo.facts || []),
            },
            relationship: memoryData.relationship || {
                firstMet: Date.now(),
                lastMet: Date.now(),
                totalConversations: 0,
                totalMessages: 0,
                importantEvents: [],
            },
            emotions: {
                botEmotion: emotions?.botEmotion || { anger: 0, happiness: 50, trust: 50, familiarity: 0 },
                personEmotion: emotions?.personEmotion || { anger: 0, happiness: 50, trust: 50 },
                wounds: emotions?.wounds || [],
                recentSentiment: emotions?.recentSentiment || 0,
                lastEmotionUpdate: emotions?.lastEmotionUpdate || data.lastEmotionUpdate || Date.now(),
            },
            lastUpdated: memoryData.lastUpdated || Date.now(),
            createdAt: memoryData.createdAt || Date.now(),
        };
    }

}

