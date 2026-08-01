/**
 * AI Provider Interface
 * 
 * All AI providers must implement this interface
 */

import type { AIProviderConfig, AIStreamChunk, AIResponse } from './types';

/**
 * Abstract interface for AI providers
 */
export interface AIProvider {
    /**
     * Get provider name
     */
    getName(): string;

    /**
     * Check if provider is ready to use
     */
    isReady(): boolean;

    /**
     * Check if provider supports streaming
     */
    supportsStreaming(): boolean;

    /**
     * Generate streaming response
     * 
     * @param systemPrompt - System prompt/instructions
     * @param userMessage - User message
     * @param config - Provider configuration
     * @param tools - Optional array of tool definitions for function calling
     * @param signal - Optional external AbortSignal; when aborted, the active
     *                 upstream stream/request is cancelled immediately
     * @returns Async generator yielding stream chunks
     */
    generateStream(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[],
        signal?: AbortSignal
    ): AsyncGenerator<AIStreamChunk>;

    /**
     * Generate non-streaming response (fallback)
     * 
     * @param systemPrompt - System prompt/instructions
     * @param userMessage - User message
     * @param config - Provider configuration
     * @param tools - Optional array of tool definitions for function calling
     * @returns Complete response
     */
    generate(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[]
    ): Promise<AIResponse>;
}

