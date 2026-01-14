/**
 * ConversationMemory - Maintains conversation history and context per bot-person pair
 * 
 * Stores:
 * - Conversation history (messages)
 * - Emotional state (bot's feelings toward person, person's feelings toward bot)
 * - Personal information (birthday, preferences, etc.)
 * - Relationship context (how they met, important events)
 */

export interface ConversationMessage {
    message: string;
    sender: 'bot' | 'person';
    timestamp: number;
    spaceName?: string;
}

export interface EmotionalState {
    // Bot's emotional state toward this person
    botEmotion: {
        anger: number;      // 0-100, how angry bot is at person
        happiness: number;  // 0-100, how happy bot is with person
        trust: number;      // 0-100, how much bot trusts person
        familiarity: number; // 0-100, how familiar bot is with person
    };
    // Person's emotional state toward bot (inferred from messages)
    personEmotion: {
        anger: number;      // 0-100, inferred from person messages
        happiness: number;  // 0-100, inferred from person messages
        trust: number;      // 0-100, inferred from person messages
    };
    lastEmotionUpdate: number;
}

export interface PersonalInfo {
    // Personal information mentioned by person
    birthday?: string;           // "2024-01-15" or "January 15"
    name?: string;              // Person's preferred name
    preferences?: string[];     // Likes, dislikes, interests
    facts: Map<string, string>; // Key-value facts (e.g., "favorite_color" -> "blue")
    lastInfoUpdate: number;
}

export interface RelationshipContext {
    firstMet: number;           // Timestamp of first conversation
    lastMet: number;            // Timestamp of last conversation
    totalConversations: number; // Number of conversations
    totalMessages: number;      // Total messages exchanged
    importantEvents: Array<{    // Significant events in relationship
        event: string;
        timestamp: number;
        description: string;
    }>;
}

export interface BotPlayerMemory {
    playerId: number; // Keep playerId for backward compatibility, but refers to person
    playerName?: string; // Keep playerName for backward compatibility, but refers to person
    
    // Conversation history (last N messages)
    conversationHistory: ConversationMessage[];
    maxHistorySize: number;
    
    // Emotional state
    emotions: EmotionalState;
    
    // Personal information
    personalInfo: PersonalInfo;
    
    // Relationship context
    relationship: RelationshipContext;
    
    // Metadata
    lastUpdated: number;
    createdAt: number;
}

export class ConversationMemory {
    private memories: Map<string, BotPlayerMemory> = new Map(); // key: "botId_playerId"
    private maxHistorySize: number = 50; // Keep last 50 messages per player
    private maxMemories: number = 1000; // Max memories per bot (prevent memory bloat)

    constructor(maxHistorySize: number = 50, maxMemories: number = 1000) {
        this.maxHistorySize = maxHistorySize;
        this.maxMemories = maxMemories;
    }


    /**
     * Add a message to conversation history
     */
    addMessage(
        botId: string,
        playerId: number,
        message: string,
        sender: 'bot' | 'person',
        spaceName?: string
    ): void {
        const memory = this.getOrCreateMemory(botId, playerId);
        const now = Date.now();

        // Add message to history
        memory.conversationHistory.push({
            message,
            sender,
            timestamp: now,
            spaceName,
        });

        // Trim history if too long
        if (memory.conversationHistory.length > this.maxHistorySize) {
            memory.conversationHistory.shift();
        }

        // Update relationship stats
        if (sender === 'person') {
            memory.relationship.totalMessages++;
        }
        memory.relationship.lastMet = now;
        memory.lastUpdated = now;

        // Update emotions based on message content
        if (sender === 'person') {
            this.updateEmotionsFromMessage(memory, message);
        }
    }

    /**
     * Update emotional state based on message content
     */
    private updateEmotionsFromMessage(memory: BotPlayerMemory, message: string): void {
        const lowerMessage = message.toLowerCase();
        const emotions = memory.emotions;
        const now = Date.now();

        // Detect anger
        const angerKeywords = ['angry', 'mad', 'hate', 'annoyed', 'frustrated', 'upset'];
        const angerLevel = angerKeywords.filter(keyword => lowerMessage.includes(keyword)).length;
        if (angerLevel > 0) {
            emotions.personEmotion.anger = Math.min(100, emotions.personEmotion.anger + (angerLevel * 10));
            emotions.botEmotion.anger = Math.min(100, emotions.botEmotion.anger + (angerLevel * 5));
        } else {
            // Decay anger over time
            const timeSinceUpdate = now - emotions.lastEmotionUpdate;
            const decayRate = timeSinceUpdate / (1000 * 60 * 60); // Decay per hour
            emotions.personEmotion.anger = Math.max(0, emotions.personEmotion.anger - (decayRate * 5));
            emotions.botEmotion.anger = Math.max(0, emotions.botEmotion.anger - (decayRate * 2));
        }

        // Detect happiness
        const happyKeywords = ['happy', 'glad', 'love', 'great', 'awesome', 'thanks', 'thank you'];
        const happyLevel = happyKeywords.filter(keyword => lowerMessage.includes(keyword)).length;
        if (happyLevel > 0) {
            emotions.personEmotion.happiness = Math.min(100, emotions.personEmotion.happiness + (happyLevel * 10));
            emotions.botEmotion.happiness = Math.min(100, emotions.botEmotion.happiness + (happyLevel * 5));
        } else {
            // Decay happiness slightly
            const timeSinceUpdate = now - emotions.lastEmotionUpdate;
            const decayRate = timeSinceUpdate / (1000 * 60 * 60 * 24); // Decay per day
            emotions.personEmotion.happiness = Math.max(0, emotions.personEmotion.happiness - (decayRate * 1));
            emotions.botEmotion.happiness = Math.max(0, emotions.botEmotion.happiness - (decayRate * 1));
        }

        // Increase familiarity with each message
        emotions.botEmotion.familiarity = Math.min(100, emotions.botEmotion.familiarity + 1);

        emotions.lastEmotionUpdate = now;
    }

    /**
     * Extract and store personal information from message
     */
    extractPersonalInfo(botId: string, playerId: number, message: string): void {
        const memory = this.getOrCreateMemory(botId, playerId);
        const lowerMessage = message.toLowerCase();

        // Extract birthday
        const birthdayPatterns = [
            /(?:my|it'?s) (?:birthday|bday) (?:is|on|was)? ?([a-z]+ \d{1,2}|january \d{1,2}|february \d{1,2}|march \d{1,2}|april \d{1,2}|may \d{1,2}|june \d{1,2}|july \d{1,2}|august \d{1,2}|september \d{1,2}|october \d{1,2}|november \d{1,2}|december \d{1,2})/i,
            /(?:my|it'?s) (?:birthday|bday) (?:is|on|was)? ?(\d{1,2}\/\d{1,2}|\d{1,2}-\d{1,2})/,
        ];

        for (const pattern of birthdayPatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                memory.personalInfo.birthday = match[1];
                memory.personalInfo.lastInfoUpdate = Date.now();
                this.addImportantEvent(memory, 'birthday_mentioned', `Player mentioned birthday: ${match[1]}`);
                break;
            }
        }

        // Extract name
        const namePatterns = [
            /(?:my|i'?m|call me|name is|name'?s) ([A-Z][a-z]+)/,
            /(?:i'?m|i am) ([A-Z][a-z]+)/,
        ];

        for (const pattern of namePatterns) {
            const match = message.match(pattern);
            if (match && match[1] && match[1].length > 1 && match[1].length < 20) {
                memory.personalInfo.name = match[1];
                memory.playerName = match[1];
                memory.personalInfo.lastInfoUpdate = Date.now();
                break;
            }
        }

        // Extract preferences (likes/dislikes)
        if (lowerMessage.includes('like') || lowerMessage.includes('love') || lowerMessage.includes('favorite')) {
            // Simple extraction - can be enhanced with NLP
            const likeMatch = message.match(/(?:like|love|favorite) (?:is |are )?([^.!?]+)/i);
            if (likeMatch && likeMatch[1]) {
                if (!memory.personalInfo.preferences) {
                    memory.personalInfo.preferences = [];
                }
                const preference = likeMatch[1].trim();
                if (!memory.personalInfo.preferences.includes(preference)) {
                    memory.personalInfo.preferences.push(preference);
                    memory.personalInfo.lastInfoUpdate = Date.now();
                }
            }
        }
    }

    /**
     * Add an important event to relationship history
     */
    addImportantEvent(memory: BotPlayerMemory, eventType: string, description: string): void {
        memory.relationship.importantEvents.push({
            event: eventType,
            timestamp: Date.now(),
            description,
        });

        // Keep only last 20 events
        if (memory.relationship.importantEvents.length > 20) {
            memory.relationship.importantEvents.shift();
        }
    }

    /**
     * Get conversation history for a bot-player pair
     */
    getConversationHistory(botId: string, playerId: number, limit?: number): ConversationMessage[] {
        const memory = this.getMemory(botId, playerId);
        if (!memory) return [];
        const history = memory.conversationHistory;
        
        if (limit) {
            return history.slice(-limit);
        }
        
        return history;
    }

    /**
     * Get emotional state for a bot-player pair
     */
    getEmotionalState(botId: string, playerId: number): EmotionalState | null {
        const memory = this.getMemory(botId, playerId);
        if (!memory) {
            return null;
        }
        return memory.emotions;
    }

    /**
     * Get personal information for a player
     */
    getPersonalInfo(botId: string, playerId: number): PersonalInfo | null {
        const memory = this.getMemory(botId, playerId);
        return memory?.personalInfo || null;
    }

    /**
     * Get relationship context
     */
    getRelationship(botId: string, playerId: number): RelationshipContext | null {
        const memory = this.getMemory(botId, playerId);
        return memory?.relationship || null;
    }

    /**
     * Get full memory for a bot-player pair
     */
    getMemory(botId: string, playerId: number): BotPlayerMemory | null {
        const key = `${botId}_${playerId}`;
        const memory = this.memories.get(key);
        if (memory) {
            return memory;
        }
        // Return null if no memory exists (don't create it here)
        return null;
    }

    /**
     * Get or create memory (internal use)
     */
    private getOrCreateMemory(botId: string, playerId: number): BotPlayerMemory {
        const key = `${botId}_${playerId}`;
        
        if (!this.memories.has(key)) {
            const now = Date.now();
            this.memories.set(key, {
                playerId,
                conversationHistory: [],
                maxHistorySize: this.maxHistorySize,
                emotions: {
                    botEmotion: {
                        anger: 0,
                        happiness: 50, // Neutral
                        trust: 50,
                        familiarity: 0,
                    },
                    personEmotion: {
                        anger: 0,
                        happiness: 50,
                        trust: 50,
                    },
                    lastEmotionUpdate: now,
                },
                personalInfo: {
                    facts: new Map(),
                    lastInfoUpdate: now,
                },
                relationship: {
                    firstMet: now,
                    lastMet: now,
                    totalConversations: 0,
                    totalMessages: 0,
                    importantEvents: [],
                },
                lastUpdated: now,
                createdAt: now,
            });

            // Cleanup old memories if we exceed limit
            if (this.memories.size > this.maxMemories) {
                this.cleanupOldMemories();
            }
        }

        return this.memories.get(key)!;
    }

    /**
     * Set bot's emotional state (for AI-driven emotions)
     */
    setBotEmotion(botId: string, playerId: number, emotion: Partial<EmotionalState['botEmotion']>): void {
        const memory = this.getOrCreateMemory(botId, playerId);
        memory.emotions.botEmotion = {
            ...memory.emotions.botEmotion,
            ...emotion,
        };
        memory.emotions.lastEmotionUpdate = Date.now();
        memory.lastUpdated = Date.now();
    }

    /**
     * Mark conversation start
     */
    startConversation(botId: string, playerId: number): void {
        const memory = this.getOrCreateMemory(botId, playerId);
        const now = Date.now();

        if (memory.relationship.totalConversations === 0) {
            memory.relationship.firstMet = now;
            this.addImportantEvent(memory, 'first_meeting', 'First conversation with player');
        }

        memory.relationship.totalConversations++;
        memory.relationship.lastMet = now;
        memory.lastUpdated = now;
    }

    /**
     * Get conversation context for AI (formatted for prompt)
     */
    getConversationContext(botId: string, playerId: number): string {
        const memory = this.getMemory(botId, playerId);
        if (!memory) {
            return '';
        }

        const context: string[] = [];

        // Relationship info
        context.push(`Relationship with ${memory.playerName || `person ${playerId}`}:`);
        context.push(`- First met: ${new Date(memory.relationship.firstMet).toLocaleDateString()}`);
        context.push(`- Total conversations: ${memory.relationship.totalConversations}`);
        context.push(`- Total messages: ${memory.relationship.totalMessages}`);

        // Emotional state
        const emotions = memory.emotions;
        context.push(`\nEmotional State:`);
        context.push(`- Bot's feelings: ${this.describeEmotion(emotions.botEmotion)}`);
        context.push(`- Person's feelings (inferred): ${this.describeEmotion(emotions.personEmotion)}`);

        // Personal information
        if (memory.personalInfo.birthday) {
            context.push(`\nPersonal Information:`);
            context.push(`- Birthday: ${memory.personalInfo.birthday}`);
        }
        if (memory.personalInfo.name) {
            context.push(`- Name: ${memory.personalInfo.name}`);
        }
        if (memory.personalInfo.preferences && memory.personalInfo.preferences.length > 0) {
            context.push(`- Preferences: ${memory.personalInfo.preferences.join(', ')}`);
        }

        // Recent conversation history
        const recentHistory = memory.conversationHistory.slice(-10); // Last 10 messages
        if (recentHistory.length > 0) {
            context.push(`\nRecent Conversation:`);
            recentHistory.forEach(msg => {
                const sender = msg.sender === 'bot' ? 'Bot' : 'Person';
                context.push(`${sender}: ${msg.message}`);
            });
        }

        // Important events
        if (memory.relationship.importantEvents.length > 0) {
            context.push(`\nImportant Events:`);
            memory.relationship.importantEvents.slice(-5).forEach(event => {
                context.push(`- ${event.description} (${new Date(event.timestamp).toLocaleDateString()})`);
            });
        }

        return context.join('\n');
    }

    /**
     * Describe emotional state in natural language
     */
    private describeEmotion(emotion: EmotionalState['botEmotion'] | EmotionalState['personEmotion']): string {
        const parts: string[] = [];

        if (emotion.anger > 50) {
            parts.push(`angry (${Math.round(emotion.anger)}%)`);
        }
        if (emotion.happiness > 60) {
            parts.push(`happy (${Math.round(emotion.happiness)}%)`);
        } else if (emotion.happiness < 40) {
            parts.push(`unhappy (${Math.round(emotion.happiness)}%)`);
        }
        if ('familiarity' in emotion && emotion.familiarity > 50) {
            parts.push(`familiar (${Math.round(emotion.familiarity)}%)`);
        }
        if ('trust' in emotion && emotion.trust > 60) {
            parts.push(`trusting (${Math.round(emotion.trust)}%)`);
        } else if ('trust' in emotion && emotion.trust < 40) {
            parts.push(`distrustful (${Math.round(emotion.trust)}%)`);
        }

        return parts.length > 0 ? parts.join(', ') : 'neutral';
    }

    /**
     * Cleanup old memories (LRU eviction)
     */
    private cleanupOldMemories(): void {
        // Sort by lastUpdated, remove oldest
        const sorted = Array.from(this.memories.entries())
            .sort((a, b) => a[1].lastUpdated - b[1].lastUpdated);

        // Remove oldest 10%
        const toRemove = Math.ceil(this.memories.size * 0.1);
        for (let i = 0; i < toRemove; i++) {
            this.memories.delete(sorted[i][0]);
        }
    }

    /**
     * Get all memories for a bot (for persistence)
     */
    getAllMemoriesForBot(botId: string): BotPlayerMemory[] {
        return Array.from(this.memories.values())
            .filter(memory => {
                // Extract botId from key (format: "botId_playerId")
                const key = Array.from(this.memories.entries())
                    .find(([_, mem]) => mem === memory)?.[0];
                return key?.startsWith(`${botId}_`);
            });
    }

    /**
     * Load memories from storage
     */
    loadMemories(botId: string, memories: BotPlayerMemory[]): void {
        for (const memory of memories) {
            const key = `${botId}_${memory.playerId}`;
            this.memories.set(key, memory);
        }
    }

    /**
     * Clear memory for a specific bot-player pair
     */
    clearMemory(botId: string, playerId: number): void {
        const key = `${botId}_${playerId}`;
        this.memories.delete(key);
    }

    /**
     * Clear all memories for a bot
     */
    clearBotMemories(botId: string): void {
        const keysToDelete: string[] = [];
        for (const [key] of this.memories.entries()) {
            if (key.startsWith(`${botId}_`)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.memories.delete(key));
    }
}

