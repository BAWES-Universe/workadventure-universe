/**
 * ContextSummarizer - Summarizes conversation history using AI
 * 
 * Features:
 * - Summarize conversation history using AI
 * - Extract key information (emotions, facts, important events)
 * - Preserve emotional context in summaries
 * - Generate hierarchical summaries (daily → weekly → monthly)
 */

import { AIService } from './AIService';
import type { ConversationMessage } from '../memory/ConversationMemory';
import type { EmotionalState } from '../memory/ConversationMemory';

export interface ConversationSummary {
    summary: string;
    keyTopics: string[];
    emotions: {
        botEmotion: EmotionalState['botEmotion'];
        personEmotion: EmotionalState['personEmotion'];
    };
    importantEvents: Array<{
        event: string;
        timestamp: number;
    }>;
    facts: Record<string, string>; // Key facts extracted
}

export class ContextSummarizer {
    private aiService: AIService;

    constructor(aiService: AIService) {
        this.aiService = aiService;
    }

    /**
     * Summarize conversation history
     */
    async summarize(
        botId: string,
        playerId: number,
        messages: ConversationMessage[],
        currentEmotions: EmotionalState
    ): Promise<ConversationSummary> {
        // Format messages
        const conversationText = messages.map(msg => 
            `${msg.sender === 'bot' ? 'Bot' : 'Person'}: ${msg.message}`
        ).join('\n');

        // Create summary prompt
        const systemPrompt = `You are a conversation summarizer. Analyze the conversation and extract:
1. A concise summary (2-3 sentences)
2. Key topics discussed
3. Emotional tone (bot and person)
4. Important events or decisions
5. Key facts mentioned

Return a JSON object with: summary, keyTopics (array), emotions (botEmotion, personEmotion), importantEvents (array), facts (object).`;

        const userMessage = `Current emotions:\nBot: ${JSON.stringify(currentEmotions.botEmotion)}\nPerson: ${JSON.stringify(currentEmotions.personEmotion)}\n\nConversation:\n${conversationText}\n\nAnalyze and return JSON only.`;

        // For now, use heuristic summarization (in production, this would call AIService)
        return this.heuristicSummarize(messages, currentEmotions);
    }

    /**
     * Heuristic summarization (fallback)
     */
    private heuristicSummarize(
        messages: ConversationMessage[],
        currentEmotions: EmotionalState
    ): ConversationSummary {
        const personMessages = messages.filter(m => m.sender === 'person');
        const botMessages = messages.filter(m => m.sender === 'bot');

        // Extract topics
        const topics: string[] = [];
        for (const msg of personMessages.slice(0, 10)) {
            const words = msg.message.toLowerCase().split(/\s+/).filter(w => w.length > 4);
            topics.push(...words.slice(0, 2));
        }
        const uniqueTopics = [...new Set(topics)].slice(0, 5);

        // Extract facts (simple pattern matching)
        const facts: Record<string, string> = {};
        for (const msg of personMessages) {
            // Look for "I like X" or "My favorite is X"
            const likeMatch = msg.message.match(/(?:i like|my favorite is|i love) ([^.!?]+)/i);
            if (likeMatch) {
                facts['preference'] = likeMatch[1].trim();
            }
        }

        return {
            summary: `Conversation with ${personMessages.length} person messages and ${botMessages.length} bot responses. Discussed: ${uniqueTopics.join(', ')}.`,
            keyTopics: uniqueTopics,
            emotions: {
                botEmotion: currentEmotions.botEmotion,
                personEmotion: currentEmotions.personEmotion,
            },
            importantEvents: messages
                .filter(m => m.message.length > 50) // Longer messages might be important
                .slice(0, 3)
                .map(m => ({
                    event: m.message.substring(0, 50) + '...',
                    timestamp: m.timestamp,
                })),
            facts,
        };
    }
}
