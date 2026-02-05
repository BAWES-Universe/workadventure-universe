/**
 * PurposeDetector - Categorizes conversations using AI
 * 
 * Features:
 * - Categorize conversations: navigation, information, social, support, entertainment
 * - Track purpose distribution per bot
 * - Update memory with purpose tags
 */

import { PersistentMemory, type ConversationPurpose } from '../memory/PersistentMemory';
import { AIService } from '../ai/AIService';

export class PurposeDetector {
    private persistentMemory: PersistentMemory;
    private aiService: AIService;

    constructor(persistentMemory: PersistentMemory, aiService: AIService) {
        this.persistentMemory = persistentMemory;
        this.aiService = aiService;
    }

    /**
     * Detect conversation purpose
     */
    async detectPurpose(
        botId: string,
        playerId: number,
        conversationHistory: Array<{ sender: 'bot' | 'person'; message: string }>
    ): Promise<ConversationPurpose> {
        if (conversationHistory.length === 0) {
            return 'unknown';
        }

        // Use heuristic detection (in production, this would use AI)
        const purpose = this.heuristicPurposeDetection(conversationHistory);
        
        // Store purpose in memory
        this.persistentMemory.setConversationPurpose(botId, playerId, purpose);

        return purpose;
    }

    /**
     * Heuristic purpose detection
     */
    private heuristicPurposeDetection(
        conversationHistory: Array<{ sender: 'bot' | 'person'; message: string }>
    ): ConversationPurpose {
        const allText = conversationHistory.map(m => m.message.toLowerCase()).join(' ');

        // Navigation keywords
        const navigationKeywords = ['take me', 'lead me', 'go to', 'where is', 'navigate', 'follow', 'directions'];
        if (navigationKeywords.some(kw => allText.includes(kw))) {
            return 'navigation';
        }

        // Information keywords
        const informationKeywords = ['what is', 'tell me', 'explain', 'who is', 'what are', 'where are', 'how'];
        if (informationKeywords.some(kw => allText.includes(kw))) {
            return 'information';
        }

        // Support keywords
        const supportKeywords = ['help', 'problem', 'issue', 'error', 'fix', 'troubleshoot', 'support'];
        if (supportKeywords.some(kw => allText.includes(kw))) {
            return 'support';
        }

        // Entertainment keywords
        const entertainmentKeywords = ['joke', 'funny', 'game', 'play', 'entertain', 'laugh'];
        if (entertainmentKeywords.some(kw => allText.includes(kw))) {
            return 'entertainment';
        }

        // Social keywords (default for casual chat)
        const socialKeywords = ['hello', 'hi', 'how are you', 'nice to meet', 'chat', 'talk'];
        if (socialKeywords.some(kw => allText.includes(kw)) || conversationHistory.length < 5) {
            return 'social';
        }

        return 'unknown';
    }
}
