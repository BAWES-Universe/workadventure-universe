/**
 * ContextManager - Manages context window limits with automatic summarization
 * 
 * Features:
 * - Detect when context is approaching limit
 * - Automatically summarize old messages
 * - Maintain summary + recent messages in context
 * - Support recursive summarization for very long conversations
 */

import type { ConversationMessage } from '../memory/ConversationMemory';
import { AIService } from './AIService';

export interface ContextSummary {
    summary: string;
    originalMessageCount: number;
    summarizedAt: number;
    emotions?: {
        botEmotion: Record<string, number>;
        personEmotion: Record<string, number>;
    };
    importantEvents?: string[];
}

export interface ManagedContext {
    summary?: ContextSummary;
    recentMessages: ConversationMessage[];
    totalTokens: number; // Estimated token count
    maxTokens: number;
}

export class ContextManager {
    private aiService: AIService;
    private summaries: Map<string, ContextSummary> = new Map(); // key: "botId_playerId"
    private readonly CONTEXT_THRESHOLD = 0.8; // Summarize when 80% of context is used
    private readonly MIN_MESSAGES_TO_SUMMARIZE = 20; // Minimum messages before summarizing

    constructor(aiService: AIService) {
        this.aiService = aiService;
    }

    /**
     * Manage context for a conversation
     * Returns managed context with summary + recent messages
     */
    async manageContext(
        botId: string,
        playerId: number,
        messages: ConversationMessage[],
        maxTokens: number,
        estimatedTokensPerMessage: number = 50
    ): Promise<ManagedContext> {
        const key = `${botId}_${playerId}`;
        const estimatedTokens = messages.length * estimatedTokensPerMessage;
        const threshold = maxTokens * this.CONTEXT_THRESHOLD;

        // If we're under threshold, return as-is
        if (estimatedTokens < threshold || messages.length < this.MIN_MESSAGES_TO_SUMMARIZE) {
            return {
                recentMessages: messages,
                totalTokens: estimatedTokens,
                maxTokens,
            };
        }

        // We need to summarize
        const existingSummary = this.summaries.get(key);
        const messagesToSummarize = existingSummary 
            ? messages.slice(0, -10) // Keep last 10 messages, summarize the rest
            : messages.slice(0, -10); // Keep last 10 messages, summarize the rest

        const recentMessages = messages.slice(-10); // Last 10 messages

        // Create or update summary
        const summary = await this.createSummary(
            botId,
            playerId,
            messagesToSummarize,
            existingSummary
        );

        this.summaries.set(key, summary);

        // Calculate total tokens (summary + recent messages)
        const summaryTokens = this.estimateTokens(summary.summary);
        const recentTokens = recentMessages.length * estimatedTokensPerMessage;
        const totalTokens = summaryTokens + recentTokens;

        return {
            summary,
            recentMessages,
            totalTokens,
            maxTokens,
        };
    }

    /**
     * Create a summary of messages
     */
    private async createSummary(
        botId: string,
        playerId: number,
        messages: ConversationMessage[],
        existingSummary?: ContextSummary
    ): Promise<ContextSummary> {
        // Format messages for summarization
        const conversationText = messages.map(msg => 
            `${msg.sender === 'bot' ? 'Bot' : 'Person'}: ${msg.message}`
        ).join('\n');

        // Create summary prompt
        const systemPrompt = `You are a conversation summarizer. Create a concise summary of the conversation that preserves:
1. Key topics discussed
2. Important information shared
3. Emotional tone
4. Important events or decisions

Keep the summary concise but informative.`;

        const userMessage = existingSummary
            ? `Previous summary: ${existingSummary.summary}\n\nNew messages to summarize:\n${conversationText}\n\nUpdate the summary to include the new messages.`
            : `Summarize this conversation:\n${conversationText}`;

        // For now, use a simplified summary (in production, this would call AIService)
        // Since we need AI, we'll create a heuristic summary
        const summary = this.createHeuristicSummary(messages, existingSummary);

        return {
            summary,
            originalMessageCount: messages.length,
            summarizedAt: Date.now(),
        };
    }

    /**
     * Create a heuristic summary (fallback when AI is not available)
     */
    private createHeuristicSummary(
        messages: ConversationMessage[],
        existingSummary?: ContextSummary
    ): string {
        if (messages.length === 0) {
            return existingSummary?.summary || 'No conversation yet.';
        }

        const topics: string[] = [];
        const personMessages = messages.filter(m => m.sender === 'person');
        const botMessages = messages.filter(m => m.sender === 'bot');

        // Extract key topics from messages
        for (const msg of personMessages.slice(0, 5)) { // First 5 person messages
            if (msg.message.length > 10) {
                const words = msg.message.toLowerCase().split(/\s+/).filter(w => w.length > 4);
                topics.push(...words.slice(0, 3)); // First 3 significant words
            }
        }

        const topicStr = topics.slice(0, 5).join(', ');
        const summary = `Conversation about: ${topicStr || 'various topics'}. ${personMessages.length} person messages, ${botMessages.length} bot responses.`;

        if (existingSummary) {
            return `${existingSummary.summary} | ${summary}`;
        }

        return summary;
    }

    /**
     * Estimate token count for text (rough approximation: 1 token ≈ 4 characters)
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /**
     * Get summary for a conversation
     */
    getSummary(botId: string, playerId: number): ContextSummary | undefined {
        const key = `${botId}_${playerId}`;
        return this.summaries.get(key);
    }

    /**
     * Clear summary for a conversation
     */
    clearSummary(botId: string, playerId: number): void {
        const key = `${botId}_${playerId}`;
        this.summaries.delete(key);
    }
}
