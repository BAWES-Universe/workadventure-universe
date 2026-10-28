/**
 * PersistentMemory - Extends ConversationMemory with immediate emotion persistence and debounced saves
 * 
 * Features:
 * - Immediate persistence on emotion changes
 * - Debounced saves for conversation history
 * - Track conversation purposes
 * - AI-driven emotion updates (unified in AI response, not separate EmotionAnalyzer)
 */

import { ConversationMemory, type BotPlayerMemory, type ConversationMessage, type EmotionalState } from './ConversationMemory';
import { MemoryStorage } from './MemoryStorage';
import type { MemoryForgetNotice } from './ForgetNotice';

export type ConversationPurpose = 'navigation' | 'information' | 'social' | 'support' | 'entertainment' | 'unknown';

export interface PersistentMemoryConfig {
    maxHistorySize?: number;
    maxMemories?: number;
    adminApiUrl?: string;
    debounceInterval?: number; // Debounce interval for conversation history saves (default: 30 seconds)
    immediateSaveEnabled?: boolean; // Whether to immediately save emotion changes (default: true)
}

export class PersistentMemory extends ConversationMemory {
    private memoryStorage: MemoryStorage;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map(); // key: "botId_playerId"
    private debounceInterval: number;
    private immediateSaveEnabled: boolean;
    private pendingSaves: Map<string, BotPlayerMemory> = new Map(); // key: "botId_playerId"
    // UUID tracking - map "botId_playerId" to { userUuid, isLogged }
    private uuidTracking: Map<string, { userUuid: string; isLogged: boolean }> = new Map();
    // Temporary storage for loaded memories (keyed by userUuid) - restored when user joins
    private loadedMemoriesByUuid: Map<string, BotPlayerMemory> = new Map(); // key: "botId_userUuid"
    /** Forgets already applied, by "botId|row:<id>" (or "botId|*" and "botId|uuid:<uuid>" from an older Orbit), with when each may be left out (see forget) */
    private appliedForgets: Map<string, number> = new Map();
    /** Forgets being reported to Orbit right now, by "botId|<id>" */
    private reporting: Set<string> = new Set();
    /** An older Orbit repeats a Forget for a minute: longer than that plus one 30-second privacy check */
    private static readonly FORGET_REPEAT_WINDOW_MS = 2 * 60 * 1000;
    /**
     * A Forget with an id is repeated by Orbit until we report it (#493), so it is remembered as applied for as long as
     * that takes. This is only the limit for one that is never reported; a reported one is kept for a short tail, for
     * answers that were already on their way.
     */
    private static readonly FORGET_UNREPORTED_KEEP_MS = 24 * 60 * 60 * 1000;

    constructor(config: PersistentMemoryConfig = {}) {
        super(config.maxHistorySize || 50, config.maxMemories || 1000);
        
        this.debounceInterval = config.debounceInterval || 30000; // 30 seconds
        this.immediateSaveEnabled = config.immediateSaveEnabled !== false; // Default: true
        
        // Initialize memory storage
        this.memoryStorage = new MemoryStorage({
            adminApiUrl: config.adminApiUrl,
            botServiceToken: process.env.BOT_SERVICE_TOKEN, // the only token memory uses (#444)
            saveInterval: 5 * 60 * 1000, // 5 minutes (not used for debounced saves)
            maxRetries: 3,
        });
        // Orbit answers a save with the people a manager asked the bot to forget (#435)
        this.memoryStorage.setForgetHandler((botId, notice) => this.forget(botId, notice));
    }

    /**
     * Drop forgotten people from everything held in memory: what is active, what was loaded for them to join later,
     * and any save still waiting. Orbit has already deleted them and skipped them in the save it just answered, so
     * after this the bot does not remember them and nothing saves them again. Someone who is still talking to the
     * bot starts fresh from their next message.
     */
    forget(botId: string, notice: MemoryForgetNotice): void {
        this.dropForgotten(botId, notice);
        // Every Forget with an id in this notice gets reported, the new ones and the ones a lost report left behind
        if (notice.rows && notice.rows.length > 0) this.reportForgotten(botId, notice.rows.map((row) => row.id));
    }

    private dropForgotten(botId: string, notice: MemoryForgetNotice): void {
        // Orbit repeats a Forget in every answer until we report it dropped (#493; an older Orbit for a minute). Applied
        // each time, it would wipe what the bot learned since from someone who kept talking, so each one is applied
        // once: by its id when Orbit sends one (a second Forget of the same person is a new id), otherwise by who it names.
        const now = Date.now();
        for (const [key, keepUntil] of this.appliedForgets) {
            if (now > keepUntil) this.appliedForgets.delete(key);
        }

        const isNew = (key: string) => !this.appliedForgets.has(`${botId}|${key}`);
        let everyone: boolean;
        let userUuids: string[];
        if (notice.rows && notice.rows.length > 0) {
            const rows = notice.rows.filter((row) => isNew(`row:${row.id}`));
            everyone = rows.some((row) => row.userUuid === null);
            userUuids = rows.flatMap((row) => (row.userUuid === null ? [] : [row.userUuid]));
            for (const row of rows) this.appliedForgets.set(`${botId}|row:${row.id}`, now + PersistentMemory.FORGET_UNREPORTED_KEEP_MS);
        } else {
            everyone = notice.everyone && isNew('*');
            userUuids = notice.userUuids.filter((uuid) => isNew(`uuid:${uuid}`));
            if (everyone) this.appliedForgets.set(`${botId}|*`, now + PersistentMemory.FORGET_REPEAT_WINDOW_MS);
            for (const uuid of userUuids) this.appliedForgets.set(`${botId}|uuid:${uuid}`, now + PersistentMemory.FORGET_REPEAT_WINDOW_MS);
        }
        if (!everyone && userUuids.length === 0) return;

        const prefix = `${botId}_`;
        const forgotten = new Set(userUuids);
        const isForgotten = (userUuid: string | undefined) => everyone || (!!userUuid && forgotten.has(userUuid));

        for (const [key, memory] of this.getAllMemories().entries()) {
            if (!key.startsWith(prefix)) continue;
            // A memory made before the person's uuid was known still says "temp-<playerId>": the tracked uuid counts too
            if (!isForgotten(memory.userUuid) && !isForgotten(this.uuidTracking.get(key)?.userUuid)) continue;
            this.clearMemory(botId, Number(key.slice(prefix.length)));
            const timer = this.debounceTimers.get(key);
            if (timer) clearTimeout(timer);
            this.debounceTimers.delete(key);
            this.pendingSaves.delete(key);
        }

        for (const key of Array.from(this.loadedMemoriesByUuid.keys())) {
            if (key.startsWith(prefix) && isForgotten(key.slice(prefix.length))) {
                this.loadedMemoriesByUuid.delete(key);
            }
        }
    }

    /**
     * Tell Orbit these Forgets are dropped, so it stops skipping those people and removes the rows. Fire and forget: when
     * the report does not get through, Orbit keeps sending the Forget and the next answer that carries it reports again.
     * The dropped people are never wiped twice meanwhile, because the id stays in appliedForgets.
     */
    private reportForgotten(botId: string, ids: string[]): void {
        const pending = ids.filter((id) => !this.reporting.has(`${botId}|${id}`));
        if (pending.length === 0) return;
        for (const id of pending) this.reporting.add(`${botId}|${id}`);
        this.memoryStorage
            .acknowledgeForgets(botId, pending)
            .then((reported) => {
                if (!reported) return;
                // Answers Orbit already sent may still carry the Forget: keep the id for a little, so it is not applied again
                const keepUntil = Date.now() + PersistentMemory.FORGET_REPEAT_WINDOW_MS;
                for (const id of pending) {
                    if (this.appliedForgets.has(`${botId}|row:${id}`)) this.appliedForgets.set(`${botId}|row:${id}`, keepUntil);
                }
            })
            .catch(() => undefined)
            .finally(() => {
                for (const id of pending) this.reporting.delete(`${botId}|${id}`);
            });
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
        let loadedMemory = this.loadedMemoriesByUuid.get(loadedMemoryKey);

        // If there's an active memory for this userUuid on a different playerId (another tab, or the person's
        // direct messages while they chat on the map), use that instead when it is more recently updated than the
        // cached snapshot. Also when there is no snapshot: someone who first met the bot in this process has none, and
        // their chat on the map must still be there when they send it a direct message.
        const others = this.otherMemories(botId, playerId, userUuid);
        if (others.length > 0) {
            const snapshot = loadedMemory;
            const freshest = others.reduce((a, b) => (b.lastUpdated > a.lastUpdated ? b : a));
            const base = freshest.lastUpdated > (snapshot?.lastUpdated || 0) ? freshest : snapshot!;
            // A copy, so neither the cached snapshot nor another chat changes with what follows
            loadedMemory = this.cloneMemory(base);
            // Lines from every chat of this person (and the snapshot), so none is lost when they have several
            for (const source of [snapshot, ...others]) {
                if (!source || source === base) continue;
                loadedMemory.conversationHistory = PersistentMemory.mergeHistories(
                    loadedMemory.conversationHistory,
                    source.conversationHistory ?? [],
                    this.historyLimit(botId)
                );
            }
        }
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[PersistentMemory] setUserUuid called: botId=${botId}, playerId=${playerId}, userUuid=${userUuid}, isLogged=${isLogged}`);
            console.log(`[PersistentMemory] Available memories: ${Array.from(this.loadedMemoriesByUuid.keys()).join(', ') || 'none'}`);
            console.log(`[PersistentMemory] Looking for key: ${loadedMemoryKey}, found: ${loadedMemory ? 'YES' : 'NO'}`);
            if (loadedMemory) {
                console.log(`[PersistentMemory] Memory has ${loadedMemory.emotions?.wounds?.length || 0} wounds, familiarity: ${loadedMemory.emotions?.botEmotion?.familiarity || 0}`);
            }
        }
        
        if (loadedMemory) {
            // Check if existing active memory belongs to a different user (recycled playerId)
            const existing = this.getMemory(botId, playerId);
            if (existing && existing.userUuid && existing.userUuid !== userUuid) {
                // Distinguish between first-time UUID assignment (temp UUID from getOrCreateMemory
                // being replaced with actual UUID) vs a truly recycled playerId (a different user).
                // Temp UUIDs are set by ConversationMemory.getOrCreateMemory as `temp-{playerId}`.
                // For recycled playerIds we MUST clear the memory to prevent data leakage.
                const isFirstTimeAssignment = existing.userUuid.startsWith('temp-');
                if (!isFirstTimeAssignment) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[PersistentMemory] Recycled playerId ${playerId}: clearing stale memory for UUID ${existing.userUuid}, restoring for ${userUuid}`);
                    }
                    this.clearMemory(botId, playerId);
                }
            }

            // Restore memory to current playerId
            const existingOrNew = this.getMemory(botId, playerId);
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                const livePM = existingOrNew?.pendingMedia ?? [];
                const snapPM = loadedMemory.pendingMedia ?? [];
                console.log(`[PM-TRACE] before restore: liveLen=${livePM.length} liveUrls=[${livePM.map(p => p.url.substring(0, 60)).join(', ')}] snapLen=${snapPM.length} snapUrls=[${snapPM.map(p => p.url.substring(0, 60)).join(', ')}] histLen=${existingOrNew?.conversationHistory?.length ?? 0} existingUuid=${existingOrNew?.userUuid ?? 'none'}`);
            }
            if (existingOrNew) {
                // Merge: keep current memory but restore loaded data (preserve any new messages)
                // Only restore if existing memory is empty (just joined, no conversation yet)
                const existingIsNew = existingOrNew.conversationHistory.length === 0;
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[PM-TRACE] restore branch: existingIsNew=${existingIsNew} histLen=${existingOrNew.conversationHistory.length} livePendingMedia=${existingOrNew.pendingMedia?.length ?? 0}`);
                }
                
                if (existingIsNew) {
                    // Replace with loaded memory (user just joined, no conversation yet)
                    Object.assign(existingOrNew, loadedMemory);
                    existingOrNew.playerId = playerId; // Update to current playerId
                } else {
                    // Merge: keep conversation history, merge emotions and personal info
                    // selectively so current session data is never erased by stale snapshot
                    existingOrNew.emotions = {
                        botEmotion: {
                            ...loadedMemory.emotions.botEmotion,
                            ...existingOrNew.emotions.botEmotion,
                        },
                        personEmotion: {
                            ...loadedMemory.emotions.personEmotion,
                            ...existingOrNew.emotions.personEmotion,
                        },
                        wounds: existingOrNew.emotions.wounds.length > 0
                            ? existingOrNew.emotions.wounds
                            : loadedMemory.emotions.wounds,
                        recentSentiment: existingOrNew.emotions.recentSentiment || loadedMemory.emotions.recentSentiment,
                        lastEmotionUpdate: existingOrNew.emotions.lastEmotionUpdate,
                    };
                    // Personal info: only fill blanks, never overwrite current session data
                    existingOrNew.personalInfo = {
                        name: existingOrNew.personalInfo.name || loadedMemory.personalInfo.name,
                        birthday: existingOrNew.personalInfo.birthday || loadedMemory.personalInfo.birthday,
                        preferences: existingOrNew.personalInfo.preferences && existingOrNew.personalInfo.preferences.length > 0
                            ? existingOrNew.personalInfo.preferences
                            : loadedMemory.personalInfo.preferences,
                        facts: existingOrNew.personalInfo.facts.size > 0
                            ? existingOrNew.personalInfo.facts
                            : new Map(loadedMemory.personalInfo.facts),
                        lastInfoUpdate: existingOrNew.personalInfo.lastInfoUpdate,
                    };
                    // Relationship: take the best of both (max conversations, earliest firstMet, latest lastMet)
                    existingOrNew.relationship = {
                        ...loadedMemory.relationship,
                        totalConversations: Math.max(existingOrNew.relationship.totalConversations, loadedMemory.relationship.totalConversations),
                        totalMessages: Math.max(existingOrNew.relationship.totalMessages, loadedMemory.relationship.totalMessages),
                        firstMet: Math.min(existingOrNew.relationship.firstMet, loadedMemory.relationship.firstMet),
                        lastMet: Math.max(existingOrNew.relationship.lastMet, loadedMemory.relationship.lastMet),
                        importantEvents: existingOrNew.relationship.importantEvents.length > 0
                            ? existingOrNew.relationship.importantEvents
                            : loadedMemory.relationship.importantEvents,
                    };
                    // Keep the current conversation and add what was said elsewhere since (on the map or in direct
                    // messages), so memory follows the person, not the chat
                    existingOrNew.conversationHistory = PersistentMemory.mergeHistories(
                        existingOrNew.conversationHistory,
                        loadedMemory.conversationHistory ?? [],
                        Math.max(this.historyLimit(botId), existingOrNew.maxHistorySize || 0)
                    );
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
            
            // Store a snapshot in cache (not the live reference) so subsequent reconnects
            // within the same bot session get the latest data, without sharing mutable state
            const restoredMemory = this.getMemory(botId, playerId);
            if (restoredMemory) {
                this.loadedMemoriesByUuid.set(loadedMemoryKey, this.cloneMemory(restoredMemory));
            }
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                const afterRestore = this.getMemory(botId, playerId);
                const afterPM = afterRestore?.pendingMedia ?? [];
                console.log(`[PM-TRACE] after restore: pendingMediaLen=${afterPM.length} urls=[${afterPM.map(p => p.url.substring(0, 60)).join(', ')}] existingIsNew=${afterRestore?.conversationHistory?.length === 0} snapshotStored=${!!restoredMemory}`);
            }
            
            // Keep cache bounded — prevent unbounded growth from orphaned entries
            // that were evicted from active memories by LRU cleanupOldMemories()
            if (this.loadedMemoriesByUuid.size > 2000) {
                const toRemove = Math.ceil(this.loadedMemoriesByUuid.size * 0.1);
                const keys = Array.from(this.loadedMemoriesByUuid.keys());
                for (let i = 0; i < toRemove; i++) {
                    this.loadedMemoriesByUuid.delete(keys[i]);
                }
            }
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[PersistentMemory] ✅ Restored memory for userUuid ${userUuid} to playerId ${playerId}`);
            }
        } else {
            // No pre-loaded memory for this userUuid
            // Check if there's an existing active memory with a DIFFERENT UUID on this playerId
            // (recycled playerId scenario without pre-loaded memory)
            const existing = this.getMemory(botId, playerId);
            if (existing && existing.userUuid && existing.userUuid !== userUuid) {
                // Temp UUIDs are first-time assignments from getOrCreateMemory.
                // Only clear for truly recycled playerIds (real UUID from a different user).
                const isFirstTimeAssignment = existing.userUuid.startsWith('temp-');
                if (!isFirstTimeAssignment) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[PersistentMemory] Recycled playerId ${playerId}: clearing memory for UUID ${existing.userUuid}, new user ${userUuid} has no pre-loaded memory`);
                    }
                    this.clearMemory(botId, playerId);
                }
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

        // Note: AI emotion analysis is now unified into the AI response itself
        // The AI outputs emotion data with each response, eliminating the need for separate analysis scheduling

        // Schedule debounced save for conversation history
        this.scheduleDebouncedSave(botId, playerId);
    }

    /**
     * Append a vision-description note to the last person message AND persist
     * the annotated history (debounced), so the description survives restarts.
     * Deliberately side-effect free in the base class — here we only add the
     * debounced save on top.
     */
    override appendVisionDescription(
        botId: string,
        playerId: number,
        description: string,
        spaceName?: string
    ): void {
        super.appendVisionDescription(botId, playerId, description, spaceName);
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
     * Override updateEmotionsFromAI to ensure AI emotion updates are saved immediately
     */
    updateEmotionsFromAI(
        botId: string,
        playerId: number,
        aiEmotions: {
            personSentiment: number;      // -100 to 100
            isInsult: boolean;
            insultSeverity: number;       // 1-10 or 0
            context: string;              // sarcastic, joking, sincere, frustrated, angry, neutral
        }
    ): void {
        // Call parent implementation (updates emotions in memory)
        super.updateEmotionsFromAI(botId, playerId, aiEmotions);
        
        // Get updated memory and save immediately
        const memory = this.getMemory(botId, playerId);
        if (memory && this.immediateSaveEnabled) {
            this.saveMemoryImmediately(botId, memory).catch(error => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error('[PersistentMemory] Error saving AI emotions immediately:', error);
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
                    const keys = Array.from(this.loadedMemoriesByUuid.keys())
                        .filter(k => k.startsWith(`${botId}_`))
                        .map(k => k.replace(`${botId}_`, ''));
                    console.log(`[PersistentMemory] Loaded ${storedCount} memories for bot ${botId}: uuids=[${keys.join(', ')}]`);
                    console.log(`[PersistentMemory] Will restore when setUserUuid is called with matching UUID`);
                } else {
                    console.log(`[PersistentMemory] No persisted memories found for bot ${botId} (will create fresh when users interact)`);
                }
            }
        } catch (error) {
            console.error(`[PersistentMemory] Error loading memories for bot ${botId}:`, error);
            throw error;
        }
    }

    /**
     * Get memory by userUuid - checks both active memories AND pre-loaded memories
     * This is useful for API endpoints that need to access emotions before user enters proximity
     */
    getMemoryByUserUuid(botId: string, userUuid: string): BotPlayerMemory | null {
        // First check active memories - MUST filter by botId
        const activeMemories = this.getAllMemories();
        for (const [key, memory] of activeMemories.entries()) {
            // CRITICAL: Check that this memory belongs to the correct bot
            if (key.startsWith(`${botId}_`) && memory.userUuid === userUuid) {
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
     * This person's active memories on other playerIds, e.g. their chat on the map while they send a direct message. A
     * memory made before the person's uuid was known still says "temp-<playerId>": the tracked uuid counts for it.
     */
    private otherMemories(botId: string, playerId: number, userUuid: string): BotPlayerMemory[] {
        const others: BotPlayerMemory[] = [];
        for (const [key, memory] of this.getAllMemories().entries()) {
            if (key !== `${botId}_${memory.playerId}` || memory.playerId === playerId) continue;
            const owner = memory.userUuid?.startsWith('temp-') ? this.uuidTracking.get(key)?.userUuid : memory.userUuid;
            if (owner === userUuid) others.push(memory);
        }
        return others;
    }

    /**
     * Both histories as one, in time order, each message once, keeping the last `max`. Two copies of one message have
     * the same time, sender and text, except that one may carry a vision note at its end: the longer copy is kept.
     */
    private static mergeHistories(current: ConversationMessage[], other: ConversationMessage[], max: number): ConversationMessage[] {
        // `longer` is `shorter` plus vision notes (an image sent with no words starts out empty)
        const withNote = (longer: string, shorter: string) =>
            longer.startsWith(shorter) && longer.slice(shorter.length).trimStart().startsWith('[Image description:');
        const sameMessage = (a: ConversationMessage, b: ConversationMessage) =>
            a.timestamp === b.timestamp &&
            a.sender === b.sender &&
            (a.message === b.message || withNote(a.message, b.message) || withNote(b.message, a.message));
        const merged = [...current];
        let changed = false;
        for (const message of other) {
            const index = merged.findIndex((kept) => sameMessage(kept, message));
            if (index === -1) {
                merged.push({ ...message });
                changed = true;
            } else if (message.message.length > merged[index].message.length) {
                merged[index] = { ...merged[index], message: message.message };
                changed = true;
            }
        }
        if (!changed) return current.length > max ? current.slice(-max) : current;
        return merged.sort((a, b) => a.timestamp - b.timestamp).slice(-max);
    }

    /**
     * Get memory storage instance (for external access)
     */
    getMemoryStorage(): MemoryStorage {
        return this.memoryStorage;
    }

    /**
     * Deep-clone a BotPlayerMemory for safe cache storage.
     * Prevents shared mutable state between different playerId sessions.
     * Handles Map serialization (personalInfo.facts).
     */
    private cloneMemory(memory: BotPlayerMemory): BotPlayerMemory {
        return {
            ...memory,
            conversationHistory: memory.conversationHistory.map(msg => ({ ...msg })),
            emotions: {
                ...memory.emotions,
                botEmotion: { ...memory.emotions.botEmotion },
                personEmotion: { ...memory.emotions.personEmotion },
                wounds: memory.emotions.wounds.map(w => ({ ...w })),
            },
            personalInfo: {
                ...memory.personalInfo,
                facts: new Map(memory.personalInfo.facts),
                preferences: memory.personalInfo.preferences ? [...memory.personalInfo.preferences] : undefined,
            },
            relationship: {
                ...memory.relationship,
                importantEvents: memory.relationship.importantEvents.map(e => ({ ...e })),
            },
            pendingMedia: memory.pendingMedia ? memory.pendingMedia.map(item => ({ ...item })) : [],
            // The turn being answered belongs to the chat it is in, never to a copy in another one
            pendingArtifacts: undefined,
            dmRoomId: undefined,
            artifactCalls: undefined,
            sentAgain: undefined,
        };
    }

    /**
     * Sync the loaded-memories snapshot with the current in-memory state.
     * Called after retryPendingMedia modifies pendingMedia so the snapshot
     * reflects up-to-date items and survives setUserUuid restoration on re-entry.
     * The snapshot is keyed by UUID (matching loadMemories and setUserUuid).
     */
    syncSnapshot(botId: string, playerId: number, memory: BotPlayerMemory): void {
        const key = `${botId}_${playerId}`;
        const uuidInfo = this.uuidTracking.get(key);
        if (uuidInfo) {
            const loadedMemoryKey = `${botId}_${uuidInfo.userUuid}`;
            this.loadedMemoriesByUuid.set(loadedMemoryKey, this.cloneMemory(memory));
        }
    }
}
