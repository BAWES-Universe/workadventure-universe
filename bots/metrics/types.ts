/**
 * Metrics Types - Define interfaces for bot metrics collection
 */

export type MetricType = 
    | 'response_time'
    | 'token_usage_prompt'
    | 'token_usage_completion'
    | 'token_usage_total'
    | 'repetition_score'
    | 'system_prompt_leakage'
    | 'personality_compliance'
    | 'conversation_quality'
    | 'error_count';

export interface BotMetrics {
    botId: string;
    timestamp: number;
    metrics: {
        responseTime?: number; // milliseconds
        tokenUsage?: {
            prompt: number;
            completion: number;
            total: number;
        };
        repetitionScore?: number; // 0-1, where 0 = no repetition, 1 = exact duplicate
        systemPromptLeakage?: boolean; // true if system prompt leaked into response
        personalityCompliance?: number; // 0-1, where 1 = perfect match with chat instructions
        conversationQuality?: number; // 0-1, overall quality score
        errorCount?: number;
    };
    metadata?: Record<string, any>; // Additional context (playerId, spaceName, etc.)
}

export interface ConversationMetrics {
    botId: string;
    playerId: number;
    conversationId?: string;
    timestamp: number;
    metrics: {
        totalMessages: number;
        averageResponseTime: number;
        totalTokens: number;
        averageRepetitionScore: number;
        personalityComplianceScore: number;
        conversationLength: number; // in messages
        conversationDuration: number; // in milliseconds
    };
}

export interface ResponseQualityMetrics {
    botId: string;
    playerId: number;
    responseId: string;
    timestamp: number;
    metrics: {
        responseTime: number;
        tokenUsage: number;
        repetitionScore: number;
        systemPromptLeakage: boolean;
        personalityCompliance: number;
        overallQuality: number; // 0-1
    };
    responseText?: string; // Optional, for debugging
    chatInstructions?: string; // Optional, for compliance checking
}

export interface MetricAggregation {
    botId: string;
    metricType: MetricType;
    timeRange: {
        start: number;
        end: number;
    };
    aggregation: {
        count: number;
        sum: number;
        average: number;
        min: number;
        max: number;
        p50?: number; // median
        p95?: number; // 95th percentile
        p99?: number; // 99th percentile
    };
}

export interface MetricQuery {
    botId?: string;
    metricType?: MetricType;
    startTime?: number;
    endTime?: number;
    limit?: number;
    offset?: number;
}
