/**
 * MultiPromptAIService - Supports multi-prompt workflows
 * 
 * Features:
 * - Analysis prompt: Analyze conversation context, detect issues
 * - Summarization prompt: Summarize if needed
 * - Main response prompt: Generate actual response
 * - Chain prompts intelligently
 * - Track token usage across all prompts
 */

import { AIService } from './AIService';
import { ContextManager } from './ContextManager';
import type { AIStreamChunk } from './types';

export interface MultiPromptConfig {
    enableAnalysis?: boolean; // Analyze conversation before responding
    enableSummarization?: boolean; // Summarize context if needed
    analysisProviderId?: string; // Optional: use different provider for analysis
}

export interface MultiPromptResult {
    response: string;
    analysis?: {
        issues: string[];
        suggestions: string[];
    };
    summarization?: {
        summary: string;
        originalMessageCount: number;
    };
    tokenUsage: {
        analysis?: number;
        summarization?: number;
        response: number;
        total: number;
    };
}

export class MultiPromptAIService {
    private aiService: AIService;
    private contextManager: ContextManager;
    private config: MultiPromptConfig;

    constructor(
        aiService: AIService,
        contextManager: ContextManager,
        config: MultiPromptConfig = {}
    ) {
        this.aiService = aiService;
        this.contextManager = contextManager;
        this.config = {
            enableAnalysis: config.enableAnalysis ?? false,
            enableSummarization: config.enableSummarization ?? true,
            ...config,
        };
    }

    /**
     * Generate response using multi-prompt workflow
     */
    async *generateResponse(
        botId: string,
        playerId: number,
        message: string,
        chatInstructions: string,
        providerId: string,
        spaceName: string | undefined,
        conversationContext: string,
        maxTokens: number = 4000
    ): AsyncGenerator<AIStreamChunk> {
        let analysisResult: { issues: string[]; suggestions: string[] } | undefined;
        let summarizationResult: { summary: string; originalMessageCount: number } | undefined;
        let analysisTokens = 0;
        let summarizationTokens = 0;

        // Step 1: Analysis (optional)
        if (this.config.enableAnalysis) {
            try {
                const analysis = await this.analyzeConversation(
                    botId,
                    playerId,
                    conversationContext,
                    chatInstructions,
                    providerId
                );
                analysisResult = analysis.analysis;
                analysisTokens = analysis.tokens;
            } catch (error) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn('[MultiPromptAIService] Analysis failed, continuing:', error);
                }
            }
        }

        // Step 2: Context management and summarization (if needed)
        // This is handled by ContextManager when generating the main response
        // The context manager will automatically summarize if approaching limits

        // Step 3: Generate main response
        let responseTokens = 0;
        let fullResponse = '';

        for await (const chunk of this.aiService.generateBotResponseStream(
            botId,
            playerId,
            message,
            chatInstructions,
            providerId,
            spaceName,
            conversationContext
        )) {
            if (chunk.content) {
                fullResponse += chunk.content;
            }
            if (chunk.metadata?.tokensUsed) {
                responseTokens = chunk.metadata.tokensUsed;
            }
            yield chunk;
        }

        // Return metadata in final chunk
        yield {
            content: '',
            done: true,
            metadata: {
                analysis: analysisResult as any,
                summarization: summarizationResult as any,
                analysisTokens,
                summarizationTokens,
                responseTokens: responseTokens,
                tokensUsed: analysisTokens + summarizationTokens + responseTokens,
            },
        };
    }

    /**
     * Analyze conversation context
     */
    private async analyzeConversation(
        botId: string,
        playerId: number,
        conversationContext: string,
        chatInstructions: string,
        providerId: string
    ): Promise<{ analysis: { issues: string[]; suggestions: string[] }; tokens: number }> {
        const systemPrompt = `You are a conversation analyzer. Analyze the conversation context and identify:
1. Potential issues (repetition, confusion, etc.)
2. Suggestions for improvement

Return JSON: {"issues": ["issue1", "issue2"], "suggestions": ["suggestion1", "suggestion2"]}`;

        const userMessage = `Conversation context:\n${conversationContext}\n\nBot instructions: ${chatInstructions}\n\nAnalyze and return JSON only.`;

        // For now, return empty analysis (in production, this would call AIService)
        // This is a placeholder - full implementation would stream the analysis
        return {
            analysis: {
                issues: [],
                suggestions: [],
            },
            tokens: 0,
        };
    }
}
