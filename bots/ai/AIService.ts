/**
 * AIService - Main service for AI operations
 * 
 * Handles:
 * - Credential fetching and caching
 * - Provider management
 * - Streaming responses
 * - Usage tracking
 */

import type { ConversationMemory } from '../memory/ConversationMemory';
import type { AdminApiService } from '../server/AdminApiService';
import type { AIProviderConfig, AIStreamChunk, AIUsageMetadata } from './types';
import { decryptApiKey } from './encryption';
import { AIProviderRegistry } from './AIProviderRegistry';

interface CachedCredentials {
    credentials: AIProviderConfig;
    expiresAt: number;
}

export class AIService {
    private adminApiService: AdminApiService;
    private conversationMemory: ConversationMemory;
    private adminApiUrl: string;
    private credentialCache: Map<string, CachedCredentials> = new Map();
    private readonly CREDENTIAL_TTL = 60 * 60 * 1000; // 1 hour
    private providerRegistry: AIProviderRegistry;

    constructor(
        conversationMemory: ConversationMemory,
        adminApiService: AdminApiService,
        adminApiUrl: string
    ) {
        this.conversationMemory = conversationMemory;
        this.adminApiService = adminApiService;
        this.adminApiUrl = adminApiUrl;
        this.providerRegistry = new AIProviderRegistry();
    }

    /**
     * Get available AI providers (for bot editor UI)
     */
    async getAvailableProviders(): Promise<Array<{ providerId: string; name: string }>> {
        try {
            const providers = await this.adminApiService.getAvailableAIProviders(true);
            return providers.map(p => ({
                providerId: p.providerId,
                name: p.name,
            }));
        } catch (error) {
            console.error('[AIService] Error getting available providers:', error);
            return [];
        }
    }

    /**
     * Get provider credentials (with caching)
     */
    private async getProviderCredentials(providerId: string): Promise<AIProviderConfig> {
        // Check cache
        const cached = this.credentialCache.get(providerId);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.credentials;
        }

        // Fetch from Admin API
        const credentialsData = await this.adminApiService.getAIProviderCredentials(providerId);
        if (!credentialsData) {
            throw new Error(`Provider ${providerId} not found or not enabled`);
        }

        // Decrypt API key
        const apiKey = decryptApiKey(credentialsData.apiKeyEncrypted);

        // Build config
        const config: AIProviderConfig = {
            providerId: credentialsData.providerId,
            name: credentialsData.name,
            type: credentialsData.type as AIProviderConfig['type'],
            enabled: credentialsData.enabled,
            endpoint: credentialsData.endpoint,
            apiKeyEncrypted: credentialsData.apiKeyEncrypted,
            model: credentialsData.model,
            temperature: credentialsData.temperature,
            maxTokens: credentialsData.maxTokens,
            supportsStreaming: credentialsData.supportsStreaming,
            settings: credentialsData.settings,
        };

        // Cache
        this.credentialCache.set(providerId, {
            credentials: config,
            expiresAt: Date.now() + this.CREDENTIAL_TTL,
        });

        return config;
    }

    /**
     * Generate streaming bot response
     */
    async *generateBotResponseStream(
        botId: string,
        playerId: number,
        message: string,
        chatInstructions: string,
        providerId: string,
        spaceName: string | undefined,
        conversationContext: string
    ): AsyncGenerator<AIStreamChunk> {
        const startTime = Date.now();

        try {
            // Get provider credentials
            const config = await this.getProviderCredentials(providerId);

            // Build system prompt
            let systemPrompt = chatInstructions || 'You are a friendly bot.';
            if (conversationContext) {
                systemPrompt += `\n\nConversation Context:\n${conversationContext}`;
            }

            // Generate stream
            let tokensUsed = 0;
            let error = false;
            let streamCompleted = false;

            try {
                for await (const chunk of this.providerRegistry.generateStream(
                    providerId,
                    systemPrompt,
                    message,
                    config
                )) {
                    if (chunk.metadata?.tokensUsed) {
                        tokensUsed = chunk.metadata.tokensUsed;
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Received chunk with tokensUsed: ${tokensUsed}`);
                        }
                    }
                    if (chunk.metadata?.error) {
                        error = true;
                    }
                    if (chunk.done) {
                        streamCompleted = true;
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Received done chunk, stream completing`);
                        }
                    }

                    yield chunk;
                }
            } finally {
                // Always track usage, even if stream doesn't complete normally
                const latency = Date.now() - startTime;
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[AIService] Stream loop ended. streamCompleted=${streamCompleted}, tokensUsed=${tokensUsed}, latency=${latency}ms, error=${error}`);
                    console.log(`[AIService] Tracking usage: botId=${botId}, providerId=${providerId}`);
                }
                
                // Always track usage - fire and forget
                this.trackUsage(botId, providerId, {
                    tokensUsed,
                    latency,
                    error,
                }).catch(err => {
                    // Always log errors, even without debug mode
                    console.error('[AIService] Failed to track usage:', err);
                    if (err instanceof Error) {
                        console.error('[AIService] Error details:', err.message);
                    }
                });
            }
        } catch (error: any) {
            const latency = Date.now() - startTime;
            
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[AIService] Error generating response:', error);
            }

            // Track error
            this.trackUsage(botId, providerId, {
                tokensUsed: 0,
                latency,
                error: true,
            }).catch(() => {});

            // Yield error chunk
            yield {
                content: '',
                done: true,
                metadata: {
                    tokensUsed: 0,
                    latency,
                    error: true,
                },
            };
        }
    }

    /**
     * Track AI usage (fire-and-forget)
     */
    private async trackUsage(
        botId: string,
        providerId: string,
        metadata: AIUsageMetadata
    ): Promise<void> {
        try {
            // Calculate cost
            const cost = this.calculateCost(providerId, metadata);

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AIService] trackUsage called: botId=${botId}, providerId=${providerId}, tokensUsed=${metadata.tokensUsed}, cost=${cost}`);
            }

            // Track via Admin API
            await this.adminApiService.trackAIUsage({
                botId,
                providerId,
                tokensUsed: metadata.tokensUsed || 0,
                apiCalls: 1,
                durationSeconds: metadata.durationSeconds ?? null,
                cost,
                latency: metadata.latency,
                error: metadata.error || false,
                timestamp: new Date().toISOString(),
            });

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AIService] Usage tracked successfully for ${providerId}`);
            }
        } catch (error) {
            // Fire-and-forget: don't throw
            console.error('[AIService] Error tracking usage:', error);
            if (process.env.ENABLE_BOT_DEBUG === 'true' && error instanceof Error) {
                console.error('[AIService] Error message:', error.message);
                console.error('[AIService] Error stack:', error.stack);
            }
        }
    }

    /**
     * Calculate cost based on provider pricing model
     */
    private calculateCost(providerId: string, metadata: AIUsageMetadata): number {
        try {
            const cached = this.credentialCache.get(providerId);
            if (!cached) {
                return 0; // Can't calculate without config
            }

            const config = cached.credentials;
            const tokensUsed = metadata.tokensUsed || 0;
            const durationSeconds = metadata.durationSeconds;

            // Voice AI: per-minute pricing
            if (config.type === 'ultravox' || config.type === 'gpt-voice') {
                if (!durationSeconds) {
                    return 0;
                }
                const costPerMinute = config.settings?.costPerMinute || 0.05;
                const durationMinutes = Math.ceil(durationSeconds / 60);
                const minimumMinutes = config.settings?.minimumMinutes || 1;
                const actualMinutes = Math.max(minimumMinutes, durationMinutes);
                return actualMinutes * costPerMinute;
            }

            // LMStudio: per-token pricing (default)
            if (config.type === 'lmstudio') {
                const costPerToken = config.settings?.costPerToken || 0.00001;
                return tokensUsed * costPerToken;
            }

            // OpenAI/Anthropic: per-token with optional markup
            if (config.type === 'openai' || config.type === 'anthropic') {
                const costPerToken = config.settings?.costPerToken || 0.00003;
                const markup = config.settings?.markup || 1.0;
                return (tokensUsed * costPerToken) * markup;
            }

            return 0;
        } catch (error) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[AIService] Error calculating cost:', error);
            }
            return 0;
        }
    }

    /**
     * Clear credential cache (useful for testing)
     */
    clearCache(): void {
        this.credentialCache.clear();
    }
}

