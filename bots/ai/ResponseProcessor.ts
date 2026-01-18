/**
 * ResponseProcessor - Post-processes AI responses before sending
 * 
 * Features:
 * - Clean system prompt leakage
 * - Detect and prevent repetition
 * - Validate personality compliance
 * - Validate response quality
 */

import { BotMetricsCollector } from '../metrics/BotMetricsCollector';
import { ConversationMonitor } from '../monitoring/ConversationMonitor';
import type { ResponseQualityMetrics } from '../metrics/types';

export interface ProcessedResponse {
    cleaned: string;
    issues: string[];
    metrics: {
        repetitionScore: number;
        systemPromptLeakage: boolean;
        personalityCompliance: number;
        overallQuality: number;
    };
}

export class ResponseProcessor {
    private metricsCollector: BotMetricsCollector;
    private conversationMonitor: ConversationMonitor;
    private recentResponses: Map<string, string[]> = new Map(); // botId -> recent responses
    private readonly MAX_RECENT_RESPONSES = 10;

    constructor(
        metricsCollector: BotMetricsCollector,
        conversationMonitor: ConversationMonitor
    ) {
        this.metricsCollector = metricsCollector;
        this.conversationMonitor = conversationMonitor;
    }

    /**
     * Process a response before sending
     */
    processResponse(
        botId: string,
        playerId: number,
        response: string,
        chatInstructions: string
    ): ProcessedResponse {
        // Clean system prompt leakage
        const cleaned = this.cleanSystemPromptLeakage(response);
        
        // Detect repetition
        const repetitionScore = this.calculateRepetitionScore(botId, cleaned);
        
        // Detect system prompt leakage
        const systemPromptLeakage = this.detectSystemPromptLeakage(cleaned);
        
        // Validate personality compliance (simplified)
        const personalityCompliance = this.validatePersonalityCompliance(cleaned, chatInstructions);
        
        // Calculate overall quality
        const overallQuality = this.calculateOverallQuality(
            repetitionScore,
            systemPromptLeakage,
            personalityCompliance
        );

        const issues: string[] = [];
        if (repetitionScore >= 1.0) {
            issues.push('BLOCKED: Exact duplicate');
        } else if (repetitionScore > 0.8) {
            issues.push('High repetition detected');
        }
        if (systemPromptLeakage) {
            issues.push('System prompt leakage detected');
        }
        if (personalityCompliance < 0.7) {
            issues.push('Personality compliance low');
        }

        // Store response for repetition checking (even if duplicate, so we can detect it next time)
        this.storeResponse(botId, cleaned);

        // Monitor response
        this.conversationMonitor.monitorResponse(botId, playerId, cleaned, chatInstructions);

        // Record metrics
        const metrics: ResponseQualityMetrics = {
            botId,
            playerId,
            responseId: `response-${Date.now()}`,
            timestamp: Date.now(),
            metrics: {
                responseTime: 0, // Would be set by caller
                tokenUsage: 0, // Would be set by caller
                repetitionScore,
                systemPromptLeakage,
                personalityCompliance,
                overallQuality,
            },
            responseText: cleaned,
            chatInstructions,
        };
        this.metricsCollector.recordResponseQuality(metrics);

        return {
            cleaned,
            issues,
            metrics: {
                repetitionScore,
                systemPromptLeakage,
                personalityCompliance,
                overallQuality,
            },
        };
    }

    /**
     * Clean system prompt leakage from response
     */
    private cleanSystemPromptLeakage(response: string): string {
        let cleaned = response;

        // Remove system prompt markers
        cleaned = cleaned.replace(/\*\*CRITICAL:\*\*.*?(?=\n|$)/gs, '');
        cleaned = cleaned.replace(/CORE RULES \(in priority order\):.*?(?=\n|$)/gs, '');
        cleaned = cleaned.replace(/TECHNICAL RESPONSE GUIDELINES.*?(?=\n|$)/gs, '');
        cleaned = cleaned.replace(/LOCATION QUESTIONS:.*?(?=\n|$)/gs, '');
        cleaned = cleaned.replace(/ANTI-HALLUCINATION:.*?(?=\n|$)/gs, '');
        cleaned = cleaned.replace(/NAVIGATION:.*?(?=\n|$)/gs, '');
        cleaned = cleaned.replace(/CONTEXT:.*?(?=\n|$)/gs, '');
        cleaned = cleaned.replace(/^- .*?(?=\n|$)/gm, ''); // Remove bullet points that might be part of instructions
        cleaned = cleaned.replace(/\s*\[END_TOOL_REQUEST\].*?\[END_TOOL_RESPONSE\]\s*/gs, ''); // Remove tool markers
        // Remove reasoning tags - handle all variations
        // Handle self-closing format: <think>\n\n</think>
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/redacted_reasoning>/gs, ''); // Both redacted (most common)
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gs, ''); // Opening redacted, closing think
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gs, ''); // Standard think tags
        cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gs, ''); // Alternative format
        // Also handle any remaining standalone tags
        cleaned = cleaned.replace(/<redacted_reasoning\s*\/?>/g, ''); // Self-closing or opening only
        cleaned = cleaned.replace(/<\/redacted_reasoning>/g, ''); // Closing only
        cleaned = cleaned.replace(/<think\s*\/?>/g, ''); // Self-closing or opening only
        cleaned = cleaned.replace(/<\/think>/g, ''); // Closing only

        // If the message still contains instruction-like text, take only the first "real" line
        if (cleaned.includes('\n') && (cleaned.includes('CRITICAL') || cleaned.includes('RULES') || cleaned.includes('GUIDELINES'))) {
            cleaned = cleaned.split('\n')[0].trim();
        }

        // Ensure it's not empty after cleaning
        if (!cleaned.trim()) {
            return "I'm having trouble responding. Could you rephrase?";
        }

        return cleaned.trim();
    }

    /**
     * Calculate repetition score (0-1, where 1 = exact duplicate)
     */
    private calculateRepetitionScore(botId: string, response: string): number {
        const recent = this.recentResponses.get(botId) || [];
        if (recent.length === 0) {
            return 0;
        }

        // First check for exact duplicates (normalized - trim and lowercase)
        const normalizedResponse = response.trim().toLowerCase();
        for (const recentResponse of recent) {
            const normalizedRecent = recentResponse.trim().toLowerCase();
            if (normalizedResponse === normalizedRecent) {
                return 1.0; // Exact duplicate
            }
        }

        // Then check similarity for near-duplicates
        let maxSimilarity = 0;
        for (const recentResponse of recent) {
            const similarity = this.calculateSimilarity(response, recentResponse);
            maxSimilarity = Math.max(maxSimilarity, similarity);
        }

        return maxSimilarity;
    }

    /**
     * Detect system prompt leakage
     */
    private detectSystemPromptLeakage(response: string): boolean {
        const leakageMarkers = [
            'CRITICAL:',
            'CORE RULES',
            'TECHNICAL RESPONSE GUIDELINES',
            'ANTI-HALLUCINATION',
            'LOCATION QUESTIONS:',
            'NAVIGATION:',
            'CONTEXT:',
            '[END_TOOL_REQUEST]',
            '[END_TOOL_RESPONSE]',
        ];

        return leakageMarkers.some(marker => response.includes(marker));
    }

    /**
     * Validate personality compliance (0-1, where 1 = perfect match)
     */
    private validatePersonalityCompliance(response: string, chatInstructions: string): number {
        const isMeanBot = chatInstructions.toLowerCase().includes('mean') || 
                         chatInstructions.toLowerCase().includes('angry') ||
                         chatInstructions.toLowerCase().includes('frustrated');
        const isFriendlyBot = chatInstructions.toLowerCase().includes('friendly') ||
                             chatInstructions.toLowerCase().includes('helpful') ||
                             chatInstructions.toLowerCase().includes('welcoming');

        const responseLower = response.toLowerCase();
        let compliance = 1.0;

        // Check if mean bot is being too friendly
        if (isMeanBot) {
            const friendlyPhrases = ['happy to help', 'glad to assist', 'welcome', 'pleasure', 'nice to meet'];
            for (const phrase of friendlyPhrases) {
                if (responseLower.includes(phrase)) {
                    compliance -= 0.3;
                }
            }
        }

        // Check if friendly bot is being too mean
        if (isFriendlyBot) {
            const meanPhrases = ['go away', 'leave me alone', 'stop bothering', 'i hate', 'annoying'];
            for (const phrase of meanPhrases) {
                if (responseLower.includes(phrase)) {
                    compliance -= 0.3;
                }
            }
        }

        return Math.max(0, Math.min(1, compliance));
    }

    /**
     * Calculate overall quality score (0-1)
     */
    private calculateOverallQuality(
        repetitionScore: number,
        systemPromptLeakage: boolean,
        personalityCompliance: number
    ): number {
        let quality = 1.0;

        // Penalize repetition
        quality -= repetitionScore * 0.3;

        // Penalize system prompt leakage
        if (systemPromptLeakage) {
            quality -= 0.4;
        }

        // Penalize low personality compliance
        quality -= (1 - personalityCompliance) * 0.3;

        return Math.max(0, Math.min(1, quality));
    }

    /**
     * Calculate similarity between two strings (Jaccard similarity)
     */
    private calculateSimilarity(str1: string, str2: string): number {
        const words1 = new Set(str1.toLowerCase().split(/\s+/));
        const words2 = new Set(str2.toLowerCase().split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }

    /**
     * Store response for repetition checking
     */
    private storeResponse(botId: string, response: string): void {
        const recent = this.recentResponses.get(botId) || [];
        recent.push(response);
        
        // Keep only last N responses
        if (recent.length > this.MAX_RECENT_RESPONSES) {
            recent.shift();
        }
        
        this.recentResponses.set(botId, recent);
    }

    /**
     * Clear recent responses for a bot (for cleanup)
     */
    clearRecentResponses(botId: string): void {
        this.recentResponses.delete(botId);
    }
}
