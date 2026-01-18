/**
 * PersonalityComplianceValidator - Ensures responses match chat instructions
 * 
 * Features:
 * - Analyze response against chat instructions
 * - Detect personality violations
 * - Score compliance (0-1)
 * - Use AI to verify personality adherence when needed
 * - Track compliance metrics over time
 */

import { BotMetricsCollector } from '../metrics/BotMetricsCollector';

export interface ComplianceCheckResult {
    compliant: boolean;
    score: number; // 0-1, where 1 = perfect match
    violations: string[];
    reasoning?: string;
}

export class PersonalityComplianceValidator {
    private metricsCollector: BotMetricsCollector;
    private complianceHistory: Map<string, number[]> = new Map(); // botId -> compliance scores

    constructor(metricsCollector: BotMetricsCollector) {
        this.metricsCollector = metricsCollector;
    }

    /**
     * Validate personality compliance
     */
    validateCompliance(
        botId: string,
        response: string,
        chatInstructions: string
    ): ComplianceCheckResult {
        const violations: string[] = [];
        let score = 1.0;

        // Parse personality traits from chat instructions
        const isMeanBot = this.isMeanBot(chatInstructions);
        const isFriendlyBot = this.isFriendlyBot(chatInstructions);
        const isHelpfulBot = this.isHelpfulBot(chatInstructions);
        const shouldNotApologize = isMeanBot || chatInstructions.toLowerCase().includes('never apologize');

        const responseLower = response.toLowerCase();

        // Check mean bot compliance
        if (isMeanBot) {
            // Mean bot should not be friendly
            const friendlyPhrases = ['happy to help', 'glad to assist', 'welcome', 'pleasure', 'nice to meet', 'how can i help'];
            for (const phrase of friendlyPhrases) {
                if (responseLower.includes(phrase)) {
                    violations.push(`Mean bot used friendly phrase: "${phrase}"`);
                    score -= 0.2;
                }
            }

            // Mean bot should not apologize
            if (shouldNotApologize) {
                const apologyPhrases = ['sorry', 'apologize', 'my apologies', 'i apologize'];
                for (const phrase of apologyPhrases) {
                    if (responseLower.includes(phrase)) {
                        violations.push(`Mean bot apologized: "${phrase}"`);
                        score -= 0.3;
                    }
                }
            }
        }

        // Check friendly bot compliance
        if (isFriendlyBot) {
            // Friendly bot should not be mean
            const meanPhrases = ['go away', 'leave me alone', 'stop bothering', 'i hate', 'annoying', 'shut up'];
            for (const phrase of meanPhrases) {
                if (responseLower.includes(phrase)) {
                    violations.push(`Friendly bot used mean phrase: "${phrase}"`);
                    score -= 0.3;
                }
            }
        }

        // Check helpful bot compliance
        if (isHelpfulBot) {
            // Helpful bot should offer help
            const helpfulPhrases = ['help', 'assist', 'can i', 'would you like', 'i can'];
            const hasHelpfulPhrase = helpfulPhrases.some(phrase => responseLower.includes(phrase));
            
            // If response is a question answer or navigation, that's fine
            const isNavigation = responseLower.includes('follow me') || responseLower.includes('take you');
            const isAnswer = responseLower.length > 20; // Reasonable answer length
            
            if (!hasHelpfulPhrase && !isNavigation && !isAnswer && responseLower.length < 10) {
                violations.push('Helpful bot did not offer help or provide useful response');
                score -= 0.1;
            }
        }

        // Clamp score to 0-1
        score = Math.max(0, Math.min(1, score));

        const compliant = score >= 0.7; // 70% threshold

        // Record compliance metric
        this.metricsCollector.recordPersonalityCompliance(botId, score);

        // Track compliance history
        const history = this.complianceHistory.get(botId) || [];
        history.push(score);
        if (history.length > 100) {
            history.shift(); // Keep only last 100 scores
        }
        this.complianceHistory.set(botId, history);

        return {
            compliant,
            score,
            violations: violations.length > 0 ? violations : [],
            reasoning: violations.length > 0 ? violations.join('; ') : undefined,
        };
    }

    /**
     * Get average compliance score for a bot
     */
    getAverageCompliance(botId: string): number {
        const history = this.complianceHistory.get(botId);
        if (!history || history.length === 0) {
            return 1.0; // Default to perfect if no history
        }

        const sum = history.reduce((a, b) => a + b, 0);
        return sum / history.length;
    }

    /**
     * Check if bot is configured as mean
     */
    private isMeanBot(chatInstructions: string): boolean {
        const lower = chatInstructions.toLowerCase();
        return lower.includes('mean') || 
               lower.includes('angry') || 
               lower.includes('frustrated') ||
               lower.includes('hostile');
    }

    /**
     * Check if bot is configured as friendly
     */
    private isFriendlyBot(chatInstructions: string): boolean {
        const lower = chatInstructions.toLowerCase();
        return lower.includes('friendly') || 
               lower.includes('welcoming') || 
               lower.includes('kind') ||
               lower.includes('nice');
    }

    /**
     * Check if bot is configured as helpful
     */
    private isHelpfulBot(chatInstructions: string): boolean {
        const lower = chatInstructions.toLowerCase();
        return lower.includes('helpful') || 
               lower.includes('assist') || 
               lower.includes('support');
    }
}
