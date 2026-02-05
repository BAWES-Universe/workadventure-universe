/**
 * RepetitionDetector - Prevents repetitive responses using similarity scoring
 * 
 * Features:
 * - Compare new response to recent history
 * - Calculate similarity score
 * - Block or modify repetitive responses
 * - Learn from user feedback
 */

import type { ConversationMessage } from '../memory/ConversationMemory';

export interface RepetitionCheckResult {
    isRepetitive: boolean;
    similarityScore: number; // 0-1, where 1 = exact duplicate
    mostSimilarResponse?: string;
    shouldBlock: boolean; // Whether to block the response
    suggestedModification?: string; // Optional suggestion for modification
}

export class RepetitionDetector {
    private recentResponses: Map<string, ConversationMessage[]> = new Map(); // key: "botId_playerId"
    private readonly MAX_RECENT_RESPONSES = 10;
    private readonly REPETITION_THRESHOLD = 0.8; // 80% similarity = repetitive
    private readonly BLOCK_THRESHOLD = 0.95; // 95% similarity = block

    /**
     * Check if a response is repetitive
     */
    checkRepetition(
        botId: string,
        playerId: number,
        response: string
    ): RepetitionCheckResult {
        const key = `${botId}_${playerId}`;
        const recent = this.recentResponses.get(key) || [];

        if (recent.length === 0) {
            return {
                isRepetitive: false,
                similarityScore: 0,
                shouldBlock: false,
            };
        }

        let maxSimilarity = 0;
        let mostSimilar: ConversationMessage | undefined;

        for (const recentMsg of recent) {
            if (recentMsg.sender === 'bot') {
                const similarity = this.calculateSimilarity(response, recentMsg.message);
                if (similarity > maxSimilarity) {
                    maxSimilarity = similarity;
                    mostSimilar = recentMsg;
                }
            }
        }

        const isRepetitive = maxSimilarity >= this.REPETITION_THRESHOLD;
        const shouldBlock = maxSimilarity >= this.BLOCK_THRESHOLD;

        return {
            isRepetitive,
            similarityScore: maxSimilarity,
            mostSimilarResponse: mostSimilar?.message,
            shouldBlock,
            suggestedModification: isRepetitive && !shouldBlock ? this.suggestModification(response, mostSimilar?.message || '') : undefined,
        };
    }

    /**
     * Record a response for future repetition checking
     */
    recordResponse(botId: string, playerId: number, response: string): void {
        const key = `${botId}_${playerId}`;
        const recent = this.recentResponses.get(key) || [];

        recent.push({
            message: response,
            sender: 'bot',
            timestamp: Date.now(),
        });

        // Keep only last N responses
        if (recent.length > this.MAX_RECENT_RESPONSES) {
            recent.shift();
        }

        this.recentResponses.set(key, recent);
    }

    /**
     * Calculate similarity between two strings (Jaccard similarity + word order)
     */
    private calculateSimilarity(str1: string, str2: string): number {
        const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 2);

        if (words1.length === 0 || words2.length === 0) {
            return 0;
        }

        // Jaccard similarity
        const set1 = new Set(words1);
        const set2 = new Set(words2);
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        const jaccard = intersection.size / union.size;

        // Word order similarity (simplified - checks if words appear in similar order)
        let orderSimilarity = 0;
        if (words1.length === words2.length) {
            let matches = 0;
            for (let i = 0; i < Math.min(words1.length, words2.length); i++) {
                if (words1[i] === words2[i]) {
                    matches++;
                }
            }
            orderSimilarity = matches / words1.length;
        }

        // Combine Jaccard and order similarity (weighted)
        return (jaccard * 0.7) + (orderSimilarity * 0.3);
    }

    /**
     * Suggest a modification to make response less repetitive
     */
    private suggestModification(response: string, similarResponse: string): string {
        // Simple modification: try to vary the response
        // In a real implementation, this would use AI to rephrase
        return response; // For now, return as-is (caller should handle modification)
    }

    /**
     * Clear recent responses for a conversation (for cleanup)
     */
    clearRecentResponses(botId: string, playerId: number): void {
        const key = `${botId}_${playerId}`;
        this.recentResponses.delete(key);
    }
}
