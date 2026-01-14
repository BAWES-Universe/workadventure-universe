/**
 * AI Provider Registry
 * 
 * Manages provider instances and routes requests to the correct provider
 */

import type { AIProvider } from './AIProvider';
import type { AIProviderConfig, AIStreamChunk, AIResponse } from './types';
import { LMStudioProvider } from './providers/LMStudioProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';

export class AIProviderRegistry {
    private providers: Map<string, AIProvider> = new Map();

    /**
     * Register a provider instance
     */
    registerProvider(providerId: string, provider: AIProvider): void {
        this.providers.set(providerId, provider);
    }

    /**
     * Get provider instance by providerId
     */
    getProvider(providerId: string): AIProvider | null {
        return this.providers.get(providerId) || null;
    }

    /**
     * Get or create provider instance based on config
     */
    getOrCreateProvider(config: AIProviderConfig): AIProvider {
        // Check if provider already exists
        const existing = this.providers.get(config.providerId);
        if (existing) {
            return existing;
        }

        // Create new provider based on type
        let provider: AIProvider;

        switch (config.type) {
            case 'lmstudio':
                provider = new LMStudioProvider();
                break;
            case 'openai':
                provider = new OpenAIProvider();
                break;
            case 'anthropic':
                // TODO: Implement AnthropicProvider
                throw new Error(`Provider type 'anthropic' not yet implemented`);
            case 'ultravox':
                // TODO: Implement UltravoxProvider
                throw new Error(`Provider type 'ultravox' not yet implemented`);
            case 'gpt-voice':
                // TODO: Implement GPTVoiceProvider
                throw new Error(`Provider type 'gpt-voice' not yet implemented`);
            default:
                throw new Error(`Unknown provider type: ${config.type}`);
        }

        // Register and return
        this.registerProvider(config.providerId, provider);
        return provider;
    }

    /**
     * Generate streaming response
     */
    async *generateStream(
        providerId: string,
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[]
    ): AsyncGenerator<AIStreamChunk> {
        const provider = this.getOrCreateProvider(config);

        if (!provider.isReady()) {
            throw new Error(`Provider ${providerId} is not ready`);
        }

        if (!provider.supportsStreaming()) {
            // Fallback to non-streaming
            const response = await provider.generate(systemPrompt, userMessage, config, tools);
            yield {
                content: response.content,
                done: false,
                metadata: {
                    tokensUsed: response.tokensUsed,
                    latency: response.latency,
                    error: response.error,
                },
            };
            yield {
                content: '',
                done: true,
                metadata: {
                    tokensUsed: response.tokensUsed,
                    latency: response.latency,
                    error: response.error,
                },
            };
            return;
        }

        // Use streaming
        yield* provider.generateStream(systemPrompt, userMessage, config, tools);
    }

    /**
     * Clear provider cache (useful for testing or reconfiguration)
     */
    clear(): void {
        this.providers.clear();
    }
}

