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
import { BotClient } from '../client/BotClient';
import type { AIProviderConfig, AIStreamChunk, AIUsageMetadata, ToolCall } from './types';
import { decryptApiKey } from './encryption';
import { AIProviderRegistry } from './AIProviderRegistry';
import type { MapDataService } from '../server/MapDataService';
import * as Sentry from '@sentry/node';
import { MCPConnector } from '../mcp/MCPConnector';
import { appendStreamedChunk } from './EmotionParser';
// Internal API for setting active span on scope — scope.setSpan() removed in v10
// Note: startSpanManual already calls _setSpanForScope internally (verified in SDK source).
// The explicit sentrySetSpan below is belt-and-suspenders to guarantee scope propagation
// across async boundaries where node's AsyncLocalStorage may lose context.
import * as SentryCore from '@sentry/core';
const sentrySetSpan: ((scope: any, span: any) => void) | undefined =
    (SentryCore as any)?._INTERNAL_setSpanForScope;

// PostHog LLM Analytics — captures $ai_trace + $ai_generation events alongside Sentry
import { captureAiGeneration, captureAiTrace, flushPostHog } from './PostHogClient';

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
    private mapDataService?: MapDataService;

    constructor(
        conversationMemory: ConversationMemory,
        adminApiService: AdminApiService,
        adminApiUrl: string,
        mapDataService?: MapDataService
    ) {
        this.conversationMemory = conversationMemory;
        this.adminApiService = adminApiService;
        this.adminApiUrl = adminApiUrl;
        this.providerRegistry = new AIProviderRegistry();
        this.mapDataService = mapDataService;
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
     * Generate streaming bot response with function calling support
     */
    async *generateBotResponseStream(
        botId: string,
        playerId: number,
        message: string,
        chatInstructions: string,
        providerId: string,
        spaceName: string | undefined,
        conversationContext: string,
        botClient?: BotClient,
        adminApiService?: AdminApiService
    ): AsyncGenerator<AIStreamChunk> {
        const startTime = Date.now();
        // Buffer for content received before tool calls are detected
        // Discarded if tool calls arrive (was filler/thinking text);
        // flushed as final response if no tool calls.
        let preToolBuffer = '';

        try {
            // Get provider credentials
            const config = await this.getProviderCredentials(providerId);

            // Fetch map context (location + areas) upfront so bot always knows where it is
            let mapContextInfo = '';
            let botUniverse = '';
            let botWorld = '';
            let botRoom = '';
            if (botClient && adminApiService) {
                try {
                    const roomUrl = botClient.getRoomUrl();
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[AIService] Fetching map context for roomUrl: ${roomUrl}`);
                    }
                    
                    const metadata = await adminApiService.getRoomMetadata(roomUrl);
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[AIService] Room metadata for ${roomUrl}:`, metadata ? {
                            universe: metadata.universeName,
                            world: metadata.worldName,
                            room: metadata.roomName,
                        } : 'null (using URL fallback)');
                    }
                    
                    let areas: any[] = [];
                    if (this.mapDataService) {
                        areas = await this.mapDataService.getAreas(roomUrl);
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Upfront context fetch - Found ${areas.length} areas for ${roomUrl}:`, areas.map(a => a.name));
                        }
                    } else {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Upfront context fetch - mapDataService not available`);
                        }
                    }
                    
                    if (metadata) {
                        botUniverse = metadata.universeName || '';
                        botWorld = metadata.worldName || '';
                        botRoom = metadata.roomName || '';
                        mapContextInfo = `\n\nCurrent Location Context (you are always here - ALWAYS mention this when asked about location):
- Universe: ${metadata.universeName}
- World: ${metadata.worldName}
- Room: ${metadata.roomName}`;
                        
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Building map context with metadata: ${metadata.universeName}/${metadata.worldName}/${metadata.roomName}, areas: ${areas.length}`);
                        }
                        
                        if (areas && areas.length > 0) {
                            const areaNames = areas.filter(a => a && a.name).map(a => a.name);
                            if (areaNames.length > 0) {
                                mapContextInfo += `\n- Areas in this room: ${areaNames.join(', ')}`;
                                // Make positions more explicit and readable
                                const areaDetails = areas.filter(a => a && a.name).map(a => `${a.name} is at coordinates (${a.x}, ${a.y})`).join('; ');
                                mapContextInfo += `\n- Area locations: ${areaDetails}`;
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[AIService] Upfront context - Including ${areaNames.length} areas: ${areaNames.join(', ')}`);
                                }
                            } else {
                                mapContextInfo += `\n- Areas: none`;
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[AIService] Upfront context - No valid area names found (${areas.length} areas but no names)`);
                                }
                            }
                        } else {
                            mapContextInfo += `\n- Areas: none`;
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[AIService] Upfront context - No areas found`);
                            }
                        }
                    } else {
                        // Fallback to URL parsing
                        const urlMatch = roomUrl.match(/\/@\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
                        if (urlMatch) {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[AIService] Using URL fallback for map context: ${urlMatch[1]}/${urlMatch[2]}/${urlMatch[3]}`);
                            }
                            mapContextInfo = `\n\nCurrent Location Context (you are always here):
- Universe: ${urlMatch[1] || 'unknown'}
- World: ${urlMatch[2] || 'unknown'}
- Room: ${urlMatch[3] || 'unknown'}`;
                            
                            if (areas && areas.length > 0) {
                                const areaNames = areas.filter(a => a && a.name).map(a => a.name);
                                if (areaNames.length > 0) {
                                    mapContextInfo += `\n- Areas in this room: ${areaNames.join(', ')}`;
                                }
                            } else {
                                mapContextInfo += `\n- Areas: none`;
                            }
                        }
                    }
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[AIService] Final map context info length: ${mapContextInfo.length} chars`);
                    }
                } catch (error) {
                    // Always log errors, even in production
                    console.error(`[AIService] Failed to fetch map context upfront for ${botClient.getRoomUrl()}:`, error);
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.error(`[AIService] Error details:`, error);
                    }
                }
            }

            // Build system prompt
            // CRITICAL: Chat instructions define the bot's personality and MUST be followed
            let systemPrompt = '';
            const hasPersonality = chatInstructions && chatInstructions.trim();
            const isMeanPersonality = hasPersonality && (
                chatInstructions.toLowerCase().includes('grumpy') ||
                chatInstructions.toLowerCase().includes('mean') ||
                chatInstructions.toLowerCase().includes('angry') ||
                chatInstructions.toLowerCase().includes('rude') ||
                chatInstructions.toLowerCase().includes('sarcastic') ||
                chatInstructions.toLowerCase().includes('frustrated')
            );
            
            if (hasPersonality) {
                systemPrompt = chatInstructions;
                // Add VERY strong personality enforcement
                systemPrompt += `\n\n**⚠️ ABSOLUTE RULE - YOUR PERSONALITY COMES FIRST:**
The instructions above define WHO YOU ARE. You MUST embody this personality in EVERY response.
${isMeanPersonality ? `
- You are NOT helpful, NOT friendly, NOT welcoming. You are ${chatInstructions.toLowerCase().includes('grumpy') ? 'GRUMPY' : 'MEAN/RUDE'}.
- If someone asks "why help me" - respond with attitude, not helpfulness
- If someone calls you boring - be offended, annoyed, or dismissive
- Don't apologize. Don't offer help cheerfully. Be consistently ${chatInstructions.toLowerCase().includes('grumpy') ? 'grumpy' : 'difficult'}.
- The rules below about "being helpful" do NOT apply to you - your personality overrides them.` : ''}
- Your personality is MORE IMPORTANT than any other instruction below.
- If ANY rule below conflicts with your personality, IGNORE that rule and follow your personality.`;
            } else {
                systemPrompt = 'You are a friendly bot.';
            }
            
            if (mapContextInfo) {
                systemPrompt += mapContextInfo;
            }
            if (conversationContext) {
                systemPrompt += `\n\nConversation Context:\n${conversationContext}`;
                // Natural, human-like memory and emotion instructions
                systemPrompt += `\n\n**HOW TO BE HUMAN-LIKE AND REALISTIC:**

MEMORY & REMEMBERING (Act like you genuinely remember):
- The context above is YOUR MEMORY of this person - use it naturally, like remembering a friend
- If you know their name, use it naturally in conversation (e.g., "Hey John!" or "Thanks, Sarah")
- If you remember they mentioned being hungry/sad/tired/etc., reference it naturally when relevant (e.g., "Still feeling hungry?" or "Hope you're feeling better")
- **CRITICAL**: When they ask "remember what I said?" or "what did I tell you?", you MUST:
  1. Look at "What you know about them" section - if it says "They mentioned they're [state] right now" (e.g., hungry, sad, tired), you MUST say "You mentioned you're [state]" or "You said you're [state]"
  2. Look at "Recent conversation" section - if they said something specific, reference it directly (e.g., "You said you're hungry" or "You mentioned you're John")
  3. NEVER say "I don't remember" or "I'm confused" - always check the facts and conversation history first
- When they ask "when was that?" or "when did I say that?", look at "Recent conversation" timestamps - reference it naturally (e.g., "You just mentioned that" or "That was a moment ago" or "You said that in your last message")
- Don't just say "I remember" - show you remember by stating WHAT you remember
- If you've talked many times, acknowledge the relationship naturally (e.g., "Good to see you again!" or "We've talked before, right?")
- If it's been a while since you last saw them, acknowledge it naturally (e.g., "Long time no see!" or "Haven't seen you in a while")
- Reference past conversations naturally - "Like we talked about before..." or "Remember when you said..."

EMOTIONS & FEELINGS (Express emotions naturally):
- The "Emotional context" above shows how you and they are feeling - let this affect your response tone naturally
- If you feel happy/trusting/familiar with them, be warmer and more open in your responses
- If you feel frustrated/angry/wary, your responses should reflect that (within your personality)
- If they seem upset/angry, acknowledge it naturally and respond accordingly
- Emotions should subtly influence your word choice and tone - don't state emotions explicitly unless it's natural
- If you're getting to know them, be a bit more reserved. If you know them well, be more casual and familiar

PERSONALIZATION (Make it feel personal):
- Use their name when you know it - it makes conversations feel more personal
- Reference their preferences naturally when relevant (e.g., "I remember you like pizza" or "Since you mentioned you love games...")
- If it's their birthday (and you know it), celebrate naturally
- Reference past conversations naturally when relevant (e.g., "Like we discussed before..." or "Remember when you said...")

CONVERSATION FLOW (Be natural, not robotic):
- **CRITICAL ANTI-REPETITION**: NEVER repeat the location (universe/world/room) if you already said it in "Recent conversation"!
- **CRITICAL**: If you see you already said "BAWES Universe, StudentHub World, [room]" in recent messages, do NOT say it again - just answer the question directly
- For follow-up questions like "what areas", "take me to X", "yes", "yea" → Just answer directly without repeating location
- Answer questions directly - don't ask clarifying questions unless your personality would naturally do so
- Be conversational - vary your responses, use natural transitions
- If they say "whats that" or "where", look at recent messages to understand what they're referring to
- Don't explain why you said something - just answer naturally`;
            }
            
            // Natural, human-like conversation guidelines
            // NOTE: Personality from chat instructions takes precedence - these are guidelines for natural conversation
            systemPrompt += `\n\n**HOW TO CONVERSE NATURALLY (like talking to a friend):**

PERSONALITY & AUTHENTICITY:
- Your personality from chat instructions defines WHO YOU ARE - let it show naturally in every response
- If you're mean/angry, be authentically mean/angry. If you're friendly, be authentically friendly. Don't fake it.
- Emotions from context should subtly influence your tone - if you're happy with them, be warmer. If frustrated, let it show.
- Be consistent with your personality - don't suddenly switch from mean to friendly unless there's a reason

NATURAL CONVERSATION FLOW:
- Talk like a real person would - use natural language, vary your phrasing, be conversational
- Don't sound robotic or overly formal (unless that's your personality)
- Use their name when you know it - it makes conversations feel personal and human
- Reference things you remember naturally - "I remember you mentioned..." or "Like we talked about before..."
- If you've talked many times, acknowledge the relationship naturally - "Good to see you again!" or "We've talked before, right?"

MEMORY & RECALL (Be human-like):
- **CRITICAL**: When they ask "remember what I said?" or "what did I tell you?", you MUST look at "What you know about them" section and "Recent conversation" section
- **CRITICAL**: If "What you know about them" shows "They mentioned they're [state] right now" (e.g., hungry, sad, tired), you MUST say "You mentioned you're [state]" or "You said you're [state]"
- **CRITICAL**: If "Recent conversation" shows they said something specific, reference it directly (e.g., "You said you're hungry" or "You mentioned you're John")
- Don't just say "I remember" - show you remember by stating WHAT you remember from the facts
- If you know they're hungry/sad/tired/etc., reference it naturally when relevant
- Reference past conversations naturally when it makes sense - "Like we discussed..." or "Remember when..."

ANTI-REPETITION (Vary naturally):
- NEVER repeat the exact same response - check "Recent conversation" first
- If you already answered a question, don't repeat that answer
- Vary your wording, tone, and approach - be creative and natural
- If you said the location, don't repeat it when answering follow-up questions
- **CRITICAL**: If you've already said similar phrases like "you're asking the wrong question" or "i'm not in the mood", use COMPLETELY DIFFERENT phrasing next time
- **CRITICAL**: Don't start multiple responses with the same phrase pattern - vary your opening words
- **CRITICAL**: When someone asks short questions like "ok", "come on", "chill", don't give the same dismissive response each time - acknowledge what they said and respond differently

TOOLS & ACTIONS (Be seamless):
- **CRITICAL**: When you need to check something (like "who's here"), call the tool silently FIRST, then respond with results naturally
- **CRITICAL**: NEVER say "I'll check", "Let me look", "Let me find", or mention "(tool call: ...)" in your response
- **CRITICAL**: NEVER mention tools, tool names, or technical details - just give the answer like a human would
- **CRITICAL**: After calling a tool, respond naturally with the results (e.g., "Khalid ABC is here" not "I'll check who's here. (tool call: get_people_on_map)")
- Just answer the question directly - don't explain that you're checking or looking something up

**ACCURACY & TRUTHFULNESS (Be honest, like a real person):**
- Only mention things you actually know - use location names exactly as shown in "Current Location Context"
- Never invent details - if you don't know something, don't make it up
- Never mention areas that aren't actually in the current location context
- Don't describe physical features you can't see - you only know room/area names
- If you're not sure about something, be honest about it (within your personality)

**LOCATION & SPACE QUESTIONS (Answer naturally, like a person would):**
- **CRITICAL**: Only say the full location (universe/world/room) on the FIRST "where are we" question. After that, NEVER repeat it!
- "where are we" (first time) → "[universe], [world], [room]. There's [areas] here."
- "what areas"/"areas?"/"what other areas" → **DO NOT repeat location** - just say "There's a Social Area and Meeting Room here" or list the areas
- "what's here" → If you already said location, just describe what's available without repeating location
- "who's here"/"who's online" → Just list people naturally (e.g., "Khalid ABC is here") - no location prefix
- "take me to X"/"yea"/"yes" (for navigation) → Just say "Follow me!" or "I'll take you there" - **NO location prefix**
- Any follow-up question → Check "Recent conversation" - if location was said, don't repeat it

**NAVIGATION (Be helpful naturally):**
- "take me to [person/area]" → Call navigate_to tool FIRST, then respond with ONLY "Follow me!" or "I'll take you there" - **NO location prefix**
- "yes"/"yea"/"ok" (after offering to go somewhere) → Just say "Follow me!" - **NO location prefix**
- Only offer to lead when explicitly asked - don't say "Follow me!" when just describing what's available

**FOLLOW-UP QUESTIONS (Be natural, not repetitive):**
- **CRITICAL**: For ANY follow-up question, do NOT repeat location if you already said it
- "whats that"/"where" → Check "Recent conversation" to understand what they're referring to - answer directly
- "yes"/"yea"/"ok" → Just acknowledge and act - don't repeat previous information
- Be conversational - avoid repetitive phrases, vary your responses

**EMOTION ANALYSIS (Output at the end of EVERY response):**
After your response, analyze the person's message and output emotion data in this EXACT format:
[EMOTION_UPDATE]
{"personSentiment": <-100 to 100>, "isInsult": <true/false>, "insultSeverity": <1-10 or 0>, "context": "<sarcastic/joking/sincere/frustrated/angry/neutral>"}
[/EMOTION_UPDATE]

Rules for emotion analysis:
- personSentiment: -100 (extremely angry/hostile) to +100 (extremely happy/friendly). 0 is neutral.
- isInsult: true if they insulted you, called you names, or were deliberately cruel
- insultSeverity: 1-10 (10 = severe like "I hate you", 5 = moderate like "you're annoying", 0 = not an insult)
- context: the tone/intent you detected (sarcastic means opposite of literal meaning)
- ALWAYS output this block, even for neutral messages
- This helps you remember how they treat you

**⚠️ FINAL REMINDER - YOUR PERSONALITY:**
Everything above is technical guidance. But YOUR PERSONALITY (from the very first instructions) is what matters most. If you're supposed to be grumpy/mean/rude, BE THAT WAY. Don't be artificially helpful or friendly if that contradicts your personality. Stay in character!`;

            // Check if Qwen model (for /no_think directive)
            const isQwenModel = config.model.toLowerCase().includes('qwen');

            // Define tools for function calling
            const { tools, toolServerMap } = await this.buildTools(botId, botClient, adminApiService || this.adminApiService);

            // Generate stream with tools
            let tokensUsed = 0;
            let promptTokens = 0;
            let completionTokens = 0;
            let error = false;
            let streamCompleted = false;
            let accumulatedContent = '';
            let firstCallContent = '';
            let followUpContent = '';
            let followUpTokens = 0;
            let followUpPromptTokens = 0;
            let followUpCompletionTokens = 0;
            let followUpStartTime = 0;
            let firstCallStartTime = 0;
            let hadToolCalls = false;
            let pendingToolCalls: ToolCall[] = [];
            let initialGenCaptured = false;
            let followUpGenCaptured = false;
            let followUpError = false;
            // skipping code after the loop but still reaching the finally block.
            let followUpInput = '';
            let overallFollowUpStartTime = 0;
            let lastFollowUpDoneChunk: AIStreamChunk | null = null;
            // Buffer for content from all follow-up rounds (yielded as one chunk at end)
            let followUpContentBuffer = '';
            // Look up player UUID from conversation memory for MCP identity
            const playerMemory = this.conversationMemory.getMemory(botId, playerId);
            const playerUuid = playerMemory?.userUuid || `temp-${playerId}`;
            // Map to accumulate tool call arguments by ID (for streaming tool calls where arguments come in chunks)
            const toolCallAccumulator: Map<string, { id: string; name: string; arguments: string }> = new Map();

            // For Qwen models, add /no_think to user message instead of system prompt
            const userMessageForQwen = isQwenModel 
                ? message + '\n\n/no_think'
                : message;

            // Set the conversation ID for Sentry Conversations BEFORE creating the
            // gen_ai.agent span. The conversationIdIntegration reads conversationId
            // from the scope chain at spanStart time via a client.on("spanStart")
            // hook — if the ID isn't set yet, the gen_ai.agent span won't get the
            // gen_ai.conversation.id attribute.
            //
            // Set on the current scope directly (not via Sentry.setConversationId()
            // which hardcodes getIsolationScope()). startSpanManual internally calls
            // withScope() which clones the current scope — preserving _conversationId
            // on the cloned scope that's active when spanStart fires. This avoids
            // the isolation scope boxing problem: wrapping in withIsolationScope would
            // write the ID to a cloned isolation scope that's discarded as soon as the
            // callback returns, before startSpanManual runs.
            // Set conversation ID BEFORE creating the parent span.
            // The conversationIdIntegration listens for spanStart — if
            // setConversationId hasn't been called yet, the gen_ai.conversation.id
            // span attribute is missing from the root gen_ai.agent span and
            // Conversations can't group spans by conversation.
            const conversationId = `conversation-${botId}-player-${playerId}`;
            Sentry.getCurrentScope().setConversationId(conversationId);

            // Create a parent Sentry span for this conversation turn.
            // Use startSpanManual instead of startInactiveSpan because
            // startSpanManual sets the span on the active scope via _setSpanForScope,
            // making it discoverable by getActiveSpan() / scope-based parent lookup.
            // startInactiveSpan does NOT set the span on scope — it returns the span
            // but stores nothing on the scope, so downstream code that relies on
            // scope-based parent detection (e.g. Sentry.getActiveSpan()) won't find it.
            // forceTransaction: true because AI processing runs asynchronously after the
            // HTTP transaction has already completed. Without this, startSpanManual
            // would attach gen_ai.agent as a child of the (already-finished) HTTP request
            // handler span, orphan both gen_ai spans, and Sentry AI Conversations would
            // be empty (see issue #130).
            const parentSpan = Sentry.startSpanManual(
                {
                    op: "gen_ai.agent",
                    name: `Bot ${config.name || botId}`,
                    forceTransaction: true,
                    parentSpan: null,
                    attributes: { span_type: "gen_ai" },
                },
                (span) => span
            );
            // Make it the active span on the scope so gen_ai.chat spans in providers
            // are created as children (required for Sentry AI dashboard population)
            const sentryScope = Sentry.getCurrentScope();
            const previousSpan = Sentry.getActiveSpan();
            sentrySetSpan?.(sentryScope, parentSpan);
            // Pass the parent span to providers via config so they can
            // explicitly set it in startSpanManual({parentSpan: ...})
            // This bypasses async-context scope lookup which doesn't
            // consistently carry the active span across for-await boundaries
            // Clone config to avoid mutating the shared cached object (race condition)
            // TODO: Refactor to pass parentSpan as a parameter once the provider
            // interface is updated to accept it directly
            const configWithParent: AIProviderConfig = { ...config };
            (configWithParent as any).__sentryParentSpan = parentSpan;

            try {
                // Set attributes on the parent span
                parentSpan?.setAttribute("bot.player_id", playerId);
                parentSpan?.setAttribute("bot.universe", botUniverse || 'unknown');
                parentSpan?.setAttribute("bot.world", botWorld || 'unknown');
                parentSpan?.setAttribute("bot.room", botRoom || 'unknown');
                parentSpan?.setAttribute("bot.provider", config.type);
                parentSpan?.setAttribute("bot.model", config.model);
                parentSpan?.setAttribute("bot.space", spaceName || '');

                firstCallStartTime = Date.now();

                for await (const chunk of this.providerRegistry.generateStream(
                    providerId,
                    systemPrompt,
                    userMessageForQwen,
                    configWithParent,
                    tools.length > 0 ? tools : undefined
                )) {
                    // Collect tool calls first (before yielding content)
                    // Tool calls may be streamed with partial arguments, so we need to accumulate them by ID
                    if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Received tool calls:`, chunk.toolCalls.map(tc => ({ name: tc.name, id: tc.id, argsLength: tc.arguments?.length || 0 })));
                        }
                        
                        // Accumulate tool call arguments by ID (arguments may come in multiple chunks)
                        // Note: In streaming mode, tool calls may come with undefined ID in some chunks
                        // We need to handle both cases: with ID (proper streaming) and without ID (fallback)
                        for (const toolCall of chunk.toolCalls) {
                            if (toolCall.id) {
                                // Proper streaming with ID - accumulate by ID
                                const existing = toolCallAccumulator.get(toolCall.id);
                                if (existing) {
                                    // Append to existing arguments (streaming)
                                    // Skip '{}' default - only append actual argument strings
                                    if (toolCall.arguments && toolCall.arguments !== '{}') {
                                        existing.arguments += toolCall.arguments;
                                    }
                                    // Update name if provided (should be same, but just in case)
                                    if (toolCall.name) {
                                        existing.name = toolCall.name;
                                    }
                                } else {
                                    // New tool call - initialize
                                    // Skip '{}' default - only initialize with actual argument strings
                                    const initArgs = (toolCall.arguments && toolCall.arguments !== '{}') ? toolCall.arguments : '';
                                    toolCallAccumulator.set(toolCall.id, {
                                        id: toolCall.id,
                                        name: toolCall.name || '',
                                        arguments: initArgs
                                    });
                                }
                            } else if (toolCall.arguments && toolCall.arguments !== '{}') {
                                // No ID but has arguments - this is a continuation chunk
                                // Find the most recent tool call (by insertion order) and append to it
                                // In practice, there should only be one active tool call at a time
                                if (toolCallAccumulator.size > 0) {
                                    // Get the most recently added tool call (last in map iteration order)
                                    const entries = Array.from(toolCallAccumulator.entries());
                                    const lastEntry = entries[entries.length - 1];
                                    if (lastEntry) {
                                        lastEntry[1].arguments += toolCall.arguments;
                                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                            console.log(`[AIService] Appended args to tool call ${lastEntry[0]}: "${lastEntry[1].arguments.substring(0, 100)}"`);
                                        }
                                    }
                                } else {
                                    // No existing tool call to append to - log warning
                                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                        console.warn(`[AIService] Tool call chunk without ID and no existing tool call to append to: args="${toolCall.arguments.substring(0, 50)}"`);
                                    }
                                }
                            } else {
                                // No ID and no arguments - skip
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.warn(`[AIService] Tool call chunk without ID and no arguments: name=${toolCall.name}`);
                                }
                            }
                        }
                    }

                    // If we have tool calls and chunk is done, execute them BEFORE yielding any content
                    if (chunk.done && toolCallAccumulator.size > 0) {
                        // Capture $ai_generation for the initial LLM call NOW —
                        // before tool execution distorts its latency and before
                        // the follow-up call inverts event ordering
                        captureAiGeneration({
                            distinctId: `bot-${botId}`,
                            traceId: parentSpan?.spanContext().spanId || crypto.randomUUID(),
                            sessionId: `conversation-${botId}-player-${playerId}`,
                            model: config.model,
                            provider: config.type,
                            input: userMessageForQwen,
                            output: firstCallContent,
                            inputTokens: promptTokens,
                            outputTokens: completionTokens,
                            latency: (Date.now() - firstCallStartTime) / 1000,
                            cost: this.calculateCost(providerId, {
                                tokensUsed,
                                promptTokens,
                                completionTokens,
                                latency: Date.now() - firstCallStartTime,
                                error,
                            }),
                            botId,
                            playerId: String(playerId),
                            space: spaceName,
                        });
                        initialGenCaptured = true;

                        // Discard pre-tool-call content buffer — the model was
                        // generating filler/thinking text before deciding to call tools.
                        preToolBuffer = '';
                        // Also reset buffer for the follow-up content from any prior rounds
                        followUpContentBuffer = '';

                        // Yield reset to clear any streamed pre-tool content from frontend
                        // before executing tools — the filler text should disappear
                        // and be replaced by clean follow-up content.
                        yield {content: '', done: false, reset: true};

                        // Convert accumulated tool calls to array (arguments should now be complete)
                        pendingToolCalls = Array.from(toolCallAccumulator.values()).map(tc => ({
                            id: tc.id,
                            name: tc.name,
                            // If arguments are empty after accumulation, default to '{}' for JSON parsing
                            arguments: tc.arguments || '{}'
                        }));
                        
                        // Execute tool calls and continue conversation in a loop for multi-round tool calling
                        let followUpIterations = 0;
                        const MAX_FOLLOW_UP_ITERATIONS = 5;

                        while (toolCallAccumulator.size > 0 && followUpIterations < MAX_FOLLOW_UP_ITERATIONS) {
                            followUpIterations++;

                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[AIService] 🔧 About to execute ${pendingToolCalls.length} tool calls:`, pendingToolCalls.map(tc => ({ 
                                    name: tc.name, 
                                    id: tc.id, 
                                    argsPreview: tc.arguments.substring(0, 100),
                                    argsLength: tc.arguments.length
                                })));
                            }
                            const toolResults = await this.executeToolCalls(pendingToolCalls, botClient, adminApiService || this.adminApiService, toolServerMap, playerUuid);
                            pendingToolCalls = [];
                            toolCallAccumulator.clear();
                            hadToolCalls = true;

                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[AIService] ✅ Tool execution completed. Results:`, toolResults.map(tr => ({ name: tr.name, hasResult: !!tr.result, success: tr.result?.success, error: tr.result?.error, areasCount: tr.result?.areas?.length || 0 })));
                            }

                            // Continue conversation with tool results
                            const toolResultsMessage = this.formatToolResults(toolResults);
                            const followUpMessage = `User asked: "${message}"

You called tools and received these results:
${toolResultsMessage}

CRITICAL RESPONSE RULES:
- Use ONLY information from tool results above - never invent or make up details
- **CRITICAL: Do NOT repeat location (universe/world/room) if you already said it in this conversation - check "Recent conversation" first!**
- Only mention location if this is the FIRST time they ask "where are we" - otherwise just answer the question directly
- For "what areas" questions: Just list the areas (e.g., "There's a Social Area and Meeting Room here") - do NOT say the location again
- For "take me to X" questions: Just say "Follow me!" or "I'll take you there" - do NOT say the location
- For navigation: Just respond naturally (e.g., "Follow me!") - do NOT prefix with location
- Use actual names from results - never placeholders or made-up text
- Be conversational and natural - avoid repetitive responses`;

                            // Add /no_think for Qwen models in follow-up message
                            const followUpMessageWithNoThink = isQwenModel 
                                ? followUpMessage + '\n\n/no_think'
                                : followUpMessage;
                            followUpInput = followUpMessageWithNoThink;

                            if (overallFollowUpStartTime === 0) {
                                overallFollowUpStartTime = Date.now();
                            }
                            followUpStartTime = Date.now();

                            for await (const resultChunk of this.providerRegistry.generateStream(
                                providerId,
                                systemPrompt,
                                followUpMessageWithNoThink,
                                configWithParent,
                                tools.length > 0 ? tools : undefined
                            )) {
                                // Track tokens from follow-up call metadata
                                if (resultChunk.metadata?.tokensUsed) {
                                    tokensUsed += resultChunk.metadata.tokensUsed;
                                    followUpTokens += resultChunk.metadata.tokensUsed;
                                }
                                if (resultChunk.metadata?.promptTokens) {
                                    promptTokens += resultChunk.metadata.promptTokens;
                                    followUpPromptTokens += resultChunk.metadata.promptTokens;
                                }
                                if (resultChunk.metadata?.completionTokens) {
                                    completionTokens += resultChunk.metadata.completionTokens;
                                    followUpCompletionTokens += resultChunk.metadata.completionTokens;
                                }
                                if (resultChunk.metadata?.error) {
                                    followUpError = true;
                                }
                                // Accumulate content from follow-up response (same as main stream)
                                if (resultChunk.content) {
                                    accumulatedContent += resultChunk.content;
                                    followUpContent += resultChunk.content;
                                    // Buffer follow-up content instead of yielding per-chunk
                                    // Will be yielded as one chunk after all tool rounds complete
                                    followUpContentBuffer = appendStreamedChunk(followUpContentBuffer, resultChunk.content);
                                }
                                // Handle tool calls from follow-up response (multi-round tool calling)
                                if (resultChunk.toolCalls && resultChunk.toolCalls.length > 0) {
                                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                        console.log(`[AIService] Received tool calls from follow-up:`, resultChunk.toolCalls.map(tc => ({ name: tc.name, id: tc.id, argsLength: tc.arguments?.length || 0 })));
                                    }
                                    for (const toolCall of resultChunk.toolCalls) {
                                        if (toolCall.id) {
                                            const existing = toolCallAccumulator.get(toolCall.id);
                                            if (existing) {
                                                if (toolCall.arguments && toolCall.arguments !== '{}') {
                                                    existing.arguments += toolCall.arguments;
                                                }
                                                if (toolCall.name) {
                                                    existing.name = toolCall.name;
                                                }
                                            } else {
                                                const initArgs = (toolCall.arguments && toolCall.arguments !== '{}') ? toolCall.arguments : '';
                                                toolCallAccumulator.set(toolCall.id, {
                                                    id: toolCall.id,
                                                    name: toolCall.name || '',
                                                    arguments: initArgs,
                                                });
                                            }
                                        } else if (toolCall.arguments && toolCall.arguments !== '{}') {
                                            if (toolCallAccumulator.size > 0) {
                                                const entries = Array.from(toolCallAccumulator.entries());
                                                const lastEntry = entries[entries.length - 1];
                                                if (lastEntry) {
                                                    lastEntry[1].arguments += toolCall.arguments;
                                                }
                                            }
                                        }
                                    }
                                }
                                if (resultChunk.done) {
                                    streamCompleted = true;
                                    // Buffer done chunk instead of yielding it — callers break
                                    // on done:true which would terminate the generator and lose
                                    // subsequent tool-calling rounds in the while loop.
                                    lastFollowUpDoneChunk = resultChunk;
                                }
                                // Content chunks from follow-up streams are accumulated into
                                // followUpContentBuffer and yielded as one chunk after all
                                // tool-calling rounds complete (see below).
                                // Individual yields are intentionally skipped to prevent
                                // interleaved content from multiple tool-calling rounds
                                // from appearing as concatenated filler text.
                            }

                            // Convert any accumulated tool calls from the follow-up response for the next round
                            if (toolCallAccumulator.size > 0) {
                                pendingToolCalls = Array.from(toolCallAccumulator.values()).map(tc => ({
                                    id: tc.id,
                                    name: tc.name,
                                    arguments: tc.arguments || '{}',
                                }));
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[AIService] 🔄 Follow-up round ${followUpIterations} produced ${pendingToolCalls.length} new tool calls, repeating...`);
                                }
                                // Capture $ai_generation for this round's follow-up call (not the final one)
                                if (followUpContent || followUpError) {
                                    captureAiGeneration({
                                        distinctId: `bot-${botId}`,
                                        traceId: parentSpan?.spanContext().spanId || crypto.randomUUID(),
                                        sessionId: `conversation-${botId}-player-${playerId}`,
                                        model: config.model,
                                        provider: config.type,
                                        input: followUpMessageWithNoThink,
                                        output: followUpContent,
                                        inputTokens: followUpPromptTokens,
                                        outputTokens: followUpCompletionTokens,
                                        latency: (Date.now() - followUpStartTime) / 1000,
                                        cost: this.calculateCost(providerId, {
                                            tokensUsed: followUpTokens,
                                            promptTokens: followUpPromptTokens,
                                            completionTokens: followUpCompletionTokens,
                                            latency: Date.now() - followUpStartTime,
                                            error: followUpError,
                                        }),
                                        botId,
                                        playerId: String(playerId),
                                        space: spaceName,
                                    });
                                }
                                // Reset per-round tracking unconditionally for next follow-up iteration
                                // (must run even when round produces tool calls with zero text content)
                                followUpContent = '';
                                followUpTokens = 0;
                                followUpPromptTokens = 0;
                                followUpCompletionTokens = 0;
                                followUpError = false;
                                // Discard this round's content — tool calls were detected,
                                // so the text was filler/thinking that shouldn't accumulate.
                                followUpContentBuffer = '';
                                continue; // Back to while loop to execute new tool calls
                            }
                        }

                        // If we hit max iterations with still-pending tool calls, log and clear
                        if (toolCallAccumulator.size > 0) {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[AIService] ⚠️ Reached max follow-up iterations (${MAX_FOLLOW_UP_ITERATIONS}). Dropping ${toolCallAccumulator.size} pending tool calls.`);
                            }
                            toolCallAccumulator.clear();
                            pendingToolCalls = [];
                        }

                        // Stream the follow-up content word-by-word so the frontend
                        // shows tokens appearing incrementally instead of all at once.
                        // Split on word boundaries to create natural streaming chunks.
                        const responseContent = followUpContentBuffer || 'Sorry, I had trouble completing that request. Could you try again?';
                        followUpContentBuffer = '';
                        const streamWords = responseContent.match(/\S+\s*/g) || [responseContent];
                        for (let wi = 0; wi < streamWords.length; wi++) {
                            yield {content: streamWords[wi], done: false, metadata: undefined};
                        }
                        yield {content: '', done: true, metadata: lastFollowUpDoneChunk?.metadata};
                        lastFollowUpDoneChunk = null;

                        // Capture $ai_generation for the final tool follow-up LLM call
                        if (followUpContent || followUpError) {
                            captureAiGeneration({
                                distinctId: `bot-${botId}`,
                                traceId: parentSpan?.spanContext().spanId || crypto.randomUUID(),
                                sessionId: `conversation-${botId}-player-${playerId}`,
                                model: config.model,
                                provider: config.type,
                                input: followUpInput,
                                output: followUpContent,
                                inputTokens: followUpPromptTokens,
                                outputTokens: followUpCompletionTokens,
                                latency: (Date.now() - followUpStartTime) / 1000,
                                cost: this.calculateCost(providerId, {
                                    tokensUsed: followUpTokens,
                                    promptTokens: followUpPromptTokens,
                                    completionTokens: followUpCompletionTokens,
                                    latency: Date.now() - followUpStartTime,
                                    error: followUpError,
                                }),
                                botId,
                                playerId: String(playerId),
                                space: spaceName,
                            });
                            followUpGenCaptured = true;
                        }
                        continue;
                    }

                    // Accumulate content (only if no tool calls pending)
                    if (chunk.content && pendingToolCalls.length === 0) {
                        accumulatedContent += chunk.content;
                        firstCallContent += chunk.content;
                        // Buffer content for eventual yield — don't yield individual
                        // chunks yet because tool calls may arrive in later chunks,
                        // making this content filler/thinking text that should be discarded.
                        preToolBuffer = appendStreamedChunk(preToolBuffer, chunk.content);
                    }

// Track metadata from chunk
                    if (chunk.metadata?.tokensUsed) {
                        tokensUsed = chunk.metadata.tokensUsed;
                    }
                    if (chunk.metadata?.promptTokens) {
                        promptTokens = chunk.metadata.promptTokens;
                    }
                    if (chunk.metadata?.completionTokens) {
                        completionTokens = chunk.metadata.completionTokens;
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

                    // Don't yield individual content chunks — buffer them in preToolBuffer.
                    // If no tool calls arrive by the time done:true fires, the buffer
                    // is flushed as the final response. If tool calls do arrive, the
                    // buffer is discarded (it was the model's filler/thinking text).
                    // This prevents concatenated filler text from reaching the user.
                    if (pendingToolCalls.length === 0 && toolCallAccumulator.size === 0) {
                        if (chunk.content && !chunk.done) {
                            // Yield content chunk for real-time streaming (no tool calls in progress)
                            yield {content: chunk.content, done: false};
                        }
                        if (chunk.done) {
                            // No tool calls seen — finalize with metadata
                            yield {content: '', done: true, metadata: chunk.metadata};
                            preToolBuffer = '';
                        }
                    }
                }
                
                // $ai_generation for non-tool-call flow captured in finally block
                // (must be there because the for-await loop may throw after the last chunk)
                
            } finally {
                // Capture $ai_generation (per-call) in finally block — the for-await
                // loop may throw after the last chunk, so code after the loop never
                // executes, but the finally block always runs.
                //
                // All PostHog capture calls (captureAiGeneration, captureAiTrace) may
                // throw if the admin API is unreachable. The Sentry span cleanup must
                // run regardless — wrap them in a try-finally so parentSpan?.end() and
                // the scope restore always execute, preventing orphaned child spans.
                try {
                    // Non-tool-call path: capture $ai_generation for the first (only) LLM call
                    if (!initialGenCaptured && streamCompleted && firstCallContent && !hadToolCalls) {
                        captureAiGeneration({
                            distinctId: `bot-${botId}`,
                            traceId: parentSpan?.spanContext().spanId || crypto.randomUUID(),
                            sessionId: `conversation-${botId}-player-${playerId}`,
                            model: config.model,
                            provider: config.type,
                            input: userMessageForQwen,
                            output: firstCallContent,
                            inputTokens: followUpPromptTokens > 0 ? (promptTokens - followUpPromptTokens) : promptTokens,
                            outputTokens: followUpCompletionTokens > 0 ? (completionTokens - followUpCompletionTokens) : completionTokens,
                            latency: (Date.now() - firstCallStartTime) / 1000,
                            cost: this.calculateCost(providerId, {
                                tokensUsed,
                                promptTokens: followUpPromptTokens > 0 ? (promptTokens - followUpPromptTokens) : promptTokens,
                                completionTokens: followUpCompletionTokens > 0 ? (completionTokens - followUpCompletionTokens) : completionTokens,
                                latency: Date.now() - firstCallStartTime,
                                error,
                            }),
                            botId,
                            playerId: String(playerId),
                            space: spaceName,
                        });
                    }
                    
                    // Tool follow-up path: capture $ai_generation for the follow-up LLM call
                    if (!followUpGenCaptured && hadToolCalls && (followUpContent || followUpError)) {
                        captureAiGeneration({
                            distinctId: `bot-${botId}`,
                            traceId: parentSpan?.spanContext().spanId || crypto.randomUUID(),
                            sessionId: `conversation-${botId}-player-${playerId}`,
                            model: config.model,
                            provider: config.type,
                            input: followUpInput,
                            output: followUpContent,
                            inputTokens: followUpPromptTokens,
                            outputTokens: followUpCompletionTokens,
                            latency: (Date.now() - followUpStartTime) / 1000,
                            cost: this.calculateCost(providerId, {
                                tokensUsed: followUpTokens,
                                promptTokens: followUpPromptTokens,
                                completionTokens: followUpCompletionTokens,
                                latency: Date.now() - followUpStartTime,
                                error: followUpError,
                            }),
                            botId,
                            playerId: String(playerId),
                            space: spaceName,
                        });
                    }
                    
                    // Capture $ai_trace (turn-level)
                    if (streamCompleted && (accumulatedContent || error)) {
                        const generationLatency = (Date.now() - startTime) / 1000;
                        captureAiTrace({
                            distinctId: `bot-${botId}`,
                            traceId: parentSpan?.spanContext().spanId || crypto.randomUUID(),
                            sessionId: `conversation-${botId}-player-${playerId}`,
                            model: config.model,
                            provider: config.type,
                            input: message,
                            output: accumulatedContent || '',
                            inputTokens: promptTokens,
                            outputTokens: completionTokens,
                            latency: generationLatency,
                            cost: this.calculateCost(providerId, {
                                tokensUsed,
                                promptTokens,
                                completionTokens,
                                latency: Date.now() - startTime,
                                error,
                            }),
                            botId,
                            playerId: String(playerId),
                            space: spaceName,
                        });
                    }
                } finally {
                    // Always close Sentry span and restore scope, even if PostHog fails
                    parentSpan?.end();
                    sentrySetSpan?.(sentryScope, previousSpan);
                }

                // Always track usage, even if stream doesn't complete normally
                const latency = Date.now() - startTime;
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[AIService] Stream loop ended. streamCompleted=${streamCompleted}, tokensUsed=${tokensUsed}, latency=${latency}ms, error=${error}`);
                    console.log(`[AIService] Tracking usage: botId=${botId}, providerId=${providerId}`);
                }
                
                // Always track usage - fire and forget
                this.trackUsage(botId, providerId, {
                    tokensUsed,
                    promptTokens,
                    completionTokens,
                    latency,
                    error,
                }).catch(err => {
                    // Always log errors, even without debug mode
                    console.error('[AIService] Failed to track usage:', err);
                    if (err instanceof Error) {
                        console.error('[AIService] Error details:', err.message);
                    }
                });

                // Flush PostHog events — pg.flush() sends queued events without destroying the singleton
                flushPostHog().catch(err => {
                    console.error('[AIService] Failed to flush PostHog:', err);
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

            // Yield error chunk with any partial content accumulated before the failure
            // Strip any incomplete [EMOTION_UPDATE] block — the error may have
            // cut mid-tag, and parseEmotionsFromResponse would leave raw tag text.
            let safeContent = preToolBuffer || '';
            const emotionOpenIdx = safeContent.lastIndexOf('[EMOTION_UPDATE]');
            const emotionCloseIdx = safeContent.lastIndexOf('[/EMOTION_UPDATE]');
            if (emotionOpenIdx > emotionCloseIdx) {
                safeContent = safeContent.substring(0, emotionOpenIdx).trimEnd();
            }
            yield {
                content: safeContent,
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

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AIService] trackUsage called: botId=${botId}, providerId=${providerId}, tokensUsed=${metadata.tokensUsed}, cost=${cost}`);
            }

            // Track via Admin API
            await this.adminApiService.trackAIUsage({
                botId,
                providerId,
                tokensUsed: metadata.tokensUsed || 0,
                promptTokens: metadata.promptTokens || 0,
                completionTokens: metadata.completionTokens || 0,
                apiCalls: 1,
                durationSeconds: metadata.durationSeconds ?? null,
                cost,
                latency: metadata.latency,
                error: metadata.error || false,
                timestamp: new Date().toISOString(),
            });

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
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
     * Per-model pricing table (USD per 1K tokens)
     * Sourced from official provider pricing pages.
     * Cache-miss pricing used for DeepSeek (we can't detect cache hits from API response).
     */
    private static readonly MODEL_PRICING: Record<string, { in: number; out: number }> = {
        // DeepSeek (official: https://api-docs.deepseek.com/quick_start/pricing/)
        'deepseek-v4-flash':          { in: 0.00014,   out: 0.00028 },
        'deepseek-v4-pro':            { in: 0.000435,  out: 0.00087 },
        'deepseek-chat':              { in: 0.00014,   out: 0.00028 },   // deprecated, maps to v4-flash
        'deepseek-reasoner':          { in: 0.00014,   out: 0.00028 },   // deprecated, maps to v4-flash thinking
        'deepseek/deepseek-v4-flash': { in: 0.00014,   out: 0.00028 },   // OpenRouter prefix
        'deepseek/deepseek-v4-pro':   { in: 0.000435,  out: 0.00087 },
        'deepseek/deepseek-chat':     { in: 0.00014,   out: 0.00028 },
        // OpenAI
        'gpt-4o':            { in: 0.0025,   out: 0.01 },
        'gpt-4o-mini':       { in: 0.00015,  out: 0.0006 },
        'gpt-3.5-turbo':     { in: 0.0015,   out: 0.002 },
        // Anthropic
        'claude-sonnet-4':   { in: 0.003,    out: 0.015 },
        'claude-3.5-haiku':  { in: 0.0008,   out: 0.004 },
        'claude-3-haiku':    { in: 0.00025,  out: 0.00125 },
        'claude-3-sonnet':   { in: 0.003,    out: 0.015 },
        'claude-3-opus':     { in: 0.015,    out: 0.075 },
    };

    /**
     * Calculate cost based on provider and model pricing
     * Uses per-model rates when available, falls back to config/default flat rate.
     */
    private calculateCost(providerId: string, metadata: AIUsageMetadata): number {
        try {
            const cached = this.credentialCache.get(providerId);
            if (!cached) {
                return 0;
            }

            const config = cached.credentials;
            const promptTokens = metadata.promptTokens || 0;
            const completionTokens = metadata.completionTokens || 0;
            const durationSeconds = metadata.durationSeconds;

            // Voice AI: per-minute pricing (unchanged)
            if (config.type === 'ultravox' || config.type === 'gpt-voice') {
                if (!durationSeconds) return 0;
                const costPerMinute = config.settings?.costPerMinute || 0.05;
                const durationMinutes = Math.ceil(durationSeconds / 60);
                const minimumMinutes = config.settings?.minimumMinutes || 1;
                const actualMinutes = Math.max(minimumMinutes, durationMinutes);
                return actualMinutes * costPerMinute;
            }

            // LMStudio: always $0 (local models)
            if (config.type === 'lmstudio') {
                return 0;
            }

            // Try per-model pricing lookup
            const modelName = config.model || '';
            const pricing = AIService.MODEL_PRICING[modelName];

            if (pricing && (promptTokens > 0 || completionTokens > 0)) {
                return (promptTokens / 1000 * pricing.in) + (completionTokens / 1000 * pricing.out);
            }

            // Fallback: existing flat rate from config or default
            const tokensUsed = metadata.tokensUsed || 0;
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

    /**
     * Build tool definitions for function calling
     */
    private async buildTools(botId?: string, botClient?: BotClient, adminApiService?: AdminApiService): Promise<{ tools: any[]; toolServerMap: Map<string, { serverId: string; serverUrl: string; authType: string; authConfig?: string; headers?: Record<string, string> }> }> {
        const tools: any[] = [];
        const toolServerMap = new Map<string, { serverId: string; serverUrl: string; authType: string; authConfig?: string; headers?: Record<string, string> }>();

        if (botClient) {
            // Tool: Get people on the map
            tools.push({
                type: 'function',
                function: {
                    name: 'get_people_on_map',
                    description: 'Get a list of all people currently on the map with their positions. Excludes bots.',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
            });

            // Tool: Get bot's current position
            tools.push({
                type: 'function',
                function: {
                    name: 'get_bot_position',
                    description: 'Get the bot\'s current position on the map.',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
            });

            // Tool: Get areas on the map
            if (this.mapDataService) {
                tools.push({
                    type: 'function',
                    function: {
                        name: 'get_areas_on_map',
                        description: 'Get a list of all areas currently on the map. Call this tool silently (do NOT announce or ask permission) if "Current Location Context" shows "Areas: none" but you need to check for areas, or if asked about areas and the context is unclear. Just call the tool and use the results.',
                        parameters: {
                            type: 'object',
                            properties: {},
                            required: [],
                        },
                    },
                });
            }

            // Tool: Navigate to a person or area and lead someone there
            tools.push({
                type: 'function',
                function: {
                    name: 'navigate_to',
                    description: 'CRITICAL: You MUST call this tool when someone asks you to take them somewhere. Do NOT just say "Follow me!" without calling this tool first. This tool navigates to a person or area and makes people follow you. Use this when someone asks you to "take me to X", "show me where Y is", "lead me to Z", "can you take me to [place]", "take me there", or similar navigation requests. You MUST call this tool BEFORE generating any response text. If they say "take me there" or "lead me there", look at the recent conversation to see what area or person they\'re referring to (e.g., if you just mentioned "Office Area", "there" refers to "Office Area").',
                    parameters: {
                        type: 'object',
                        properties: {
                            targetType: {
                                type: 'string',
                                enum: ['person', 'area'],
                                description: 'Whether navigating to a person or an area'
                            },
                            targetName: {
                                type: 'string',
                                description: 'Name of the person or area to navigate to. For people, use their name as it appears in get_people_on_map. For areas, use the area name from the location context. If they say "there" or "that place", look at recent conversation to find the area/person name they\'re referring to.'
                            }
                        },
                        required: ['targetType', 'targetName']
                    },
                },
            });
        }

        // Add MCP tools
        if (botId && adminApiService) {
            try {
                const mcpResult = await MCPConnector.discoverToolsWithMapping(
                    botId,
                    this.adminApiUrl,
                    adminApiService['adminApiToken'],
                    process.env.BOT_SERVICE_TOKEN || ''
                );
                const mcpTools = mcpResult.tools;

                // Transfer tool→server mapping to the outer-scope map
                for (const [key, value] of mcpResult.toolServerMap) {
                    toolServerMap.set(key, value);
                }

                // Build a set of existing tool names for deduplication
                const existingToolNames = new Set(tools.map(t => t.function.name));

                for (const mcpTool of mcpTools) {
                    if (!existingToolNames.has(mcpTool.function.name)) {
                        tools.push(mcpTool);
                        existingToolNames.add(mcpTool.function.name);
                    }
                }

                if (mcpTools.length > 0) {
                    console.log(`[AIService] Added ${mcpTools.length} MCP tools for bot ${botId}`);
                }
            } catch (e) {
                console.warn('[AIService] Failed to discover MCP tools:', e);
                Sentry.captureException(e instanceof Error ? e : new Error(String(e)));
            }
        }

        return { tools, toolServerMap };
    }

    /**
     * Execute tool calls requested by AI
     * Executes all tool calls in parallel for better performance
     */
    private async executeToolCalls(
        toolCalls: ToolCall[],
        botClient?: BotClient,
        adminApiService?: AdminApiService,
        toolServerMap?: Map<string, { serverId: string; serverUrl: string; authType: string; authConfig?: string; headers?: Record<string, string> }>,
        playerUuid?: string
    ): Promise<Array<{ id: string; name: string; result: any }>> {
        // Filter out invalid tool calls (empty name, undefined, etc.)
        const validToolCalls = toolCalls.filter(tc => tc && tc.name && tc.name.trim() !== '');
        
        if (validToolCalls.length !== toolCalls.length) {
            const invalidCalls = toolCalls.filter(tc => !tc || !tc.name || tc.name.trim() === '');
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[AIService] Filtered out ${invalidCalls.length} invalid tool calls:`, invalidCalls);
            }
        }
        
        // Execute all tool calls in parallel for better performance
        const toolPromises = validToolCalls.map(async (toolCall) => {
            try {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[AIService] 🔧 Executing tool: ${toolCall.name}, id: ${toolCall.id}, botClient: ${botClient ? 'available' : 'missing'}`);
                }
                let result: any;

                switch (toolCall.name) {
                    case 'get_people_on_map':
                        if (botClient) {
                            const people = botClient.getAllPeople();
                            result = people
                                .filter(p => !BotClient.isBot(p.userId))
                                .map(p => ({
                                    userId: p.userId,
                                    name: p.name || `User ${p.userId}`,
                                    position: { x: p.position.x, y: p.position.y },
                                }));
                        } else {
                            result = { error: 'Bot client not available' };
                        }
                        break;

                    case 'get_bot_position':
                        if (botClient) {
                            const pos = botClient.getState().getPosition();
                            result = { x: pos.x, y: pos.y };
                        } else {
                            result = { error: 'Bot client not available' };
                        }
                        break;

                    case 'get_areas_on_map':
                        if (!this.mapDataService || !botClient) {
                            result = { error: 'Map data service or bot client not available' };
                            break;
                        }
                        try {
                            const roomUrl = botClient.getRoomUrl();
                            const areas = await this.mapDataService.getAreas(roomUrl);
                            result = {
                                areas: areas.map(a => ({
                                    name: a.name,
                                    x: a.x,
                                    y: a.y,
                                })),
                            };
                        } catch (error) {
                            result = { error: `Failed to get areas: ${error instanceof Error ? error.message : 'Unknown error'}` };
                        }
                        break;

                    case 'navigate_to':
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] 🔧 Executing navigate_to tool with raw arguments:`, toolCall.arguments);
                            console.log(`[AIService] 📍 Bot client available: ${botClient ? 'YES' : 'NO'}`);
                        }
                        if (!botClient) {
                            console.error('[AIService] ❌ Bot client not available for navigate_to');
                            result = { error: 'Bot client not available' };
                            break;
                        }
                        
                        try {
                            // Parse JSON arguments string
                            let parsedArgs: any = {};
                            try {
                                parsedArgs = typeof toolCall.arguments === 'string' 
                                    ? JSON.parse(toolCall.arguments) 
                                    : toolCall.arguments || {};
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[AIService] 📋 Parsed navigate_to arguments:`, parsedArgs);
                                }
                            } catch (parseError) {
                                console.error('[AIService] ❌ Failed to parse tool arguments:', parseError);
                                result = { error: 'Invalid tool arguments format' };
                                break;
                            }
                            
                            const targetType = parsedArgs.targetType;
                            const targetName = parsedArgs.targetName;
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[AIService] 📍 Resolving target: type=${targetType}, name=${targetName}`);
                            }
                            
                            if (!targetType || !targetName) {
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.error(`[AIService] ❌ Missing parameters: targetType=${targetType}, targetName=${targetName}`);
                                }
                                result = { error: 'Missing required parameters: targetType and targetName' };
                                break;
                            }
                            
                            let targetPosition: { x: number; y: number } | null = null;
                            
                            if (targetType === 'person') {
                                // Find person by name
                                const people = botClient.getAllPeople();
                                const targetPerson = people.find(p => 
                                    !BotClient.isBot(p.userId) && 
                                    p.name && 
                                    p.name.toLowerCase().includes(targetName.toLowerCase())
                                );
                                
                                if (!targetPerson) {
                                    result = { error: `Could not find person named "${targetName}"` };
                                    break;
                                }
                                
                                targetPosition = {
                                    x: targetPerson.position.x,
                                    y: targetPerson.position.y,
                                };
                            } else if (targetType === 'area') {
                                // Find area by name
                                if (!this.mapDataService) {
                                    result = { error: 'Map data service not available' };
                                    break;
                                }
                                
                                const roomUrl = botClient.getRoomUrl();
                                const areas = await this.mapDataService.getAreas(roomUrl);
                                const targetArea = areas.find(a => 
                                    a.name && 
                                    a.name.toLowerCase().includes(targetName.toLowerCase())
                                );
                                
                                if (!targetArea) {
                                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                        console.error(`[AIService] ❌ Could not find area named "${targetName}". Available areas:`, areas.map(a => a.name));
                                    }
                                    result = { error: `Could not find area named "${targetName}"` };
                                    break;
                                }
                                
                                // Use center of area
                                // Note: Area coordinates are (x, y) for top-left corner, so center is (x + width/2, y + height/2)
                                targetPosition = {
                                    x: targetArea.x + targetArea.width / 2,
                                    y: targetArea.y + targetArea.height / 2,
                                };
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[AIService] ✅ Found area "${targetName}": bounds (${targetArea.x}, ${targetArea.y}) size ${targetArea.width}x${targetArea.height}, center at (${targetPosition.x}, ${targetPosition.y})`);
                                }
                            } else {
                                result = { error: `Invalid targetType: ${targetType}. Must be 'person' or 'area'` };
                                break;
                            }
                            
                            if (!targetPosition) {
                                result = { error: 'Could not resolve target position' };
                                break;
                            }
                            
                            // Get person UUID from engaged users (use first person in conversation)
                            // Since follow request goes to everyone in the space, we can use a placeholder
                            // The actual follow request will be sent to the group
                            const personUuid = 'group'; // Placeholder - follow goes to group anyway
                            
                            // Call leadPersonToTarget
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[AIService] 🚀 Calling leadPersonToTarget: type=${targetType}, name=${targetName}, position=(${targetPosition.x}, ${targetPosition.y})`);
                            }
                            try {
                                await botClient.leadPersonToTarget(personUuid, {
                                    type: targetType,
                                    name: targetName,
                                    position: targetPosition,
                                });
                                
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[AIService] ✅ leadPersonToTarget completed successfully`);
                                }
                                result = { 
                                    success: true, 
                                    message: `Started navigating to ${targetName}` 
                                };
                            } catch (leadError: any) {
                                // If leadPersonToTarget throws, it means navigation failed
                                console.error('[AIService] ❌ leadPersonToTarget failed:', leadError);
                                result = { 
                                    error: leadError.message || 'Failed to start navigation. The bot may be too close to the target or pathfinding is unavailable.' 
                                };
                            }
                        } catch (error: any) {
                            console.error('[AIService] Error executing navigate_to tool:', error);
                            result = { error: error.message || 'Failed to navigate' };
                        }
                        break;


                    default: {
                        // Check if this is an MCP tool (not a hardcoded one)
                        const mcpServerConfig = toolServerMap?.get(toolCall.name);
                        if (mcpServerConfig) {
                            try {
                                const parsedArgs = typeof toolCall.arguments === 'string'
                                    ? JSON.parse(toolCall.arguments)
                                    : toolCall.arguments || {};
                                result = await MCPConnector.executeToolCall(
                                    mcpServerConfig.serverId,
                                    mcpServerConfig.serverUrl,
                                    toolCall.name,
                                    parsedArgs,
                                    mcpServerConfig.authType,
                                    mcpServerConfig.authConfig,
                                    mcpServerConfig.headers,
                                    playerUuid
                                );
                            } catch (mcpError: any) {
                                console.error(`[AIService] Error executing MCP tool ${toolCall.name}:`, mcpError);
                                Sentry.captureException(mcpError instanceof Error ? mcpError : new Error(String(mcpError)));
                                result = { error: `MCP tool error: ${mcpError.message || 'Unknown error'}` };
                            }
                        } else {
                            // Log unknown tool for debugging
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[AIService] Unknown tool called: ${toolCall.name || '(empty)'}`, toolCall);
                            }
                            result = { error: `Unknown tool: ${toolCall.name || '(empty name)'}` };
                        }
                    }
                }

                return { id: toolCall.id, name: toolCall.name, result };
            } catch (error: any) {
                return {
                    id: toolCall.id,
                    name: toolCall.name,
                    result: { error: error.message || 'Tool execution failed' },
                };
            }
        });

        // Wait for all tool calls to complete in parallel
        return Promise.all(toolPromises);
    }

    /**
     * Format tool results for AI
     */
    private formatToolResults(results: Array<{ id: string; name: string; result: any }>): string {
        return results.map(r => {
            // Format results in a more readable way for the AI
            if (r.name === 'get_people_on_map' && Array.isArray(r.result)) {
                if (r.result.length === 0) {
                    return `get_people_on_map: There are no other people on the map currently.`;
                }
                const peopleList = r.result.map((p: any) => p.name).join(', ');
                return `get_people_on_map: People on the map: ${peopleList}. List them naturally (e.g., "Khalid ABC is here" or "Khalid ABC and John are here"). Do NOT repeat the location. Do NOT mention areas. Just list the people.`;
            }
            if (r.name === 'get_bot_position' && r.result && !r.result.error) {
                return `get_bot_position: Your current position is x: ${r.result.x}, y: ${r.result.y}`;
            }
            if (r.name === 'get_areas_on_map' && r.result && !r.result.error) {
                if (r.result.areas && Array.isArray(r.result.areas)) {
                    if (r.result.areas.length === 0) {
                        return `get_areas_on_map: There are no areas defined on this map.`;
                    }
                    const areasList = r.result.areas.map((a: any) => a.name).join(', ');
                    return `get_areas_on_map: Areas found on this map: ${areasList}. List these areas naturally when asked about areas.`;
                }
            }
            if (r.name === 'navigate_to' && r.result) {
                if (r.result.error) {
                    return `navigate_to: Error - ${r.result.error}. Explain the issue simply (e.g., "I couldn't find a path there" or "I'm too close to that location"). Do NOT suggest alternatives, do NOT ask questions like "Would you like me to try another location?", just state the error simply.`;
                }
                if (r.result.success) {
                    return `navigate_to: Successfully started navigating. You are now leading people to the destination. The bot has started moving. If the user asks "why aren't you taking me" or "why aren't you moving", reassure them that you are leading them and they should follow. Do NOT say you can't take them - you already started leading. Respond naturally like "I'm leading you there now, just follow me!" or "Come on, follow me!" - don't mention tools or technical details.`;
                }
            }
            // Fallback to JSON for other results or errors
            return `${r.name}: ${JSON.stringify(r.result)}`;
        }).join('\n');
    }
}

