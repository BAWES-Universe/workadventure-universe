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
    // UUID tracking - map "botId_playerId" to { userUuid, isLogged }
    private uuidTracking: Map<string, { userUuid: string; isLogged: boolean }> = new Map();
    // Temporary storage for loaded memories (keyed by userUuid) - restored when user joins
    private loadedMemoriesByUuid: Map<string, BotPlayerMemory> = new Map(); // key: "botId_userUuid"

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
     * Set UUID tracking info for a user (called by behaviors when user joins)
     * This allows memory saves to include userUuid and isGuest
     * NOW ALSO: Restores memory if it was loaded for this userUuid (lazy restoration)
     */
    setUserUuid(botId: string, playerId: number, userUuid: string, isLogged: boolean): void {
        const key = `${botId}_${playerId}`;
        this.uuidTracking.set(key, { userUuid, isLogged });
        
        // Check if we have a loaded memory for this userUuid (lazy restoration)
        const loadedMemoryKey = `${botId}_${userUuid}`;
        const loadedMemory = this.loadedMemoriesByUuid.get(loadedMemoryKey);
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[PersistentMemory] setUserUuid called: botId=${botId}, playerId=${playerId}, userUuid=${userUuid}, isLogged=${isLogged}`);
            console.log(`[PersistentMemory] Available memories: ${Array.from(this.loadedMemoriesByUuid.keys()).join(', ') || 'none'}`);
            console.log(`[PersistentMemory] Looking for key: ${loadedMemoryKey}, found: ${loadedMemory ? 'YES' : 'NO'}`);
            if (loadedMemory) {
                console.log(`[PersistentMemory] Memory has ${loadedMemory.emotions?.wounds?.length || 0} wounds, familiarity: ${loadedMemory.emotions?.botEmotion?.familiarity || 0}`);
            }
        }
        
        if (loadedMemory) {
            // Restore memory to current playerId
            const existing = this.getMemory(botId, playerId);
            if (existing) {
                // Merge: keep current memory but restore loaded data (preserve any new messages)
                // Only restore if existing memory is empty or very new
                const existingIsNew = existing.conversationHistory.length === 0 || 
                                     (Date.now() - existing.createdAt) < 5000; // Less than 5 seconds old
                
                if (existingIsNew) {
                    // Replace with loaded memory (user just joined, no conversation yet)
                    Object.assign(existing, loadedMemory);
                    existing.playerId = playerId; // Update to current playerId
                } else {
                    // Merge: keep conversation history, restore emotions and personal info
                    existing.emotions = loadedMemory.emotions;
                    existing.personalInfo = loadedMemory.personalInfo;
                    existing.relationship = loadedMemory.relationship;
                    // Keep existing conversationHistory (current session)
                }
            } else {
                // Create new memory with loaded data
                super.addMessage(botId, playerId, '', 'person');
                const newMemory = this.getMemory(botId, playerId);
                if (newMemory) {
                    Object.assign(newMemory, loadedMemory);
                    newMemory.playerId = playerId; // Update to current playerId
                    // Remove dummy message
                    if (newMemory.conversationHistory.length > 0 && 
                        newMemory.conversationHistory[0]?.message === '') {
                        newMemory.conversationHistory.shift();
                    }
                }
            }
            
            // Remove from loaded memories (already restored)
            this.loadedMemoriesByUuid.delete(loadedMemoryKey);
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[PersistentMemory] ✅ Restored memory for userUuid ${userUuid} to playerId ${playerId}`);
            }
        }
        
        // Also update the memory object if it exists (existing behavior)
        const memory = this.getMemory(botId, playerId);
        if (memory) {
            memory.userUuid = userUuid; // REQUIRED - update to actual UUID
            memory.isGuest = !isLogged;
        }
    }

    /**
     * Override addMessage to add debounced save, immediate save for important changes, and AI analysis
     */
    addMessage(
        botId: string,
        playerId: number,
        message: string,
        sender: 'bot' | 'person',
        spaceName?: string
    ): void {
        // Get state before update
        const memory = this.getOrCreateMemory(botId, playerId);
        const oldEmotions = {
            personAnger: memory.emotions.personEmotion.anger,
            personHappiness: memory.emotions.personEmotion.happiness,
            botAnger: memory.emotions.botEmotion.anger,
            botHappiness: memory.emotions.botEmotion.happiness,
        };
        const oldPersonalInfo = {
            birthday: memory.personalInfo.birthday,
            name: memory.personalInfo.name,
            factsCount: memory.personalInfo.facts.size,
            preferencesCount: memory.personalInfo.preferences?.length || 0,
        };
        const oldImportantEventsCount = memory.relationship.importantEvents.length;

        // Call parent implementation (updates emotions, extracts personal info)
        super.addMessage(botId, playerId, message, sender, spaceName);

        // Get updated state
        const updatedMemory = this.getOrCreateMemory(botId, playerId);
        const newEmotions = updatedMemory.emotions;
        const newPersonalInfo = updatedMemory.personalInfo;
        const newImportantEventsCount = updatedMemory.relationship.importantEvents.length;

        // Check if emotions changed
        const emotionsChanged = (
            oldEmotions.personAnger !== newEmotions.personEmotion.anger ||
            oldEmotions.personHappiness !== newEmotions.personEmotion.happiness ||
            oldEmotions.botAnger !== newEmotions.botEmotion.anger ||
            oldEmotions.botHappiness !== newEmotions.botEmotion.happiness
        );

        // Check if personal info changed (birthday, name, facts, preferences, important events)
        const personalInfoChanged = (
            oldPersonalInfo.birthday !== newPersonalInfo.birthday ||
            oldPersonalInfo.name !== newPersonalInfo.name ||
            oldPersonalInfo.factsCount !== newPersonalInfo.facts.size ||
            oldPersonalInfo.preferencesCount !== (newPersonalInfo.preferences?.length || 0) ||
            oldImportantEventsCount !== newImportantEventsCount
        );

        // If emotions OR personal info changed, trigger immediate save
        if (emotionsChanged || personalInfoChanged) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                if (personalInfoChanged) {
                    console.log(`[PersistentMemory] Personal info changed for player ${playerId}:`);
                    if (oldPersonalInfo.birthday !== newPersonalInfo.birthday) {
                        console.log(`  - birthday: ${oldPersonalInfo.birthday || 'not set'} -> ${newPersonalInfo.birthday || 'not set'}`);
                    }
                    if (oldPersonalInfo.name !== newPersonalInfo.name) {
                        console.log(`  - name: ${oldPersonalInfo.name || 'not set'} -> ${newPersonalInfo.name || 'not set'}`);
                    }
                    if (oldPersonalInfo.factsCount !== newPersonalInfo.facts.size) {
                        console.log(`  - facts: ${oldPersonalInfo.factsCount} -> ${newPersonalInfo.facts.size}`);
                    }
                    if (oldImportantEventsCount !== newImportantEventsCount) {
                        console.log(`  - importantEvents: ${oldImportantEventsCount} -> ${newImportantEventsCount}`);
                    }
                }
            }
            
            // Save immediately (includes full memory with personal info)
            this.saveMemoryImmediately(botId, updatedMemory);
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

        // Add UUID info to memory before saving (REQUIRED for Admin API)
        const uuidInfo = this.uuidTracking.get(key);
        if (uuidInfo) {
            memory.userUuid = uuidInfo.userUuid; // REQUIRED
            memory.isGuest = !uuidInfo.isLogged;
        } else {
            // UUID should be available from InitSpaceUsersMessage or addSpaceUserMessage
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[PersistentMemory] UUID not found for player ${playerId} when saving memory. Skipping save.`);
            }
            // Don't save without UUID - memory cannot be stored correctly
            return;
        }

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
            // Add UUID info to memory before saving (for Admin API UUID matching)
            const key = `${botId}_${memory.playerId}`;
            const uuidInfo = this.uuidTracking.get(key);
            if (uuidInfo) {
                memory.userUuid = uuidInfo.userUuid;
                memory.isGuest = !uuidInfo.isLogged;
            } else {
                // UUID should be available from InitSpaceUsersMessage or addSpaceUserMessage
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[PersistentMemory] UUID not found for player ${memory.playerId} when saving memory immediately. Skipping save.`);
                }
                // Don't save without UUID - memory cannot be stored correctly
                return;
            }
            
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
     * NOW: Stores memories temporarily by userUuid, to be restored when user joins (lazy restoration)
     * This allows memory to persist across playerId changes (e.g., guest reloads)
     */
    async loadMemories(botId: string): Promise<void> {
        try {
            const memories = await this.memoryStorage.loadMemories(botId);
            
            // Store memories temporarily by userUuid (not playerId)
            // They will be restored when setUserUuid is called (when user joins)
            let storedCount = 0;
            for (const memory of memories) {
                if (memory.userUuid) {
                    const loadedMemoryKey = `${botId}_${memory.userUuid}`;
                    this.loadedMemoriesByUuid.set(loadedMemoryKey, memory);
                    storedCount++;
                } else {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.warn(`[PersistentMemory] Loaded memory without userUuid, skipping (playerId: ${memory.playerId})`);
                    }
                }
            }
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                if (storedCount > 0) {
                    console.log(`[PersistentMemory] Loaded ${storedCount} memories for bot ${botId} (will restore when users join)`);
                } else {
                    console.log(`[PersistentMemory] No persisted memories found for bot ${botId} (will create fresh when users interact)`);
                }
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[PersistentMemory] Error loading memories:', error);
            }
        }
    }

    /**
     * Get memory by userUuid - checks both active memories AND pre-loaded memories
     * This is useful for API endpoints that need to access emotions before user enters proximity
     */
    getMemoryByUserUuid(botId: string, userUuid: string): BotPlayerMemory | null {
        // First check active memories
        const activeMemories = this.getAllMemories();
        for (const memory of activeMemories.values()) {
            if (memory.userUuid === userUuid) {
                return memory;
            }
        }
        
        // Then check pre-loaded memories (not yet restored to active)
        const loadedMemoryKey = `${botId}_${userUuid}`;
        const loadedMemory = this.loadedMemoriesByUuid.get(loadedMemoryKey);
        if (loadedMemory) {
            return loadedMemory;
        }
        
        return null;
    }

    /**
     * Get memory storage instance (for external access)
     */
    getMemoryStorage(): MemoryStorage {
        return this.memoryStorage;
    }
}
