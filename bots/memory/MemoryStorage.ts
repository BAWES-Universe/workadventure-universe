/**
 * MemoryStorage - Persists conversation memory to Admin API
 * 
 * Handles saving and loading conversation memories to/from Admin API
 * for persistence across bot restarts.
 */

import type { BotPlayerMemory } from './ConversationMemory';
import axios from 'axios';
import { parseForgetNotice, parseItemForgets, type ItemForgetHandler, type MemoryForgetHandler } from './ForgetNotice';

export type { MemoryForgetNotice, MemoryForgetHandler, ItemForgetNotice, ItemForgetHandler } from './ForgetNotice';

/** Answers from Orbit that no retry will change. A busy or unreachable Orbit, a refused token, or an Orbit that does not have the route yet (400, 404) is tried again. */
const PERMANENT_REFUSALS = new Set([410, 422]);

/** A failed save in words, without the request it carried. */
function describeSaveError(error: unknown): string {
    if (axios.isAxiosError(error)) {
        return error.response ? `status=${error.response.status} ${error.message}` : `${error.code || 'no response'} ${error.message}`;
    }
    return error instanceof Error ? error.message : 'unknown error';
}

/** Said once per process: the bot server cannot save or load what bots remember without its own service token */
let warnedNoServiceToken = false;

export interface MemoryStorageConfig {
    adminApiUrl?: string;
    /** The bot server's own token for the memory endpoints. The deployment admin token is not used for memory (#444). */
    botServiceToken?: string;
    saveInterval: number; // Save interval in milliseconds (default: 5 minutes)
    maxRetries: number;
}

export class MemoryStorage {
    private adminApiUrl?: string;
    private botServiceToken?: string;
    private saveInterval: number;
    private maxRetries: number;
    private saveTimer: NodeJS.Timeout | null = null;
    private forgetHandler: MemoryForgetHandler | null = null;
    private itemForgetHandler: ItemForgetHandler | null = null;

    constructor(config: MemoryStorageConfig) {
        this.adminApiUrl = config.adminApiUrl || process.env.ADMIN_API_URL;
        this.botServiceToken = config.botServiceToken || process.env.BOT_SERVICE_TOKEN;
        this.saveInterval = config.saveInterval || 5 * 60 * 1000; // 5 minutes
        this.maxRetries = config.maxRetries || 3;
    }

    /** Called when a save is answered with things a person forgot (#2003). */
    setItemForgetHandler(handler: ItemForgetHandler | null): void {
        this.itemForgetHandler = handler;
    }

    /** Called when a save is answered with people to forget. */
    setForgetHandler(handler: MemoryForgetHandler | null): void {
        this.forgetHandler = handler;
    }

    /**
     * Check if storage is configured
     */
    isConfigured(): boolean {
        if (this.adminApiUrl && !this.botServiceToken) {
            // No quiet fallback to the admin token (#444): without BOT_SERVICE_TOKEN what bots remember is neither
            // saved nor loaded, so say so where it can be seen
            if (!warnedNoServiceToken) {
                warnedNoServiceToken = true;
                console.error('[MemoryStorage] BOT_SERVICE_TOKEN is not set: bot memory is not saved or loaded. Set it on the bot server and on Orbit.');
            }
            return false;
        }
        return !!(this.adminApiUrl && this.botServiceToken);
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

        const authToken = this.botServiceToken;
        if (!authToken) return;

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
                
                const response = await axios.post(
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
                this.applyForgetNotice(botId, response?.data?.forget);
                this.applyItemForgets(botId, response?.data?.forgetItems);
                return; // Success
            } catch (error: any) {
                retries++;
                if (retries >= this.maxRetries) {
                    // Always log critical errors (max retries exceeded)
                    // Status and message only: the error also carries the request, and that is what the bot remembers
                    // (facts, recent messages). Error lines go to Sentry, private bots' too (#1166).
                    console.error(`[MemoryStorage] Failed to save memories for bot ${botId} after ${this.maxRetries} retries: ${describeSaveError(error)}`);
                    // Don't throw - memory persistence shouldn't break bot functionality
                } else {
                    // Wait before retry (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, 1000 * retries));
                }
            }
        }
    }

    /**
     * Tell Orbit these Forgets are dropped from memory, by row id. Orbit keeps a Forget, and keeps skipping that person
     * in saves, until it hears this (#493). True when Orbit took it. A report that fails is not retried here: Orbit
     * keeps sending the Forget, and the next answer that carries it reports again.
     */
    async acknowledgeForgets(botId: string, ids: string[]): Promise<boolean> {
        if (!this.isConfigured() || !this.botServiceToken || !botId || ids.length === 0) return false;
        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/memory/${encodeURIComponent(botId)}/forgotten`,
                { ids },
                { headers: { Authorization: `Bearer ${this.botServiceToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
            );
            return true;
        } catch (error) {
            // An Orbit that does not have the route yet answers 404 or 405: it deletes by time as before, nothing to say
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            if (status !== 404 && status !== 405) {
                console.warn(`[MemoryStorage] Could not report forgotten memories for bot ${botId}: ${describeSaveError(error)}`);
            }
            return false;
        }
    }

    /**
     * Tell Orbit these things are dropped from memory, by Forget id (#2003). Orbit keeps sending a Forget until it hears
     * this; the Forget itself stays, so a restored row cannot bring the thing back. True when Orbit took it.
     */
    async acknowledgeItemForgets(botId: string, itemIds: string[]): Promise<boolean> {
        if (!this.isConfigured() || !this.botServiceToken || !botId || itemIds.length === 0) return false;
        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/memory/${encodeURIComponent(botId)}/forgotten`,
                { itemIds },
                { headers: { Authorization: `Bearer ${this.botServiceToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
            );
            return true;
        } catch (error) {
            console.warn(`[MemoryStorage] Could not report forgotten things for bot ${botId}: ${describeSaveError(error)}`);
            return false;
        }
    }

    /**
     * Tell Orbit one thing a person asked this bot to forget in the chat ("forget that"), by its key. Orbit keeps it as
     * forgotten whether or not it has saved the thing yet. True when Orbit took it, or when it never can (no Orbit set up).
     */
    async reportForgottenItem(botId: string, userUuid: string, itemKey: string, kind: string, at?: number): Promise<boolean> {
        // No Orbit to tell, or nothing to name: this never changes, so there is nothing to try again later (not a failure)
        if (!this.isConfigured() || !this.botServiceToken || !botId || !userUuid || !itemKey) return true;
        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/memory/${encodeURIComponent(botId)}/items`,
                { userUuid, itemKey, kind, ...(at ? { at } : {}) },
                { headers: { Authorization: `Bearer ${this.botServiceToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
            );
            return true;
        } catch (error) {
            console.warn(`[MemoryStorage] Could not tell Orbit what was forgotten for bot ${botId}: ${describeSaveError(error)}`);
            // Orbit answered that this can never be taken (gone, or cannot be processed): telling it again changes nothing, so it is let go
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            return status !== undefined && PERMANENT_REFUSALS.has(status);
        }
    }

    private applyItemForgets(botId: string, forgetItems: unknown): void {
        const items = parseItemForgets(forgetItems);
        if (!this.itemForgetHandler || items.length === 0) return;
        try {
            this.itemForgetHandler(botId, items);
        } catch (error) {
            console.error('[MemoryStorage] Could not drop forgotten things:', error);
        }
    }

    /**
     * Pass on who Orbit asked us to forget. A handler that fails must never turn a save that worked into a retry.
     */
    private applyForgetNotice(botId: string, forget: unknown): void {
        const notice = parseForgetNotice(forget);
        if (!this.forgetHandler || !notice) return;
        try {
            this.forgetHandler(botId, notice);
        } catch (error) {
            console.error('[MemoryStorage] Could not drop forgotten memories:', error);
        }
    }

    /**
     * Load memories for a bot
     */
    async loadMemories(botId: string): Promise<BotPlayerMemory[]> {
        if (!this.isConfigured()) {
            return [];
        }

        const authToken = this.botServiceToken;
        if (!authToken) return [];

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

