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
     * Check if the given model config supports vision (image_url content blocks).
     * Tri-state override: null/undefined = auto (model-name regex), true = force vision,
     * false = force text-only. When the model supports vision, the provider may send
     * multipart content (text + image_url blocks); otherwise the caller must pass
     * images as text context instead.
     */
    supportsVision(config: AIProviderConfig): boolean;

    /**
     * Generate streaming response
     * 
     * @param systemPrompt - System prompt/instructions
     * @param userMessage - User message
     * @param config - Provider configuration
     * @param tools - Optional array of tool definitions for function calling
     * @param signal - Optional external AbortSignal; when aborted, the active
     *                 upstream stream/request is cancelled immediately
     * @param images - Optional image URLs to attach as image_url content blocks
     *                 (only honored when supportsVision(config) is true)
     * @returns Async generator yielding stream chunks
     */
    generateStream(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[],
        signal?: AbortSignal,
        images?: string[]
    ): AsyncGenerator<AIStreamChunk>;

    /**
     * Generate non-streaming response (fallback)
     * 
     * @param systemPrompt - System prompt/instructions
     * @param userMessage - User message
     * @param config - Provider configuration
     * @param tools - Optional array of tool definitions for function calling
     * @param signal - Optional external AbortSignal; when aborted, the in-flight
     *                 request is cancelled immediately
     * @param images - Optional image URLs to attach as image_url content blocks
     *                 (only honored when supportsVision(config) is true)
     * @returns Complete response
     */
    generate(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[],
        signal?: AbortSignal,
        images?: string[]
    ): Promise<AIResponse>;
}

