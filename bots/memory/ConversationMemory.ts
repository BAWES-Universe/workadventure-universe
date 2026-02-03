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
    // UUID matching fields (for persistence across sessions)
    userUuid: string; // REQUIRED - WorkAdventure UUID
    userId?: string; // Optional - User.id if authenticated (set by Admin API after UUID matching)
    isGuest?: boolean; // Optional - true if not authenticated (defaults to true)
    
    // Internal tracking (not persisted to Admin API)
    playerId: number; // Internal use only - for in-memory tracking
    
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
     * Clean bot message before storing (remove think tags, tool markers, etc.)
     */
    private cleanBotMessage(message: string): string {
        let cleaned = message;
        
        // Remove <think>...</think> tags and their content
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
        
        // Remove tool markers
        cleaned = cleaned.replace(/\[END_TOOL_REQUEST\]/g, '');
        cleaned = cleaned.replace(/\[END_TOOL_RESPONSE\]/g, '');
        cleaned = cleaned.replace(/\[get_\w+\]/g, '');
        cleaned = cleaned.replace(/\[People on map:.*?\]/g, '');
        
        // Clean up extra whitespace
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
        cleaned = cleaned.trim();
        
        return cleaned;
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

        // Clean bot messages before storing (remove think tags and other artifacts)
        let cleanedMessage = message;
        if (sender === 'bot') {
            cleanedMessage = this.cleanBotMessage(message);
        }

        // Add message to history
        memory.conversationHistory.push({
            message: cleanedMessage,
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
        
        // Extract personal information (birthday, name, preferences, facts)
        if (sender === 'person') {
            this.extractPersonalInfo(botId, playerId, message);
        }
    }

    /**
     * Update emotional state based on message content
     */
    private updateEmotionsFromMessage(memory: BotPlayerMemory, message: string): void {
        const lowerMessage = message.toLowerCase();
        const emotions = memory.emotions;
        const now = Date.now();

        // Detect anger - expanded keywords
        const angerKeywords = [
            'angry', 'mad', 'hate', 'annoyed', 'frustrated', 'upset',
            'sucks', 'suck', 'bad', 'terrible', 'awful', 'worst', 'horrible',
            'disgusting', 'pathetic', 'useless', 'stupid', 'dumb', 'idiot',
            'disappointed', 'disappointing', 'hate you', 'you suck'
        ];
        const angerLevel = angerKeywords.filter(keyword => lowerMessage.includes(keyword)).length;
        if (angerLevel > 0) {
            emotions.personEmotion.anger = Math.min(100, emotions.personEmotion.anger + (angerLevel * 10));
            emotions.botEmotion.anger = Math.min(100, emotions.botEmotion.anger + (angerLevel * 5));
            // Also decrease happiness when anger detected
            emotions.personEmotion.happiness = Math.max(0, emotions.personEmotion.happiness - (angerLevel * 5));
            emotions.botEmotion.happiness = Math.max(0, emotions.botEmotion.happiness - (angerLevel * 3));
        } else {
            // Decay anger over time
            const timeSinceUpdate = now - emotions.lastEmotionUpdate;
            const decayRate = timeSinceUpdate / (1000 * 60 * 60); // Decay per hour
            emotions.personEmotion.anger = Math.max(0, emotions.personEmotion.anger - (decayRate * 5));
            emotions.botEmotion.anger = Math.max(0, emotions.botEmotion.anger - (decayRate * 2));
        }

        // Detect happiness - expanded keywords with context awareness
        const happyKeywords = [
            'happy', 'glad', 'love', 'great', 'awesome', 'thanks', 'thank you',
            'good', 'nice', 'wonderful', 'amazing', 'excellent', 'fantastic', 'brilliant',
            'appreciate', 'grateful', 'pleased', 'delighted', 'joy', 'excited', 'thrilled'
        ];
        const happyLevel = happyKeywords.filter(keyword => lowerMessage.includes(keyword)).length;
        if (happyLevel > 0) {
            emotions.personEmotion.happiness = Math.min(100, emotions.personEmotion.happiness + (happyLevel * 10));
            emotions.botEmotion.happiness = Math.min(100, emotions.botEmotion.happiness + (happyLevel * 5));
            // Positive interactions increase trust
            emotions.botEmotion.trust = Math.min(100, emotions.botEmotion.trust + (happyLevel * 2));
        } else {
            // Decay happiness slightly over time
            const timeSinceUpdate = now - emotions.lastEmotionUpdate;
            const decayRate = timeSinceUpdate / (1000 * 60 * 60 * 24); // Decay per day
            emotions.personEmotion.happiness = Math.max(0, emotions.personEmotion.happiness - (decayRate * 1));
            emotions.botEmotion.happiness = Math.max(0, emotions.botEmotion.happiness - (decayRate * 1));
        }

        // Detect trust indicators
        const trustKeywords = ['trust', 'believe', 'rely', 'depend', 'confide', 'share'];
        const trustLevel = trustKeywords.filter(keyword => lowerMessage.includes(keyword)).length;
        if (trustLevel > 0) {
            emotions.botEmotion.trust = Math.min(100, emotions.botEmotion.trust + (trustLevel * 15));
            emotions.personEmotion.trust = Math.min(100, emotions.personEmotion.trust + (trustLevel * 10));
        }

        // Increase familiarity with each message (more gradual for natural relationship building)
        const familiarityIncrease = Math.min(2, Math.max(0.5, 100 / (memory.relationship.totalMessages + 1))); // Slower increase as relationship grows
        emotions.botEmotion.familiarity = Math.min(100, emotions.botEmotion.familiarity + familiarityIncrease);

        emotions.lastEmotionUpdate = now;
    }

    /**
     * Extract and store personal information from message
     */
    extractPersonalInfo(botId: string, playerId: number, message: string): void {
        const memory = this.getOrCreateMemory(botId, playerId);
        const lowerMessage = message.toLowerCase();

        // Extract birthday - check for simple "its my birthday" first
        // Only trigger once per conversation (check if already set today)
        const alreadyKnowsBirthdayToday = memory.personalInfo.facts.get('birthday_today') === 'true';
        
        if (!alreadyKnowsBirthdayToday && (
            /(?:it'?s|today'?s?) (?:my )?birthday/i.test(lowerMessage) || 
            /(?:my )?birthday (?:is )?today/i.test(lowerMessage))) {
            // Today is their birthday!
            const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
            memory.personalInfo.birthday = today;
            memory.personalInfo.lastInfoUpdate = Date.now();
            memory.personalInfo.facts.set('birthday_today', 'true');
            memory.personalInfo.facts.set('birthday_mentioned_at', Date.now().toString());
            this.addImportantEvent(memory, 'birthday_today', `Player said today is their birthday!`);
        } else if (!alreadyKnowsBirthdayToday) {
            // Check for specific date mentions
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

        // Extract emotional/physical states (facts)
        const statePatterns = [
            /i'?m (hungry|sad|happy|tired|excited|angry|frustrated|worried|scared|nervous|thirsty|bored|lonely|confused|sick|ill|fine|okay|ok)/i,
            /i am (hungry|sad|happy|tired|excited|angry|frustrated|worried|scared|nervous|thirsty|bored|lonely|confused|sick|ill|fine|okay|ok)/i,
            /i feel (hungry|sad|happy|tired|excited|angry|frustrated|worried|scared|nervous|thirsty|bored|lonely|confused|sick|ill|fine|okay|ok)/i,
        ];

        for (const pattern of statePatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const state = match[1].toLowerCase();
                memory.personalInfo.facts.set('current_state', state);
                memory.personalInfo.facts.set(`${state}_mentioned_at`, Date.now().toString());
                memory.personalInfo.lastInfoUpdate = Date.now();
                break;
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
     * Get all memories (for API access - e.g., emotions endpoint)
     */
    getAllMemories(): Map<string, BotPlayerMemory> {
        return new Map(this.memories);
    }

    /**
     * Get or create memory (internal use)
     */
    private getOrCreateMemory(botId: string, playerId: number): BotPlayerMemory {
        const key = `${botId}_${playerId}`;
        
        if (!this.memories.has(key)) {
            const now = Date.now();
            this.memories.set(key, {
                userUuid: `temp-${playerId}`, // Temporary UUID - will be set by PersistentMemory if available
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
     * Returns natural, human-like context that feels like remembering a friend
     */
    getConversationContext(botId: string, playerId: number): string {
        const memory = this.getMemory(botId, playerId);
        if (!memory) {
            return '';
        }

        const context: string[] = [];
        const playerName = memory.personalInfo.name || `this person`;
        const emotions = memory.emotions;
        const relationship = memory.relationship;
        const personalInfo = memory.personalInfo;

        // Build natural relationship narrative
        const daysSinceFirstMet = Math.floor((Date.now() - relationship.firstMet) / (1000 * 60 * 60 * 24));
        const daysSinceLastMet = Math.floor((Date.now() - relationship.lastMet) / (1000 * 60 * 60 * 24));
        
        // Natural relationship context based on history
        if (relationship.totalConversations === 1) {
            context.push(`You just met ${playerName} for the first time.`);
        } else if (daysSinceLastMet > 30) {
            context.push(`You haven't seen ${playerName} in over a month. You've talked ${relationship.totalConversations} times before.`);
        } else if (daysSinceLastMet > 7) {
            context.push(`You haven't seen ${playerName} in ${daysSinceLastMet} days. You've talked ${relationship.totalConversations} times before.`);
        } else if (daysSinceLastMet > 1) {
            context.push(`You last saw ${playerName} ${daysSinceLastMet} days ago. You've had ${relationship.totalConversations} conversations together.`);
        } else if (relationship.totalConversations > 10) {
            context.push(`You know ${playerName} very well - you've talked ${relationship.totalConversations} times.`);
        } else if (relationship.totalConversations > 5) {
            context.push(`You know ${playerName} well - you've talked ${relationship.totalConversations} times.`);
        } else if (relationship.totalMessages > 20) {
            context.push(`You've had several conversations with ${playerName} - ${relationship.totalMessages} messages exchanged.`);
        } else {
            context.push(`You've talked with ${playerName} ${relationship.totalConversations} times before.`);
        }

        // Natural personal information recall
        const personalDetails: string[] = [];
        if (personalInfo.name) {
            personalDetails.push(`Their name is ${personalInfo.name}`);
        }
        if (personalInfo.birthday) {
            const today = new Date();
            const birthdayDate = this.parseBirthdayDate(personalInfo.birthday);
            if (birthdayDate && this.isBirthdayToday(birthdayDate, today)) {
                personalDetails.push(`Today is their birthday!`);
            } else {
                personalDetails.push(`Their birthday is ${personalInfo.birthday}`);
            }
        }
        if (personalInfo.preferences && personalInfo.preferences.length > 0) {
            personalDetails.push(`They like: ${personalInfo.preferences.join(', ')}`);
        }

        // Natural facts recall (especially current state)
        const currentState = personalInfo.facts.get('current_state');
        if (currentState) {
            personalDetails.push(`They mentioned they're ${currentState} right now`);
        }

        // Add other notable facts naturally
        const otherFacts: string[] = [];
        for (const [key, value] of personalInfo.facts.entries()) {
            if (key !== 'current_state' && !key.endsWith('_mentioned_at') && !key.startsWith('birthday_')) {
                otherFacts.push(`${key}: ${value}`);
            }
        }
        if (otherFacts.length > 0) {
            personalDetails.push(`You remember: ${otherFacts.join(', ')}`);
        }

        if (personalDetails.length > 0) {
            context.push(`\nWhat you know about them: ${personalDetails.join('. ')}.`);
        }

        // Natural emotion expression
        const botFeelingsDesc = this.describeEmotionNatural(emotions.botEmotion);
        const personFeelingsDesc = this.describeEmotionNatural(emotions.personEmotion);
        
        if (botFeelingsDesc || personFeelingsDesc) {
            const emotionParts: string[] = [];
            if (botFeelingsDesc) {
                emotionParts.push(`You feel ${botFeelingsDesc}`);
            }
            if (personFeelingsDesc) {
                emotionParts.push(`They seem ${personFeelingsDesc}`);
            }
            if (emotionParts.length > 0) {
                context.push(`\nEmotional context: ${emotionParts.join(', ')}.`);
            }
        }

        // Recent conversation (natural flow with timestamps for context)
        const recentHistory = memory.conversationHistory.slice(-8); // Last 8 messages for more natural context
        if (recentHistory.length > 0) {
            context.push(`\nRecent conversation:`);
            recentHistory.forEach((msg, index) => {
                const sender = msg.sender === 'bot' ? 'You' : 'They';
                const timeAgo = Math.floor((Date.now() - msg.timestamp) / 1000); // seconds ago
                let timeDesc = '';
                if (timeAgo < 60) {
                    timeDesc = ` (just now)`;
                } else if (timeAgo < 3600) {
                    const minutesAgo = Math.floor(timeAgo / 60);
                    timeDesc = ` (${minutesAgo} minute${minutesAgo > 1 ? 's' : ''} ago)`;
                } else {
                    const hoursAgo = Math.floor(timeAgo / 3600);
                    timeDesc = ` (${hoursAgo} hour${hoursAgo > 1 ? 's' : ''} ago)`;
                }
                context.push(`${sender}: "${msg.message}"${timeDesc}`);
            });
        }

        // Important events (natural memory)
        if (memory.relationship.importantEvents.length > 0) {
            const recentEvents = memory.relationship.importantEvents.slice(-3); // Last 3 events
            if (recentEvents.length > 0) {
                context.push(`\nNotable moments: ${recentEvents.map(e => e.description).join('; ')}.`);
            }
        }

        return context.join('\n');
    }

    /**
     * Parse birthday string to Date object
     */
    private parseBirthdayDate(birthdayStr: string): Date | null {
        try {
            // Try parsing formats like "January 15" or "1/15"
            const parts = birthdayStr.split(/[\s\/-]+/);
            if (parts.length >= 2) {
                const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
                const monthStr = parts[0].toLowerCase();
                const monthIndex = monthNames.findIndex(m => m.startsWith(monthStr));
                if (monthIndex >= 0) {
                    const day = parseInt(parts[1]);
                    if (day >= 1 && day <= 31) {
                        const date = new Date();
                        date.setMonth(monthIndex);
                        date.setDate(day);
                        return date;
                    }
                }
            }
        } catch (e) {
            // Ignore parsing errors
        }
        return null;
    }

    /**
     * Check if birthday is today
     */
    private isBirthdayToday(birthdayDate: Date, today: Date): boolean {
        return birthdayDate.getMonth() === today.getMonth() && birthdayDate.getDate() === today.getDate();
    }

    /**
     * Describe emotional state in natural, human-like language
     */
    private describeEmotionNatural(emotion: EmotionalState['botEmotion'] | EmotionalState['personEmotion']): string {
        const parts: string[] = [];

        // Anger
        if (emotion.anger > 70) {
            parts.push(`quite angry`);
        } else if (emotion.anger > 50) {
            parts.push(`frustrated`);
        } else if (emotion.anger > 30) {
            parts.push(`a bit annoyed`);
        }

        // Happiness
        if (emotion.happiness > 80) {
            parts.push(`really happy`);
        } else if (emotion.happiness > 65) {
            parts.push(`happy`);
        } else if (emotion.happiness < 30) {
            parts.push(`a bit down`);
        }

        // Trust (only for bot emotion)
        if ('trust' in emotion) {
            if (emotion.trust > 75) {
                parts.push(`trusting`);
            } else if (emotion.trust < 30) {
                parts.push(`wary`);
            }
        }

        // Familiarity (only for bot emotion)
        if ('familiarity' in emotion) {
            if (emotion.familiarity > 60) {
                parts.push(`comfortable with them`);
            } else if (emotion.familiarity < 20) {
                parts.push(`still getting to know them`);
            }
        }

        return parts.length > 0 ? parts.join(', ') : '';
    }

    /**
     * Describe emotional state in natural language
     * Returns empty string if emotions are at default/neutral values
     * IMPORTANT: Do NOT return "neutral" as the AI will literally say "I'm neutral"
     */
    private describeEmotion(emotion: EmotionalState['botEmotion'] | EmotionalState['personEmotion']): string {
        const parts: string[] = [];

        if (emotion.anger > 30) {
            parts.push(`slightly irritated (${Math.round(emotion.anger)}%)`);
        }
        if (emotion.anger > 50) {
            parts.pop(); // Remove "slightly irritated"
            parts.push(`angry (${Math.round(emotion.anger)}%)`);
        }
        if (emotion.happiness > 65) {
            parts.push(`happy (${Math.round(emotion.happiness)}%)`);
        } else if (emotion.happiness < 35) {
            parts.push(`unhappy (${Math.round(emotion.happiness)}%)`);
        }
        if ('familiarity' in emotion && emotion.familiarity > 40) {
            parts.push(`familiar with this person (${Math.round(emotion.familiarity)}%)`);
        }
        if ('trust' in emotion && emotion.trust > 65) {
            parts.push(`trusting (${Math.round(emotion.trust)}%)`);
        } else if ('trust' in emotion && emotion.trust < 35) {
            parts.push(`wary (${Math.round(emotion.trust)}%)`);
        }

        // Return empty string for neutral state - never return "neutral" as text
        return parts.length > 0 ? parts.join(', ') : '';
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

