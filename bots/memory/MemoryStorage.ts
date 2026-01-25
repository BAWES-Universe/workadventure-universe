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
    startAutoSave(saveCallback: () => BotPlayerMemory[]): void {
        if (!this.isConfigured()) {
            console.warn('[MemoryStorage] Admin API not configured, auto-save disabled');
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

        console.log(`[MemoryStorage] Auto-save started (interval: ${this.saveInterval}ms)`);
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
            console.warn('[MemoryStorage] botId is required');
            return;
        }

        // Use BOT_SERVICE_TOKEN for bot endpoints (preferred), fallback to ADMIN_API_TOKEN
        const authToken = this.botServiceToken || this.adminApiToken;
        if (!authToken) {
            console.warn('[MemoryStorage] No authentication token available');
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
                        console.log(`  - conversationHistory: ${mem.conversationHistory?.length || 0} messages`);
                        console.log(`  - personalInfo.name: ${mem.personalInfo?.name || 'not set'}`);
                        console.log(`  - personalInfo.birthday: ${mem.personalInfo?.birthday || 'not set'}`);
                        console.log(`  - personalInfo.facts: ${mem.personalInfo?.facts?.length || 0} facts`);
                        console.log(`  - relationship.totalConversations: ${mem.relationship?.totalConversations || 0}`);
                        console.log(`  - relationship.importantEvents: ${mem.relationship?.importantEvents?.length || 0} events`);
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
            console.warn('[MemoryStorage] No authentication token available');
            return [];
        }

        try {
            const response = await axios.get(
                `${this.adminApiUrl}/api/bots/memory/${botId}`,
                {
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                    },
                }
            );

            if (response.data && response.data.memories) {
                return response.data.memories.map((mem: any) => this.deserializeMemory(mem));
            }

            return [];
        } catch (error: any) {
            if (error.response?.status === 404) {
                // No memories yet, that's okay
                return [];
            }
            console.error('[MemoryStorage] Error loading memories:', error);
            return [];
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
     */
    private serializeMemory(memory: BotPlayerMemory): any {
        return {
            ...memory,
            personalInfo: {
                ...memory.personalInfo,
                facts: Array.from(memory.personalInfo.facts.entries()),
            },
        };
    }

    /**
     * Deserialize memory from storage (convert objects back to Maps)
     */
    private deserializeMemory(data: any): BotPlayerMemory {
        return {
            ...data,
            personalInfo: {
                ...data.personalInfo,
                facts: new Map(data.personalInfo.facts || []),
            },
            emotions: {
                ...data.emotions,
                lastEmotionUpdate: data.emotions.lastEmotionUpdate || Date.now(),
            },
        };
    }

}

