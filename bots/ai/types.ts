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
    supportsVision?: boolean | null; // null/undefined = auto (model-name regex), true = force vision, false = force text-only
    visionModel?: string | null; // model used when this provider describes images (vision fallback)
    defaultVision?: boolean; // preferred vision provider for bots whose main model is text-only
    settings?: Record<string, any>;
    /**
     * Set only for a provider that is a person's own key (#374). `addressTyped` means the person typed the address
     * (their own computer, or their own NIM), so every call to it goes through the address guard.
     */
    ownKey?: { addressTyped: boolean };
    /**
     * Where the part of the system prompt that stays the same from message to message ends, as character offsets into
     * the system prompt, in order. Only the Claude provider reads this (it marks those ends for Claude's cache); every
     * other provider ignores it, so their requests are unchanged.
     */
    promptCacheEnds?: number[];
    /** Called with the cache reads and writes of each finished call (only when there were any), so the caller can total a turn. */
    onCacheTokens?: (read: number, write: number) => void;
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
    reset?: boolean; // If true, frontend should clear current stream content before processing this chunk
    toolNames?: string[]; // Names of tools being called (for status display in the new bubble)
    toolCalls?: ToolCall[]; // Tool calls requested by AI
    metadata?: {
        tokensUsed?: number;
        promptTokens?: number;
        completionTokens?: number;
        /** Part of promptTokens that was read from the provider's cache, and part that was written to it (Claude only for now). */
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        latency?: number;
        durationSeconds?: number; // For voice AI
        error?: boolean;
        errorStatus?: number; // HTTP status the provider answered with when the call failed (401/403 = the key was rejected)
        truncated?: boolean; // true when the provider hit finish_reason='length' (max_tokens cap)
        // MultiPromptAIService analysis metadata
        analysis?: {
            tokensUsed: number;
            inputMessage: string;
            responseContent: string;
            rawResponse: string;
        };
        summarization?: {
            tokensUsed: number;
            preSummaryInput: string;
            responseContent: string;
            rawResponse: string;
        };
        analysisTokens?: number;
        summarizationTokens?: number;
        responseTokens?: number;
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
    truncated?: boolean; // true when the provider hit finish_reason='length' (max_tokens cap)
}

/**
 * Usage tracking data
 */
export interface AIUsageMetadata {
    tokensUsed?: number;
    promptTokens?: number;
    completionTokens?: number;
    /** Part of promptTokens read from / written to the provider's cache (both are inside promptTokens, not on top of it). */
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    apiCalls?: number;
    latency?: number;
    durationSeconds?: number; // For voice AI
    cost?: number;
    error?: boolean;
}

/**
 * AI-detected emotion data from response
 */
export interface AIEmotionData {
    personSentiment: number;       // -100 to 100
    isInsult: boolean;             // Whether the message was an insult
    insultSeverity: number;        // 1-10 if insult, 0 otherwise
    context: 'sarcastic' | 'joking' | 'sincere' | 'frustrated' | 'angry' | 'neutral' | string;
}

/**
 * Parsed AI response with emotion data extracted
 */
export interface ParsedAIResponse {
    cleanedResponse: string;       // Response text with emotion block removed
    emotions: AIEmotionData | null; // Parsed emotion data, null if not found
}
