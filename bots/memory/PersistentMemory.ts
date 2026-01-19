/**
 * PersistentMemory - Extends ConversationMemory with immediate emotion persistence and debounced saves
 * 
 * Features:
 * - Immediate persistence on emotion changes
 * - Debounced saves for conversation history
 * - Track conversation purposes
 * - AI-driven emotion updates (via EmotionAnalyzer)
 */

import { ConversationMemory, type BotPlayerMemory, type EmotionalState } from './ConversationMemory';
import { MemoryStorage } from './MemoryStorage';
import type { EmotionAnalyzer } from './EmotionAnalyzer';

export type ConversationPurpose = 'navigation' | 'information' | 'social' | 'support' | 'entertainment' | 'unknown';

export interface PersistentMemoryConfig {
    maxHistorySize?: number;
    maxMemories?: number;
    adminApiUrl?: string;
    adminApiToken?: string;
    debounceInterval?: number; // Debounce interval for conversation history saves (default: 30 seconds)
    immediateSaveEnabled?: boolean; // Whether to immediately save emotion changes (default: true)
}

export class PersistentMemory extends ConversationMemory {
    private memoryStorage: MemoryStorage;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map(); // key: "botId_playerId"
    private debounceInterval: number;
    private immediateSaveEnabled: boolean;
    private pendingSaves: Map<string, BotPlayerMemory> = new Map(); // key: "botId_playerId"
    private emotionAnalyzer: EmotionAnalyzer | null = null;

    constructor(config: PersistentMemoryConfig = {}) {
        super(config.maxHistorySize || 50, config.maxMemories || 1000);
        
        this.debounceInterval = config.debounceInterval || 30000; // 30 seconds
        this.immediateSaveEnabled = config.immediateSaveEnabled !== false; // Default: true
        
        // Initialize memory storage
        this.memoryStorage = new MemoryStorage({
            adminApiUrl: config.adminApiUrl,
            adminApiToken: config.adminApiToken,
            botServiceToken: process.env.BOT_SERVICE_TOKEN, // Use BOT_SERVICE_TOKEN for bot endpoints
            saveInterval: 5 * 60 * 1000, // 5 minutes (not used for debounced saves)
            maxRetries: 3,
        });
    }

    /**
     * Set emotion analyzer (called by BotManager)
     */
    setEmotionAnalyzer(emotionAnalyzer: EmotionAnalyzer): void {
        this.emotionAnalyzer = emotionAnalyzer;
    }

    /**
     * Override addMessage to add debounced save, immediate emotion save, and AI analysis
     */
    addMessage(
        botId: string,
        playerId: number,
        message: string,
        sender: 'bot' | 'person',
        spaceName?: string
    ): void {
        // Get emotions before update
        const memory = this.getOrCreateMemory(botId, playerId);
        const oldEmotions = {
            personAnger: memory.emotions.personEmotion.anger,
            personHappiness: memory.emotions.personEmotion.happiness,
            botAnger: memory.emotions.botEmotion.anger,
            botHappiness: memory.emotions.botEmotion.happiness,
        };

        // Call parent implementation (updates emotions via keywords)
        super.addMessage(botId, playerId, message, sender, spaceName);

        // Get updated emotions
        const updatedMemory = this.getOrCreateMemory(botId, playerId);
        const newEmotions = updatedMemory.emotions;

        // If emotions changed, trigger immediate save
        if (
            oldEmotions.personAnger !== newEmotions.personEmotion.anger ||
            oldEmotions.personHappiness !== newEmotions.personEmotion.happiness ||
            oldEmotions.botAnger !== newEmotions.botEmotion.anger ||
            oldEmotions.botHappiness !== newEmotions.botEmotion.happiness
        ) {
            // Trigger immediate save by calling updateEmotions (which saves immediately)
            this.updateEmotions(botId, playerId, {
                botEmotion: newEmotions.botEmotion,
                personEmotion: newEmotions.personEmotion,
                lastEmotionUpdate: newEmotions.lastEmotionUpdate,
            });
        }

        // Schedule AI analysis (runs 10s after last message, debounced)
        if (this.emotionAnalyzer && sender === 'person') {
            this.emotionAnalyzer.scheduleAnalysis(botId, playerId);
        }

        // Schedule debounced save for conversation history
        this.scheduleDebouncedSave(botId, playerId);
    }

    /**
     * Update emotions with immediate persistence
     */
    updateEmotions(
        botId: string,
        playerId: number,
        emotions: Partial<EmotionalState>
    ): void {
        const memory = this.getOrCreateMemory(botId, playerId);
        const now = Date.now();

        // Update emotions
        if (emotions.botEmotion) {
            memory.emotions.botEmotion = {
                ...memory.emotions.botEmotion,
                ...emotions.botEmotion,
            };
        }
        if (emotions.personEmotion) {
            memory.emotions.personEmotion = {
                ...memory.emotions.personEmotion,
                ...emotions.personEmotion,
            };
        }
        if (emotions.lastEmotionUpdate !== undefined) {
            memory.emotions.lastEmotionUpdate = emotions.lastEmotionUpdate;
        } else {
            memory.emotions.lastEmotionUpdate = now;
        }

        memory.lastUpdated = now;

        // Immediate save for emotion changes
        if (this.immediateSaveEnabled) {
            this.saveMemoryImmediately(botId, memory).catch(error => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error('[PersistentMemory] Error saving emotions immediately:', error);
                }
            });
        }
    }

    /**
     * Set conversation purpose
     */
    setConversationPurpose(
        botId: string,
        playerId: number,
        purpose: ConversationPurpose
    ): void {
        const memory = this.getOrCreateMemory(botId, playerId);
        
        // Store purpose in metadata (we'll add a purpose field to BotPlayerMemory if needed)
        // For now, we can store it in a custom field or extend the interface
        // This is a placeholder - in a real implementation, we'd add purpose to BotPlayerMemory
        (memory as any).conversationPurpose = purpose;
        
        // Schedule debounced save
        this.scheduleDebouncedSave(botId, playerId);
    }

    /**
     * Get conversation purpose
     */
    getConversationPurpose(botId: string, playerId: number): ConversationPurpose {
        const memory = this.getMemory(botId, playerId);
        if (!memory) {
            return 'unknown';
        }
        return (memory as any).conversationPurpose || 'unknown';
    }

    /**
     * Schedule a debounced save for conversation history
     */
    private scheduleDebouncedSave(botId: string, playerId: number): void {
        const key = `${botId}_${playerId}`;
        
        // Clear existing timer
        const existingTimer = this.debounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Get current memory state
        const memory = this.getMemory(botId, playerId);
        if (!memory) {
            return;
        }

        // Store pending save
        this.pendingSaves.set(key, memory);

        // Schedule new save
        const timer = setTimeout(() => {
            this.flushDebouncedSave(botId, playerId);
        }, this.debounceInterval);

        this.debounceTimers.set(key, timer);
    }

    /**
     * Flush a debounced save
     */
    private async flushDebouncedSave(botId: string, playerId: number): Promise<void> {
        const key = `${botId}_${playerId}`;
        const memory = this.pendingSaves.get(key);
        
        if (!memory) {
            return;
        }

        // Clear timer and pending save
        const timer = this.debounceTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(key);
        }
        this.pendingSaves.delete(key);

        // Save to storage (periodic save for conversation history)
        try {
            await this.memoryStorage.saveMemory(botId, memory, 'periodic');
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[PersistentMemory] Saved conversation history for bot ${botId}, player ${playerId}`);
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[PersistentMemory] Error flushing debounced save:', error);
            }
        }
    }

    /**
     * Save memory immediately (for emotion changes)
     */
    private async saveMemoryImmediately(botId: string, memory: BotPlayerMemory): Promise<void> {
        try {
            // Use "immediate" saveType for emotion-only updates
            await this.memoryStorage.saveMemory(botId, memory, 'immediate');
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[PersistentMemory] Immediately saved emotions for bot ${botId}, player ${memory.playerId}`);
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[PersistentMemory] Error saving memory immediately:', error);
            }
        }
    }

    /**
     * Flush all pending saves (for shutdown)
     */
    async flushAllPendingSaves(): Promise<void> {
        const promises: Promise<void>[] = [];

        for (const [key, memory] of this.pendingSaves.entries()) {
            const [botId, playerIdStr] = key.split('_');
            const playerId = parseInt(playerIdStr, 10);
            
            // Clear timer
            const timer = this.debounceTimers.get(key);
            if (timer) {
                clearTimeout(timer);
                this.debounceTimers.delete(key);
            }

            // Save immediately
            promises.push(this.flushDebouncedSave(botId, playerId));
        }

        await Promise.all(promises);
    }

    /**
     * Load memories for a bot from storage
     * Note: This restores memories by triggering getOrCreateMemory through addMessage,
     * then updating the memory with loaded data
     */
    async loadMemories(botId: string): Promise<void> {
        try {
            const memories = await this.memoryStorage.loadMemories(botId);
            
            // Restore memories to in-memory store
            // We trigger getOrCreateMemory by calling addMessage with a dummy message,
            // then replace the memory with the loaded data
            for (const memory of memories) {
                // Check if memory already exists
                const existing = this.getMemory(botId, memory.playerId);
                if (existing) {
                    // Update existing memory with loaded data
                    Object.assign(existing, memory);
                } else {
                    // Trigger memory creation by adding a dummy message (will be removed)
                    // This ensures getOrCreateMemory is called
                    super.addMessage(botId, memory.playerId, '', 'person');
                    const newMemory = this.getMemory(botId, memory.playerId);
                    if (newMemory) {
                        // Replace with loaded memory data
                        Object.assign(newMemory, memory);
                        // Remove the dummy message we added
                        if (newMemory.conversationHistory.length > 0 && 
                            newMemory.conversationHistory[0].message === '') {
                            newMemory.conversationHistory.shift();
                        }
                    }
                }
            }
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[PersistentMemory] Loaded ${memories.length} memories for bot ${botId}`);
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[PersistentMemory] Error loading memories:', error);
            }
        }
    }

    /**
     * Get memory storage instance (for external access)
     */
    getMemoryStorage(): MemoryStorage {
        return this.memoryStorage;
    }
}
