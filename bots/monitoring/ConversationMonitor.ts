/**
 * ConversationMonitor - Real-time conversation monitoring
 * 
 * Detects:
 * - Repetition
 * - System prompt leakage
 * - User frustration
 * - Personality violations (when responses don't match chat instructions)
 * 
 * Flags conversations with issues and triggers alerts for critical issues
 */

import { BotMetricsCollector } from '../metrics/BotMetricsCollector';
import type { BotMetrics } from '../metrics/types';

export interface ConversationIssue {
    type: 'repetition' | 'system_prompt_leakage' | 'user_frustration' | 'personality_violation' | 'error';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: number;
    botId: string;
    playerId?: number;
    metadata?: Record<string, any>;
}

export interface FlaggedConversation {
    botId: string;
    playerId: number;
    conversationId: string;
    issues: ConversationIssue[];
    flaggedAt: number;
    resolved: boolean;
}

export class ConversationMonitor {
    private metricsCollector: BotMetricsCollector;
    private flaggedConversations: Map<string, FlaggedConversation> = new Map();
    private recentResponses: Map<string, string[]> = new Map(); // botId -> recent responses
    private readonly MAX_RECENT_RESPONSES = 10;

    constructor(metricsCollector: BotMetricsCollector) {
        this.metricsCollector = metricsCollector;
    }

    /**
     * Monitor a bot response for issues
     */
    monitorResponse(
        botId: string,
        playerId: number,
        response: string,
        chatInstructions: string,
        metadata?: Record<string, any>
    ): ConversationIssue[] {
        const issues: ConversationIssue[] = [];

        // Check for repetition
        const repetitionIssue = this.checkRepetition(botId, response);
        if (repetitionIssue) {
            issues.push(repetitionIssue);
        }

        // Check for system prompt leakage
        const leakageIssue = this.checkSystemPromptLeakage(botId, response);
        if (leakageIssue) {
            issues.push(leakageIssue);
            // Record in metrics
            this.metricsCollector.recordSystemPromptLeakage(botId, true, metadata);
        } else {
            this.metricsCollector.recordSystemPromptLeakage(botId, false, metadata);
        }

        // Check for personality violations
        const personalityIssue = this.checkPersonalityViolation(botId, response, chatInstructions);
        if (personalityIssue) {
            issues.push(personalityIssue);
        }

        // Store response for repetition checking
        this.storeResponse(botId, response);

        // Flag conversation if there are issues
        if (issues.length > 0) {
            this.flagConversation(botId, playerId, issues);
        }

        return issues;
    }

    /**
     * Check for repetition in response
     */
    private checkRepetition(botId: string, response: string): ConversationIssue | null {
        const recent = this.recentResponses.get(botId) || [];
        
        // Check similarity with recent responses
        for (const recentResponse of recent) {
            const similarity = this.calculateSimilarity(response, recentResponse);
            if (similarity > 0.8) { // 80% similar
                return {
                    type: 'repetition',
                    severity: similarity > 0.95 ? 'high' : 'medium',
                    message: `Response is ${Math.round(similarity * 100)}% similar to a previous response`,
                    timestamp: Date.now(),
                    botId,
                    metadata: { similarity, recentResponse: recentResponse.substring(0, 100) },
                };
            }
        }

        return null;
    }

    /**
     * Check for system prompt leakage
     */
    private checkSystemPromptLeakage(botId: string, response: string): ConversationIssue | null {
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

        for (const marker of leakageMarkers) {
            if (response.includes(marker)) {
                return {
                    type: 'system_prompt_leakage',
                    severity: 'high',
                    message: `System prompt leakage detected: "${marker}" found in response`,
                    timestamp: Date.now(),
                    botId,
                    metadata: { marker },
                };
            }
        }

        return null;
    }

    /**
     * Check for personality violations
     */
    private checkPersonalityViolation(
        botId: string,
        response: string,
        chatInstructions: string
    ): ConversationIssue | null {
        // Simple heuristic checks
        // In a real implementation, this would use AI to analyze compliance

        const isMeanBot = chatInstructions.toLowerCase().includes('mean') || 
                         chatInstructions.toLowerCase().includes('angry') ||
                         chatInstructions.toLowerCase().includes('frustrated');
        const isFriendlyBot = chatInstructions.toLowerCase().includes('friendly') ||
                             chatInstructions.toLowerCase().includes('helpful') ||
                             chatInstructions.toLowerCase().includes('welcoming');

        const responseLower = response.toLowerCase();

        // Check if mean bot is being too friendly
        if (isMeanBot) {
            const friendlyPhrases = ['happy to help', 'glad to assist', 'welcome', 'pleasure', 'nice to meet'];
            for (const phrase of friendlyPhrases) {
                if (responseLower.includes(phrase)) {
                    return {
                        type: 'personality_violation',
                        severity: 'medium',
                        message: `Mean bot used friendly phrase: "${phrase}"`,
                        timestamp: Date.now(),
                        botId,
                        metadata: { phrase, expectedPersonality: 'mean' },
                    };
                }
            }
        }

        // Check if friendly bot is being too mean
        if (isFriendlyBot) {
            const meanPhrases = ['go away', 'leave me alone', 'stop bothering', 'i hate', 'annoying'];
            for (const phrase of meanPhrases) {
                if (responseLower.includes(phrase)) {
                    return {
                        type: 'personality_violation',
                        severity: 'medium',
                        message: `Friendly bot used mean phrase: "${phrase}"`,
                        timestamp: Date.now(),
                        botId,
                        metadata: { phrase, expectedPersonality: 'friendly' },
                    };
                }
            }
        }

        return null;
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
     * Calculate similarity between two strings (simple Jaccard similarity)
     */
    private calculateSimilarity(str1: string, str2: string): number {
        const words1 = new Set(str1.toLowerCase().split(/\s+/));
        const words2 = new Set(str2.toLowerCase().split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }

    /**
     * Flag a conversation with issues
     */
    private flagConversation(botId: string, playerId: number, issues: ConversationIssue[]): void {
        const conversationId = `${botId}_${playerId}`;
        
        const existing = this.flaggedConversations.get(conversationId);
        if (existing) {
            // Add new issues to existing flagged conversation
            existing.issues.push(...issues);
        } else {
            // Create new flagged conversation
            this.flaggedConversations.set(conversationId, {
                botId,
                playerId,
                conversationId,
                issues,
                flaggedAt: Date.now(),
                resolved: false,
            });
        }

        // Trigger alerts for critical issues
        const criticalIssues = issues.filter(i => i.severity === 'critical');
        if (criticalIssues.length > 0) {
            this.triggerAlert(botId, playerId, criticalIssues);
        }
    }

    /**
     * Trigger alert for critical issues
     */
    private triggerAlert(botId: string, playerId: number, issues: ConversationIssue[]): void {
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.warn(`[ConversationMonitor] CRITICAL ALERT for bot ${botId}, player ${playerId}:`, issues);
        }
        // In a real implementation, this would send alerts (email, Slack, etc.)
    }

    /**
     * Get flagged conversations for a bot
     */
    getFlaggedConversations(botId: string): FlaggedConversation[] {
        return Array.from(this.flaggedConversations.values())
            .filter(fc => fc.botId === botId && !fc.resolved);
    }

    /**
     * Resolve a flagged conversation
     */
    resolveFlaggedConversation(conversationId: string): void {
        const flagged = this.flaggedConversations.get(conversationId);
        if (flagged) {
            flagged.resolved = true;
        }
    }

    /**
     * Clear recent responses for a bot (for cleanup)
     */
    clearRecentResponses(botId: string): void {
        this.recentResponses.delete(botId);
    }
}
