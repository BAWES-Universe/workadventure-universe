/**
 * Type definitions for AI infrastructure
 */

import type { ToolStep, ToolStepResult } from './ToolSteps';

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
    /** The bot's limits (Orbit #666), when Orbit served them with the bot's credentials. */
    limits?: BotLimits;
}

/**
 * A bot's limits as Orbit serves them with its credentials (Orbit #666): set by a super admin for Universe AI, by a
 * key's owner for their key, lowered by the bot's editors. Each one is read with its recommended value as the fallback
 * (BOT_LIMIT_DEFAULTS), for an Orbit that does not send them yet.
 */
export interface BotLimits {
    replyTokens: number;
    /** Tool steps in one reply. */
    steps: number;
    /** Times a cut-off chat answer carries on by itself. */
    continuations: number;
    /** Earlier messages in the chat the bot reads before each reply. */
    messages: number;
    /** Characters it takes in from one web page or file. */
    readChars: number;
    /** Seconds it waits when its AI goes quiet. */
    waitSeconds: number;
    artifactBytes: number;
    /** 0 keeps every version. */
    artifactVersions: number;
    artifactSaveSeconds: number;
    /** "Say when nothing was saved". */
    guard: boolean;
    /** Files in chats (#1508): this person's newest files the bot sees before each reply. */
    recentFiles: number;
    /** Files found in one search. */
    findResults: number;
    /** Characters it reads from an earlier file at a time. */
    partChars: number;
    /** Characters of step results one reply keeps. */
    roomChars: number;
    /** Characters of a file's text Orbit keeps ("Text kept from a file"). */
    fileTextChars: number;
}

/** The recommended limits, the same as Orbit's (lib/bot-limit-values.ts there). */
export const BOT_LIMIT_DEFAULTS: BotLimits = {
    replyTokens: 32000,
    steps: 30,
    continuations: 2,
    messages: 20,
    readChars: 50000,
    waitSeconds: 60,
    artifactBytes: 2 * 1024 * 1024,
    artifactVersions: 0,
    artifactSaveSeconds: 30,
    guard: true,
    recentFiles: 5,
    findResults: 10,
    partChars: 8000,
    roomChars: 80000,
    fileTextChars: 2_000_000,
};

/** Limits where 0 means something: keep every version, never carry on by itself, no newest files in the prompt. A 0
 * anywhere else (a save with no time limit) is broken. */
const ZERO_ALLOWED = new Set<keyof BotLimits>(['artifactVersions', 'continuations', 'recentFiles']);

/** The limits Orbit sent, each checked, with the recommended value for any that is missing or broken. */
export function readBotLimits(raw: unknown): BotLimits {
    const out: BotLimits = { ...BOT_LIMIT_DEFAULTS };
    if (!raw || typeof raw !== 'object') return out;
    const given = raw as Record<string, unknown>;
    for (const key of Object.keys(BOT_LIMIT_DEFAULTS) as (keyof BotLimits)[]) {
        const value = given[key];
        if (key === 'guard') {
            if (typeof value === 'boolean') out.guard = value;
        } else if (typeof value === 'number' && Number.isFinite(value) && (value > 0 || (value === 0 && ZERO_ALLOWED.has(key)))) {
            (out as unknown as Record<string, number>)[key] = value;
        }
    }
    return out;
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
/** A reply limit the person reached (#1159): no AI was called, and the caller shows them the fixed card instead. */
export interface ReplyLimitReached {
    limit: 'universe-ai' | 'guest' | 'guests' | 'bot';
    /** When the bot answers them again (ISO). */
    resetsAt: string;
    /** Which button the card shows: Sign in (guest), Ask the maker (member) or Use my AI key (maker). */
    who: 'guest' | 'member' | 'maker';
}

export interface AIStreamChunk {
    content: string; // Token content (empty string if done)
    done: boolean; // Whether this is the final chunk
    /** Set on the only chunk of a reply stopped by a reply limit (#1159). */
    replyLimit?: ReplyLimitReached;
    reset?: boolean; // If true, frontend should clear current stream content before processing this chunk
    toolNames?: string[]; // Names of tools being called (for status display in the new bubble)
    /** The calls this reset starts, in plain words, for the steps line of a direct message (#1545). */
    toolSteps?: ToolStep[];
    /** How the calls of the last round ended: sent once they ran, before the bot carries on. */
    toolStepResults?: ToolStepResult[];
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
        /** The call was stopped from outside (a stop or a correction) before it said what it used; it cannot be priced and is left out of the reply's cost. */
        cancelled?: boolean;
        errorStatus?: number; // HTTP status the provider answered with when the call failed (401/403 = the key was rejected)
        truncated?: boolean; // true when the provider hit finish_reason='length' (max_tokens cap)
        /** Why the provider ended the call ('stop', 'length', 'tool_calls', ...), when it said. */
        finishReason?: string;
        /** What the provider said when the call failed, short and without logins (see providerErrorText). */
        errorText?: string;
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
    /** Parts of promptTokens the provider read from / wrote to its cache, and of completionTokens spent reasoning. */
    cachedPromptTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
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
