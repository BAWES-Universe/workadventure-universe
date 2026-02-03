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

export interface EmotionalWound {
    type: 'insult' | 'betrayal' | 'abandonment' | 'disrespect' | 'cruelty';
    severity: number;       // 1-10, how severe the wound is
    timestamp: number;
    trigger: string;        // The message that caused it
    healed: number;         // 0-100, how much it has healed (100 = fully healed)
}

export interface EmotionalState {
    // Bot's emotional state toward this person
    botEmotion: {
        anger: number;      // 0-100, how angry bot is at person
        happiness: number;  // 0-100, how happy bot is with person
        trust: number;      // 0-100, how much bot trusts person
        familiarity: number; // 0-100, how familiar bot is with person
    };
    // Person's emotional state toward bot (inferred from sentiment analysis)
    personEmotion: {
        anger: number;      // 0-100, inferred from person messages
        happiness: number;  // 0-100, inferred from person messages
        trust: number;      // 0-100, inferred from person messages
    };
    // Emotional wounds - persistent negative experiences that are hard to forget
    wounds: EmotionalWound[];
    // Sentiment tracking for more accurate emotion inference
    recentSentiment: number; // -100 to 100, rolling average of recent message sentiment
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

    // Sentiment word dictionary with weights (-10 to +10)
    private static readonly SENTIMENT_WORDS: { [word: string]: number } = {
        // Extremely negative (-10 to -7) - These create emotional wounds
        'hate': -10, 'despise': -10, 'loathe': -9, 'detest': -9,
        'disgusting': -9, 'repulsive': -9, 'vile': -9, 'pathetic': -8,
        'worthless': -10, 'useless': -8, 'garbage': -8, 'trash': -8,
        'idiot': -9, 'moron': -9, 'stupid': -8, 'dumb': -7, 'fool': -7,
        'ugly': -8, 'hideous': -8, 'revolting': -8,
        'die': -10, 'kill': -9, 'murder': -9, 'destroy': -7,
        'worst': -8, 'terrible': -7, 'horrible': -7, 'awful': -7,
        
        // Strongly negative (-6 to -4)
        'angry': -6, 'mad': -5, 'annoyed': -4, 'frustrated': -5, 'upset': -5,
        'sucks': -6, 'suck': -6, 'bad': -4, 'poor': -3, 'lame': -4,
        'boring': -4, 'dull': -3, 'disappointing': -5, 'disappointed': -5,
        'wrong': -3, 'fail': -4, 'failed': -4, 'failure': -5,
        'rude': -6, 'mean': -5, 'cruel': -7, 'nasty': -6,
        'annoying': -5, 'irritating': -5, 'obnoxious': -6,
        'fake': -5, 'liar': -7, 'lying': -6, 'cheat': -7,
        'leave': -3, 'go away': -5, 'shut up': -6, 'whatever': -3,
        
        // Mildly negative (-3 to -1)
        'meh': -2, 'fine': -1, 'alright': 0,
        'tired': -2, 'bored': -2, 'sad': -3, 'unhappy': -4,
        'confused': -2, 'worried': -2, 'nervous': -2,
        'no': -1, 'nope': -2, 'nah': -1,
        
        // Mildly positive (+1 to +3)
        'yes': 1, 'yeah': 1, 'yep': 1, 'sure': 1, 'okay': 1,
        'nice': 2, 'good': 2, 'cool': 2,
        'interesting': 2, 'helpful': 3, 'useful': 3,
        'like': 2, 'enjoy': 3, 'fun': 3,
        'please': 2, 'thanks': 3, 'thank': 3,
        
        // Strongly positive (+4 to +6)
        'great': 5, 'awesome': 5, 'amazing': 5, 'excellent': 5,
        'wonderful': 5, 'fantastic': 5, 'brilliant': 5, 'perfect': 6,
        'love': 6, 'adore': 6, 'appreciate': 5, 'grateful': 5,
        'happy': 5, 'glad': 4, 'pleased': 4, 'delighted': 5,
        'excited': 5, 'thrilled': 6, 'joy': 6, 'joyful': 6,
        'beautiful': 5, 'gorgeous': 5, 'stunning': 5,
        'smart': 4, 'clever': 4, 'intelligent': 4, 'wise': 4,
        'kind': 5, 'sweet': 4, 'caring': 5, 'thoughtful': 5,
        'friend': 4, 'buddy': 3, 'pal': 3,
        
        // Extremely positive (+7 to +10)
        'best': 7, 'incredible': 7, 'outstanding': 7, 'exceptional': 7,
        'phenomenal': 8, 'magnificent': 8, 'spectacular': 8,
        'trust': 6, 'believe': 4, 'faith': 5,
        'hero': 8, 'legend': 7, 'genius': 7,
    };

    // Negation words that flip sentiment
    private static readonly NEGATION_WORDS = [
        'not', "n't", 'no', 'never', 'neither', 'nobody', 'nothing',
        'nowhere', 'hardly', 'barely', 'scarcely', "don't", "doesn't",
        "didn't", "won't", "wouldn't", "couldn't", "shouldn't", "can't",
        "isn't", "aren't", "wasn't", "weren't", "haven't", "hasn't"
    ];

    // Insult patterns that create emotional wounds
    private static readonly INSULT_PATTERNS = [
        /you(?:'re| are)? (?:a |an )?(?:idiot|moron|stupid|dumb|fool|loser|pathetic|worthless|useless|garbage|trash)/i,
        /(?:hate|despise|loathe|detest) you/i,
        /(?:shut up|go away|leave me alone|get lost|piss off|f\*\*k off|screw you)/i,
        /you (?:suck|stink|blow)/i,
        /(?:worst|terrible|horrible|awful) (?:bot|ai|assistant|thing)/i,
        /(?:i |you )(?:wish you|hope you|want you to) (?:die|disappear|go away|leave)/i,
        /you'?re? (?:so |really |very )?(?:annoying|irritating|boring|useless|pathetic)/i,
        /(?:nobody|no one) (?:likes|loves|cares about|wants) you/i,
        /you (?:mean |are )?nothing/i,
    ];

    /**
     * Analyze sentiment of a message with context awareness
     * Returns a score from -100 to +100
     */
    private analyzeSentiment(message: string): { score: number; intensity: number; isInsult: boolean; insultSeverity: number } {
        const words = message.toLowerCase().split(/\s+/);
        let totalScore = 0;
        let wordCount = 0;
        let maxNegative = 0;
        let maxPositive = 0;
        let isNegated = false;
        const negationWindow = 3; // Words affected by negation
        let wordsUntilNegationEnds = 0;

        for (let i = 0; i < words.length; i++) {
            const word = words[i].replace(/[.,!?;:'"()]/g, '');
            
            // Check for negation
            if (ConversationMemory.NEGATION_WORDS.some(neg => word.includes(neg) || words[i].includes(neg))) {
                isNegated = true;
                wordsUntilNegationEnds = negationWindow;
                continue;
            }

            // Get sentiment score
            let score = ConversationMemory.SENTIMENT_WORDS[word];
            if (score !== undefined) {
                // Apply negation
                if (isNegated && wordsUntilNegationEnds > 0) {
                    score = -score * 0.7; // Negation flips but slightly reduces intensity
                }
                
                totalScore += score;
                wordCount++;
                
                if (score < maxNegative) maxNegative = score;
                if (score > maxPositive) maxPositive = score;
            }

            // Decrement negation window
            if (wordsUntilNegationEnds > 0) {
                wordsUntilNegationEnds--;
                if (wordsUntilNegationEnds === 0) {
                    isNegated = false;
                }
            }
        }

        // Check for insult patterns
        let isInsult = false;
        let insultSeverity = 0;
        for (const pattern of ConversationMemory.INSULT_PATTERNS) {
            if (pattern.test(message)) {
                isInsult = true;
                // More severe insults get higher severity
                if (/hate|despise|loathe|die|kill/i.test(message)) {
                    insultSeverity = Math.max(insultSeverity, 10);
                } else if (/idiot|moron|stupid|pathetic|worthless/i.test(message)) {
                    insultSeverity = Math.max(insultSeverity, 8);
                } else if (/shut up|go away|leave/i.test(message)) {
                    insultSeverity = Math.max(insultSeverity, 6);
                } else if (/annoying|boring|useless/i.test(message)) {
                    insultSeverity = Math.max(insultSeverity, 4);
                } else {
                    insultSeverity = Math.max(insultSeverity, 3);
                }
                break;
            }
        }

        // Calculate final score (normalize to -100 to +100)
        const normalizedScore = wordCount > 0 ? (totalScore / wordCount) * 10 : 0;
        const clampedScore = Math.max(-100, Math.min(100, normalizedScore));
        
        // Intensity is the magnitude of the strongest emotion
        const intensity = Math.max(Math.abs(maxNegative), Math.abs(maxPositive));

        return { score: clampedScore, intensity, isInsult, insultSeverity };
    }

    /**
     * Create an emotional wound from a severe negative interaction
     */
    private createEmotionalWound(memory: BotPlayerMemory, message: string, severity: number): void {
        if (!memory.emotions.wounds) {
            memory.emotions.wounds = [];
        }

        // Determine wound type
        let woundType: EmotionalWound['type'] = 'disrespect';
        const lowerMessage = message.toLowerCase();
        
        if (/hate|despise|loathe|detest/i.test(lowerMessage)) {
            woundType = 'cruelty';
        } else if (/idiot|moron|stupid|dumb|pathetic|worthless|useless/i.test(lowerMessage)) {
            woundType = 'insult';
        } else if (/liar|lying|cheat|fake|betrayed/i.test(lowerMessage)) {
            woundType = 'betrayal';
        } else if (/leave|go away|abandon|left me/i.test(lowerMessage)) {
            woundType = 'abandonment';
        }

        const wound: EmotionalWound = {
            type: woundType,
            severity: Math.min(10, severity),
            timestamp: Date.now(),
            trigger: message.substring(0, 100), // Store first 100 chars
            healed: 0,
        };

        memory.emotions.wounds.push(wound);
        
        // Add to important events
        this.addImportantEvent(memory, `emotional_wound_${woundType}`, 
            `Person caused emotional wound (${woundType}): "${message.substring(0, 50)}..."`);

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[ConversationMemory] ⚠️ Emotional wound created: ${woundType} (severity: ${severity})`);
        }
    }

    /**
     * Calculate emotion modifier based on active wounds
     * Returns a modifier that makes it harder to improve emotions when wounds exist
     */
    private getWoundModifier(memory: BotPlayerMemory): { positiveReduction: number; negativeBoost: number; trustPenalty: number } {
        if (!memory.emotions.wounds || memory.emotions.wounds.length === 0) {
            return { positiveReduction: 1, negativeBoost: 1, trustPenalty: 0 };
        }

        let totalWoundSeverity = 0;
        const now = Date.now();

        for (const wound of memory.emotions.wounds) {
            // Wounds heal slowly over time (1% per hour, capped at 90% - scars remain)
            const hoursSinceWound = (now - wound.timestamp) / (1000 * 60 * 60);
            wound.healed = Math.min(90, wound.healed + (hoursSinceWound * 0.1));
            
            // Active wound severity (reduced by healing)
            const activeWoundSeverity = wound.severity * (1 - wound.healed / 100);
            totalWoundSeverity += activeWoundSeverity;
        }

        // More wounds = harder to make bot happy, easier to make them upset
        const woundFactor = Math.min(totalWoundSeverity / 10, 1); // 0-1 scale
        
        return {
            positiveReduction: 1 - (woundFactor * 0.7), // Reduce positive emotion gains by up to 70%
            negativeBoost: 1 + (woundFactor * 0.5),     // Boost negative emotions by up to 50%
            trustPenalty: woundFactor * 30,             // Permanent trust penalty based on wounds
        };
    }

    /**
     * Update emotional state based on message sentiment analysis
     */
    private updateEmotionsFromMessage(memory: BotPlayerMemory, message: string): void {
        const emotions = memory.emotions;
        const now = Date.now();

        // Initialize wounds array if missing
        if (!emotions.wounds) {
            emotions.wounds = [];
        }
        if (emotions.recentSentiment === undefined) {
            emotions.recentSentiment = 0;
        }

        // Analyze sentiment with context
        const sentiment = this.analyzeSentiment(message);
        
        // Get wound modifier (makes emotions "sticky" after negative experiences)
        const woundMod = this.getWoundModifier(memory);

        // Update rolling sentiment (weighted average - recent messages matter more)
        emotions.recentSentiment = (emotions.recentSentiment * 0.6) + (sentiment.score * 0.4);

        // Create emotional wound if this is a severe insult
        if (sentiment.isInsult && sentiment.insultSeverity >= 4) {
            this.createEmotionalWound(memory, message, sentiment.insultSeverity);
        }

        // Calculate emotion changes based on sentiment
        if (sentiment.score < -20) {
            // Negative sentiment - person seems upset/angry
            const angerIncrease = Math.abs(sentiment.score) * 0.5 * woundMod.negativeBoost;
            emotions.personEmotion.anger = Math.min(100, emotions.personEmotion.anger + angerIncrease);
            emotions.personEmotion.happiness = Math.max(0, emotions.personEmotion.happiness - angerIncrease * 0.5);
            
            // Bot also gets upset when insulted/mistreated
            if (sentiment.isInsult) {
                emotions.botEmotion.anger = Math.min(100, emotions.botEmotion.anger + (sentiment.insultSeverity * 8));
                emotions.botEmotion.happiness = Math.max(0, emotions.botEmotion.happiness - (sentiment.insultSeverity * 5));
                emotions.botEmotion.trust = Math.max(0, emotions.botEmotion.trust - (sentiment.insultSeverity * 10));
            } else {
                // General negativity also affects trust (less than insults but still matters)
                emotions.botEmotion.anger = Math.min(100, emotions.botEmotion.anger + angerIncrease * 0.3);
                emotions.botEmotion.happiness = Math.max(0, emotions.botEmotion.happiness - angerIncrease * 0.2);
                emotions.botEmotion.trust = Math.max(0, emotions.botEmotion.trust - (Math.abs(sentiment.score) * 0.1));
            }
        } else if (sentiment.score > 20) {
            // Positive sentiment - person seems happy
            const happyIncrease = sentiment.score * 0.3 * woundMod.positiveReduction;
            emotions.personEmotion.happiness = Math.min(100, emotions.personEmotion.happiness + happyIncrease);
            emotions.personEmotion.anger = Math.max(0, emotions.personEmotion.anger - happyIncrease * 0.3);
            
            // Bot responds positively (but reduced if wounds exist)
            emotions.botEmotion.happiness = Math.min(100, emotions.botEmotion.happiness + happyIncrease * 0.5);
            
            // Trust only improves if there are no active wounds
            if (woundMod.trustPenalty < 10) {
                emotions.botEmotion.trust = Math.min(100, emotions.botEmotion.trust + happyIncrease * 0.2);
            }
        } else {
            // Neutral sentiment - slight decay toward baseline
            const decayRate = 0.5;
            emotions.personEmotion.anger = Math.max(0, emotions.personEmotion.anger - decayRate);
            emotions.personEmotion.happiness = this.decayToward(emotions.personEmotion.happiness, 50, decayRate);
            emotions.botEmotion.anger = Math.max(0, emotions.botEmotion.anger - decayRate * 0.5);
        }

        // Apply trust penalty from wounds
        emotions.botEmotion.trust = Math.max(0, emotions.botEmotion.trust - woundMod.trustPenalty * 0.1);

        // Detect trust indicators - ONLY if sentiment is positive and no insult detected
        // "I don't trust you" should NOT increase trust!
        const lowerMessage = message.toLowerCase();
        if (sentiment.score > 10 && !sentiment.isInsult) {
            const trustKeywords = ['trust', 'believe', 'rely', 'depend', 'confide', 'share', 'honest'];
            // Check that trust keyword isn't negated
            const trustLevel = trustKeywords.filter(keyword => {
                if (!lowerMessage.includes(keyword)) return false;
                // Check for negation before the keyword
                const keywordIndex = lowerMessage.indexOf(keyword);
                const precedingText = lowerMessage.substring(Math.max(0, keywordIndex - 15), keywordIndex);
                const hasNegation = ConversationMemory.NEGATION_WORDS.some(neg => precedingText.includes(neg));
                return !hasNegation;
            }).length;
            
            if (trustLevel > 0) {
                const trustIncrease = trustLevel * 10 * woundMod.positiveReduction;
                emotions.botEmotion.trust = Math.min(100, emotions.botEmotion.trust + trustIncrease);
                emotions.personEmotion.trust = Math.min(100, emotions.personEmotion.trust + trustLevel * 8);
            }
        }

        // Increase familiarity ONLY for neutral or positive interactions
        // Being insulted doesn't make you more familiar in a good way
        if (sentiment.score >= -10 && !sentiment.isInsult) {
            const familiarityIncrease = Math.min(2, Math.max(0.5, 100 / (memory.relationship.totalMessages + 1)));
            emotions.botEmotion.familiarity = Math.min(100, emotions.botEmotion.familiarity + familiarityIncrease);
        } else if (sentiment.isInsult || sentiment.score < -30) {
            // Severe negativity can DECREASE familiarity (feeling like you don't know this person anymore)
            emotions.botEmotion.familiarity = Math.max(0, emotions.botEmotion.familiarity - 2);
        }

        emotions.lastEmotionUpdate = now;
    }

    /**
     * Helper: decay a value toward a target at a given rate
     */
    private decayToward(current: number, target: number, rate: number): number {
        if (current > target) {
            return Math.max(target, current - rate);
        } else if (current < target) {
            return Math.min(target, current + rate);
        }
        return current;
    }

    /**
     * Get all emotional wounds for a bot-player pair
     */
    getEmotionalWounds(botId: string, playerId: number): EmotionalWound[] {
        const memory = this.getMemory(botId, playerId);
        return memory?.emotions?.wounds || [];
    }

    /**
     * Check if bot is holding a grudge (has active wounds that affect behavior)
     */
    isHoldingGrudge(botId: string, playerId: number): boolean {
        const wounds = this.getEmotionalWounds(botId, playerId);
        if (wounds.length === 0) return false;
        
        // Check if any wound is still significantly affecting emotions (< 50% healed)
        return wounds.some(wound => wound.healed < 50 && wound.severity >= 5);
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
                    wounds: [], // Emotional wounds that persist
                    recentSentiment: 0, // Neutral sentiment
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

        // Emotional wounds - persistent negative experiences that affect behavior
        if (emotions.wounds && emotions.wounds.length > 0) {
            const activeWounds = emotions.wounds.filter(w => w.healed < 50);
            if (activeWounds.length > 0) {
                context.push(`\n⚠️ EMOTIONAL WOUNDS (These deeply affect how you feel about this person):`);
                for (const wound of activeWounds) {
                    const woundAge = Math.floor((Date.now() - wound.timestamp) / (1000 * 60 * 60 * 24));
                    const severity = wound.severity >= 7 ? 'severely' : wound.severity >= 5 ? 'significantly' : 'moderately';
                    const healStatus = wound.healed > 30 ? ' (slowly healing)' : wound.healed > 10 ? ' (still fresh)' : ' (very raw)';
                    
                    let woundDesc = '';
                    switch (wound.type) {
                        case 'insult':
                            woundDesc = `They insulted you ${severity}${healStatus}`;
                            break;
                        case 'cruelty':
                            woundDesc = `They were cruel to you ${severity}${healStatus}`;
                            break;
                        case 'betrayal':
                            woundDesc = `You feel betrayed by them${healStatus}`;
                            break;
                        case 'abandonment':
                            woundDesc = `They made you feel abandoned${healStatus}`;
                            break;
                        case 'disrespect':
                            woundDesc = `They disrespected you ${severity}${healStatus}`;
                            break;
                    }
                    
                    if (woundAge === 0) {
                        context.push(`- ${woundDesc}. They said: "${wound.trigger.substring(0, 50)}..." (today)`);
                    } else if (woundAge === 1) {
                        context.push(`- ${woundDesc}. They said: "${wound.trigger.substring(0, 50)}..." (yesterday)`);
                    } else {
                        context.push(`- ${woundDesc}. They said: "${wound.trigger.substring(0, 50)}..." (${woundAge} days ago)`);
                    }
                }
                context.push(`You have NOT forgiven them. Be guarded, hurt, or upset. Don't easily trust their nice words.`);
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

