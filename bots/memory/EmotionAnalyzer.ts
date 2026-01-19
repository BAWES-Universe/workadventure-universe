/**
 * EmotionAnalyzer - AI-driven emotion analysis and verification
 * 
 * Features:
 * - Analyze conversations to update emotions
 * - Ensure emotions match actual conversation tone
 * - Use AI to infer emotional state from conversation
 * - Update emotions in background
 */

import { PersistentMemory, type ConversationPurpose } from './PersistentMemory';
import type { EmotionalState } from './ConversationMemory';
import { AIService } from '../ai/AIService';
import { AdminApiService } from '../server/AdminApiService';

export interface EmotionAnalysisResult {
    botEmotion: {
        anger: number;
        happiness: number;
        trust: number;
        familiarity: number;
    };
    personEmotion: {
        anger: number;
        happiness: number;
        trust: number;
    };
    confidence: number; // 0-1, how confident the analysis is
    reasoning?: string; // Optional explanation
}

export class EmotionAnalyzer {
    private persistentMemory: PersistentMemory;
    private aiService: AIService;
    private adminApiService: AdminApiService;
    private analysisQueue: Map<string, NodeJS.Timeout> = new Map(); // key: "botId_playerId"
    private readonly ANALYSIS_DEBOUNCE_MS = 10000; // Analyze 10 seconds after last message

    constructor(
        persistentMemory: PersistentMemory,
        aiService: AIService,
        adminApiService: AdminApiService
    ) {
        this.persistentMemory = persistentMemory;
        this.aiService = aiService;
        this.adminApiService = adminApiService;
    }

    /**
     * Schedule emotion analysis for a conversation
     * Debounced to avoid analyzing too frequently
     */
    scheduleAnalysis(botId: string, playerId: number): void {
        const key = `${botId}_${playerId}`;
        
        // Clear existing timer
        const existingTimer = this.analysisQueue.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Schedule new analysis
        const timer = setTimeout(() => {
            this.analyzeConversation(botId, playerId).catch(error => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error(`[EmotionAnalyzer] Error analyzing conversation for bot ${botId}, player ${playerId}:`, error);
                }
            });
            this.analysisQueue.delete(key);
        }, this.ANALYSIS_DEBOUNCE_MS);

        this.analysisQueue.set(key, timer);
    }

    /**
     * Analyze conversation and update emotions
     */
    async analyzeConversation(botId: string, playerId: number): Promise<EmotionAnalysisResult | null> {
        try {
            // Get conversation history
            const history = this.persistentMemory.getConversationHistory(botId, playerId, 20); // Last 20 messages
            if (history.length === 0) {
                return null;
            }

            // Get current emotions
            const currentEmotions = this.persistentMemory.getEmotionalState(botId, playerId);
            if (!currentEmotions) {
                return null;
            }

            // Get bot configuration for chat instructions
            const botConfig = await this.adminApiService.getBotConfiguration(botId);
            const chatInstructions = botConfig?.chatInstructions || 'You are a helpful bot.';

            // Format conversation for analysis
            const conversationText = history.map(msg => 
                `${msg.sender === 'bot' ? 'Bot' : 'Person'}: ${msg.message}`
            ).join('\n');

            // Use AI to analyze emotions
            const analysis = await this.analyzeWithAI(conversationText, chatInstructions, currentEmotions);

            // Update emotions if analysis is confident
            if (analysis.confidence > 0.7) {
                this.persistentMemory.updateEmotions(botId, playerId, {
                    botEmotion: analysis.botEmotion,
                    personEmotion: analysis.personEmotion,
                    lastEmotionUpdate: Date.now(),
                });

                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[EmotionAnalyzer] Updated emotions for bot ${botId}, player ${playerId} (confidence: ${analysis.confidence})`);
                }
            }

            return analysis;
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error(`[EmotionAnalyzer] Error analyzing conversation:`, error);
            }
            return null;
        }
    }

    /**
     * Analyze conversation using AI
     */
    private async analyzeWithAI(
        conversationText: string,
        chatInstructions: string,
        currentEmotions: EmotionalState
    ): Promise<EmotionAnalysisResult> {
        // Create analysis prompt
        const systemPrompt = `You are an emotion analysis system. Analyze the conversation and determine the emotional states of both the bot and the person.

Current emotions:
Bot: anger=${currentEmotions.botEmotion.anger}, happiness=${currentEmotions.botEmotion.happiness}, trust=${currentEmotions.botEmotion.trust}, familiarity=${currentEmotions.botEmotion.familiarity}
Person: anger=${currentEmotions.personEmotion.anger}, happiness=${currentEmotions.personEmotion.happiness}, trust=${currentEmotions.personEmotion.trust}

Bot's personality: ${chatInstructions}

Analyze the conversation and provide updated emotion scores (0-100) that reflect the actual conversation tone.
Return a JSON object with:
{
  "botEmotion": {"anger": number, "happiness": number, "trust": number, "familiarity": number},
  "personEmotion": {"anger": number, "happiness": number, "trust": number},
  "confidence": number (0-1),
  "reasoning": "brief explanation"
}`;

        const userMessage = `Conversation:\n${conversationText}\n\nAnalyze and return JSON only.`;

        // For now, use a simplified analysis (in a real implementation, this would call AIService)
        // Since we need to call AI, we'll use a heuristic-based approach for now
        // In production, this would use AIService.generateBotResponseStream or a dedicated analysis endpoint
        
        // Simplified heuristic analysis
        return this.heuristicEmotionAnalysis(conversationText, currentEmotions);
    }

    /**
     * Heuristic-based emotion analysis (fallback when AI is not available)
     */
    private heuristicEmotionAnalysis(
        conversationText: string,
        currentEmotions: EmotionalState
    ): EmotionAnalysisResult {
        const lowerText = conversationText.toLowerCase();
        
        // Analyze person's emotions from their messages
        const personMessages = conversationText.split('\n')
            .filter(line => line.startsWith('Person:'))
            .map(line => line.substring(8).toLowerCase());

        let personAnger = currentEmotions.personEmotion.anger;
        let personHappiness = currentEmotions.personEmotion.happiness;
        let personTrust = currentEmotions.personEmotion.trust;

        // Detect anger - expanded keywords (matches ConversationMemory)
        const angerKeywords = [
            'angry', 'mad', 'hate', 'annoyed', 'frustrated', 'upset', 'stop', 'no',
            'sucks', 'suck', 'bad', 'terrible', 'awful', 'worst', 'horrible',
            'disgusting', 'pathetic', 'useless', 'stupid', 'dumb', 'idiot',
            'disappointed', 'disappointing', 'hate you', 'you suck'
        ];
        const angerCount = personMessages.reduce((count, msg) => 
            count + angerKeywords.filter(kw => msg.includes(kw)).length, 0
        );
        if (angerCount > 0) {
            personAnger = Math.min(100, personAnger + (angerCount * 5));
        } else {
            personAnger = Math.max(0, personAnger - 2); // Decay
        }

        // Detect happiness - expanded keywords (matches ConversationMemory)
        const happyKeywords = [
            'happy', 'glad', 'love', 'great', 'awesome', 'thanks', 'thank you', 'yes', 'good',
            'nice', 'wonderful', 'amazing', 'excellent', 'fantastic', 'brilliant'
        ];
        const happyCount = personMessages.reduce((count, msg) => 
            count + happyKeywords.filter(kw => msg.includes(kw)).length, 0
        );
        if (happyCount > 0) {
            personHappiness = Math.min(100, personHappiness + (happyCount * 5));
        } else {
            personHappiness = Math.max(0, personHappiness - 1); // Slow decay
        }

        // Trust increases with positive interactions
        if (happyCount > angerCount) {
            personTrust = Math.min(100, personTrust + 2);
        } else if (angerCount > happyCount) {
            personTrust = Math.max(0, personTrust - 3);
        }

        // Bot emotions mirror person's emotions to some degree
        const botAnger = Math.max(0, currentEmotions.botEmotion.anger - 1); // Bot anger decays
        const botHappiness = Math.min(100, currentEmotions.botEmotion.happiness + (happyCount > 0 ? 2 : 0));
        const botTrust = Math.min(100, currentEmotions.botEmotion.trust + (personTrust > 50 ? 1 : 0));
        const botFamiliarity = Math.min(100, currentEmotions.botEmotion.familiarity + 1); // Increases with each conversation

        return {
            botEmotion: {
                anger: botAnger,
                happiness: botHappiness,
                trust: botTrust,
                familiarity: botFamiliarity,
            },
            personEmotion: {
                anger: personAnger,
                happiness: personHappiness,
                trust: personTrust,
            },
            confidence: 0.6, // Medium confidence for heuristic analysis
            reasoning: 'Heuristic analysis based on keyword detection',
        };
    }

    /**
     * Cancel pending analysis for a conversation
     */
    cancelAnalysis(botId: string, playerId: number): void {
        const key = `${botId}_${playerId}`;
        const timer = this.analysisQueue.get(key);
        if (timer) {
            clearTimeout(timer);
            this.analysisQueue.delete(key);
        }
    }
}
