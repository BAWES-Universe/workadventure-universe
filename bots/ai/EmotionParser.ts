/**
 * EmotionParser - Extracts emotion data from AI responses
 * 
 * Parses the [EMOTION_UPDATE]...[/EMOTION_UPDATE] block from AI responses
 * and returns both the cleaned response and the emotion data.
 */

import type { AIEmotionData, ParsedAIResponse } from './types';

const EMOTION_BLOCK_REGEX = /\[EMOTION_UPDATE\]\s*([\s\S]*?)\s*\[\/EMOTION_UPDATE\]/i;

/**
 * Parse AI response to extract emotion data and clean response text
 */
export function parseEmotionsFromResponse(rawResponse: string): ParsedAIResponse {
    const match = rawResponse.match(EMOTION_BLOCK_REGEX);
    
    if (!match) {
        // No emotion block found - return response as-is
        return {
            cleanedResponse: rawResponse.trim(),
            emotions: null,
        };
    }

    // Extract and clean the response (remove the emotion block)
    const cleanedResponse = rawResponse.replace(EMOTION_BLOCK_REGEX, '').trim();
    
    // Parse the emotion JSON
    const emotionJson = match[1].trim();
    let emotions: AIEmotionData | null = null;
    
    try {
        const parsed = JSON.parse(emotionJson);
        
        // Validate and normalize the emotion data
        emotions = {
            personSentiment: clamp(parsed.personSentiment ?? 0, -100, 100),
            isInsult: Boolean(parsed.isInsult),
            insultSeverity: parsed.isInsult ? clamp(parsed.insultSeverity ?? 0, 0, 10) : 0,
            context: normalizeContext(parsed.context),
        };
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[EmotionParser] Parsed emotions:`, emotions);
        }
    } catch (error) {
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.warn(`[EmotionParser] Failed to parse emotion JSON: ${emotionJson}`, error);
        }
        // Return null emotions but still return cleaned response
    }
    
    return {
        cleanedResponse,
        emotions,
    };
}

/**
 * Clamp a number to a range
 */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Normalize context string to expected values
 */
function normalizeContext(context: string | undefined): AIEmotionData['context'] {
    if (!context) return 'neutral';
    
    const normalized = context.toLowerCase().trim();
    const validContexts = ['sarcastic', 'joking', 'sincere', 'frustrated', 'angry', 'neutral'];
    
    if (validContexts.includes(normalized)) {
        return normalized as AIEmotionData['context'];
    }
    
    // Map similar terms
    if (normalized.includes('sarcas') || normalized.includes('ironic')) return 'sarcastic';
    if (normalized.includes('joke') || normalized.includes('humor') || normalized.includes('playful')) return 'joking';
    if (normalized.includes('sincere') || normalized.includes('genuine') || normalized.includes('honest')) return 'sincere';
    if (normalized.includes('frustrat') || normalized.includes('annoy')) return 'frustrated';
    if (normalized.includes('angry') || normalized.includes('mad') || normalized.includes('hostile')) return 'angry';
    
    return normalized; // Return as-is if not mapped
}

/**
 * Check if response contains emotion block
 */
export function hasEmotionBlock(response: string): boolean {
    return EMOTION_BLOCK_REGEX.test(response);
}

/**
 * Appends content from a stream chunk to the accumulated full message.
 * LLM tokenizers (OpenAI, DeepSeek, etc.) already include leading spaces
 * on subsequent tokens (e.g. ["Hello", " world", "!"]). Simply concatenate.
 */
export function appendStreamedChunk(fullMessage: string, chunkContent: string): string {
    return fullMessage + chunkContent;
}

/** Prefix used to detect emotion tags in streaming content */
const EMOTION_TAG_PREFIX = '[EMOTION_UPDATE';

/**
 * Checks if a string ends with a prefix of [EMOTION_UPDATE.
 * Used to detect partial emotion tags at chunk boundaries.
 * 
 * Handles all split points (e.g. "[" / "EMOTION_UPDATE...",
 * "[EMOTIO" / "N_UPDATE...") by matching any contiguous suffix
 * that exactly matches the start of [EMOTION_UPDATE.
 * 
 * Uses endsWith, NOT includes — avoids false positives on text
 * like [EMAIL], [EMIT], [EMERGENCY], [EMOJI].
 * 
 * Returns the length of the matching prefix (1-14), or 0 if no match.
 */
export function detectEmotionPrefixAtEnd(content: string): number {
    for (let i = EMOTION_TAG_PREFIX.length; i >= 1; i--) {
        if (content.endsWith(EMOTION_TAG_PREFIX.substring(0, i))) {
            return i;
        }
    }
    return 0;
}
