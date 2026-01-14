/**
 * Type definitions for AI infrastructure
 */

/**
 * Provider configuration from Admin API
 */
export interface AIProviderConfig {
    providerId: string;
    name: string;
    type: 'lmstudio' | 'openai' | 'anthropic' | 'ultravox' | 'gpt-voice';
    enabled: boolean;
    endpoint: string;
    apiKeyEncrypted: string | null; // Encrypted API key (or null if not needed)
    model: string;
    temperature: number;
    maxTokens: number;
    supportsStreaming: boolean;
    settings?: Record<string, any>;
}

/**
 * Tool call from AI
 */
export interface ToolCall {
    id: string;
    name: string;
    arguments: string; // JSON string
}

/**
 * Streaming response chunk
 */
export interface AIStreamChunk {
    content: string; // Token content (empty string if done)
    done: boolean; // Whether this is the final chunk
    toolCalls?: ToolCall[]; // Tool calls requested by AI
    metadata?: {
        tokensUsed?: number;
        latency?: number;
        durationSeconds?: number; // For voice AI
        error?: boolean;
    };
}

/**
 * Non-streaming response (fallback)
 */
export interface AIResponse {
    content: string;
    tokensUsed: number;
    latency: number;
    error?: boolean;
}

/**
 * Usage tracking data
 */
export interface AIUsageMetadata {
    tokensUsed?: number;
    apiCalls?: number;
    latency?: number;
    durationSeconds?: number; // For voice AI
    cost?: number;
    error?: boolean;
}

