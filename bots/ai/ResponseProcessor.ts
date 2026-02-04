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
    private recentResponses: Map<string, string[]> = new Map(); // key: "botId_playerId" -> recent responses (per conversation)
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
        chatInstructions: string,
        responseTime?: number,
        tokenUsage?: { prompt: number; completion: number; total: number }
    ): ProcessedResponse {
        // Clean system prompt leakage
        const cleaned = this.cleanSystemPromptLeakage(response);
        
        // Detect repetition (per conversation - use botId_playerId as key)
        const repetitionScore = this.calculateRepetitionScore(botId, playerId, cleaned);
        
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
        this.storeResponse(botId, playerId, cleaned);

        // Monitor response
        this.conversationMonitor.monitorResponse(botId, playerId, cleaned, chatInstructions);

        // Record metrics (skip for test conversations - playerId 999999 is used for tests)
        // Tests create their own metrics separately, we don't need to duplicate
        // Also combine all metrics into ONE record instead of multiple separate records
        if (playerId !== 999999) {
            const metrics: ResponseQualityMetrics = {
                botId,
                playerId,
                responseId: `response-${Date.now()}`,
                timestamp: Date.now(),
                metrics: {
                    responseTime: responseTime || 0, // Use provided response time
                    tokenUsage: tokenUsage?.total || 0, // Use provided token usage
                    repetitionScore,
                    systemPromptLeakage,
                    personalityCompliance,
                    overallQuality,
                },
                responseText: cleaned,
                chatInstructions,
            };
            this.metricsCollector.recordResponseQuality(metrics);
        }

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
        // Remove tool call mentions (e.g., "(tool call: get_people_on_map)" or "I'll check" followed by tool mentions)
        cleaned = cleaned.replace(/\(tool call[^)]*\)/gi, ''); // Remove (tool call: ...)
        cleaned = cleaned.replace(/tool call[^\.]*\./gi, ''); // Remove "tool call..." sentences
        // Only remove "I'll check" if it's followed by tool-related text or at the start of response
        cleaned = cleaned.replace(/^I'll check.*?\./gi, ''); // Remove "I'll check..." at start
        cleaned = cleaned.replace(/Let me (check|look|find).*?\(tool call/gi, ''); // Remove "Let me check/look/find..." only if followed by tool call
        
        // Remove internal reasoning that leaked without tags
        // Patterns like "Okay, let's see..." or "Let me think of a natural way to respond" followed by reasoning
        cleaned = cleaned.replace(/Okay, let's see\.\.\.[\s\S]*?(?:I'll go with that\.|Let's go with that\.|That sounds good\.)/gi, '');
        cleaned = cleaned.replace(/Let me think of[\s\S]*?(?:I'll go with that\.|Let's go with that\.|That sounds good\.)/gi, '');
        cleaned = cleaned.replace(/I should [^\.]+without repeating[\s\S]*?(?:I'll go with that\.|Let's go with that\.|straightforward)/gi, '');
        // Remove any remaining reasoning that starts with "I should" and ends with self-conclusion
        cleaned = cleaned.replace(/I should[\s\S]*?(?:I'll go with|How about\.\.\.|That sounds good)/gi, '');
        // Remove "I could say something like" reasoning
        cleaned = cleaned.replace(/I could say something like[\s\S]*?(?:I'll go with|sounds good)/gi, '');
        
        // Remove emotion update blocks (unified AI emotion system)
        // CRITICAL: Remove these BEFORE any other processing to prevent leakage
        // Handle both complete blocks and incomplete blocks (missing closing tag)
        cleaned = cleaned.replace(/\[EMOTION_UPDATE\]\s*[\s\S]*?\[\/EMOTION_UPDATE\]/gi, '');
        cleaned = cleaned.replace(/\[EMOTION_UPDATE\]\s*[\s\S]*$/gi, ''); // Remove incomplete blocks at end of response
        
        // Remove reasoning tags - handle all variations
        // CRITICAL: Remove these BEFORE any other processing to prevent leakage
        // Handle complete tags first (most common) - use non-greedy matching
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/redacted_reasoning>/gs, ''); // Both redacted (most common)
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gs, ''); // Opening redacted, closing think
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gs, ''); // Standard think tags
        cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gs, ''); // Alternative format
        // Also handle any remaining standalone tags (must come after complete tags)
        cleaned = cleaned.replace(/<redacted_reasoning\s*\/?>/g, ''); // Self-closing or opening only
        cleaned = cleaned.replace(/<\/redacted_reasoning>/g, ''); // Closing only
        cleaned = cleaned.replace(/<think\s*\/?>/g, ''); // Self-closing or opening only
        cleaned = cleaned.replace(/<\/think>/g, ''); // Closing only
        // Handle any newline-only content left by tag removal
        cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, '\n\n'); // Clean up excessive newlines (3+ becomes 2)
        cleaned = cleaned.replace(/^\n+/, ''); // Remove leading newlines
        cleaned = cleaned.replace(/\n+$/, ''); // Remove trailing newlines

        // Remove system prompt leakage patterns
        cleaned = cleaned.replace(/You're not following instructions\.?/gi, '');
        cleaned = cleaned.replace(/I'm not a robot\.?/gi, '');
        cleaned = cleaned.replace(/following the rules?\.?/gi, '');
        
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
     * Tracks per conversation (botId_playerId) to catch repetition in same conversation
     */
    private calculateRepetitionScore(botId: string, playerId: number, response: string): number {
        const key = `${botId}_${playerId}`;
        const recent = this.recentResponses.get(key) || [];
        
        // Debug logging for repetition detection (always log for debugging)
        console.log(`[ResponseProcessor] Checking repetition for ${key}: ${recent.length} recent responses stored`);
        if (recent.length > 0) {
            console.log(`[ResponseProcessor] Recent responses:`, recent.map(r => r.substring(0, 50) + '...'));
        }
        
        if (recent.length === 0) {
            return 0;
        }

        // First check for exact duplicates (normalized - trim and lowercase)
        const normalizedResponse = response.trim().toLowerCase();
        for (let i = 0; i < recent.length; i++) {
            const normalizedRecent = recent[i].trim().toLowerCase();
            if (normalizedResponse === normalizedRecent) {
                console.log(`[ResponseProcessor] 🚨 EXACT DUPLICATE DETECTED! Response matches recent[${i}]`);
                console.log(`  Current: "${response.substring(0, 100)}..."`);
                console.log(`  Recent:  "${recent[i].substring(0, 100)}..."`);
                return 1.0; // Exact duplicate
            }
        }

        // Then check similarity for near-duplicates
        let maxSimilarity = 0;
        let mostSimilarIndex = -1;
        for (let i = 0; i < recent.length; i++) {
            const similarity = this.calculateSimilarity(response, recent[i]);
            if (similarity > maxSimilarity) {
                maxSimilarity = similarity;
                mostSimilarIndex = i;
            }
        }
        
        if (maxSimilarity > 0.8) {
            console.log(`[ResponseProcessor] ⚠️ High similarity detected (${(maxSimilarity * 100).toFixed(1)}%)`);
            console.log(`  Current: "${response.substring(0, 100)}..."`);
            console.log(`  Similar: "${recent[mostSimilarIndex].substring(0, 100)}..."`);
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
     * Store response for repetition checking (per conversation)
     */
    private storeResponse(botId: string, playerId: number, response: string): void {
        const key = `${botId}_${playerId}`;
        const recent = this.recentResponses.get(key) || [];
        recent.push(response);
        
        // Keep only last N responses
        if (recent.length > this.MAX_RECENT_RESPONSES) {
            recent.shift();
        }
        
        this.recentResponses.set(key, recent);
    }

    /**
     * Clear recent responses for a conversation (for cleanup)
     */
    clearRecentResponses(botId: string, playerId: number): void {
        const key = `${botId}_${playerId}`;
        this.recentResponses.delete(key);
    }
}
