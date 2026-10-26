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
 * What a provider said a call used (#1173). Each figure is absent when the provider did not say. Cached, cache-write and
 * reasoning tokens are parts of the prompt and completion totals, not extra.
 */
export interface AIUsageDetail {
    promptTokens?: number;
    completionTokens?: number;
    cachedPromptTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    costUsd?: number;
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
        /** Prompt tokens the provider served from its cache (a subset of promptTokens). Undefined when the provider does not report it. */
        cachedPromptTokens?: number;
        /** Prompt tokens the provider wrote to its cache on this call (a subset of promptTokens). Undefined when it does not say. */
        cacheWriteTokens?: number;
        completionTokens?: number;
        /** Reasoning tokens inside completionTokens. Undefined when the provider does not say. */
        reasoningTokens?: number;
        /** What the provider charged for this call, in dollars (OpenRouter sends it). Undefined when it does not say. */
        costUsd?: number;
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
    /** The split of tokensUsed and what the provider said about caching, reasoning and cost. Absent when the provider gave none. */
    usage?: AIUsageDetail;
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
