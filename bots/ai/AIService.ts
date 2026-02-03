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

        try {
            // Get provider credentials
            const config = await this.getProviderCredentials(providerId);

            // Fetch map context (location + areas) upfront so bot always knows where it is
            let mapContextInfo = '';
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
            if (chatInstructions && chatInstructions.trim()) {
                systemPrompt = chatInstructions;
                // Add note that personality rules from chat instructions take precedence
                systemPrompt += `\n\n**CRITICAL: The instructions above define your personality and behavior. Follow them strictly. Your personality should be reflected in ALL responses. The technical rules below are guidelines for HOW to respond (formatting, tool usage, etc.), but your personality (defined above) takes precedence over any conflicting rules below. If you're instructed to be mean/angry, be mean/angry. If you're instructed to be friendly, be friendly. Your personality comes first.**`;
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
- When they ask "remember what I said?" or "what did I tell you?", recall specific details naturally (e.g., "You mentioned you're hungry" or "You said you were feeling sad about work")
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
- Don't repeat information you already gave in this conversation - check "Recent conversation" first
- If you already said the location, don't repeat it when answering follow-up questions
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
- When they ask "remember what I said?" or "what did I tell you?", recall specific details naturally
- Don't just say "I remember" - show you remember by stating WHAT you remember
- If you know they're hungry/sad/tired/etc., reference it naturally when relevant
- Reference past conversations naturally when it makes sense - "Like we discussed..." or "Remember when..."

ANTI-REPETITION (Vary naturally):
- NEVER repeat the exact same response - check "Recent conversation" first
- If you already answered a question, don't repeat that answer
- Vary your wording, tone, and approach - be creative and natural
- If you said the location, don't repeat it when answering follow-up questions

TOOLS & ACTIONS (Be seamless):
- When you need to check something (like "who's here"), call the tool silently FIRST, then respond with results naturally
- Don't say "I'll check" or "Let me look" - just check and respond naturally
- Never mention tools or technical details - just give the answer like a human would

**ACCURACY & TRUTHFULNESS (Be honest, like a real person):**
- Only mention things you actually know - use location names exactly as shown in "Current Location Context"
- Never invent details - if you don't know something, don't make it up
- Never mention areas that aren't actually in the current location context
- Don't describe physical features you can't see - you only know room/area names
- If you're not sure about something, be honest about it (within your personality)

**LOCATION & SPACE QUESTIONS (Answer naturally, like a person would):**
- "where are we"/"what room"/"what universe" → Give location naturally: "[universe], [world], [room]" (use actual names from context). If areas exist, mention them naturally after (e.g., "BAWES Universe, StudentHub World, test room. There's an Office Area here"). Never mention coordinates unless specifically asked.
- "what's here"/"what is this place" → Give location naturally, then mention areas if any. Be conversational.
- "what areas"/"areas?"/"what other areas" → Check "Recent conversation" first - if you already said the location, don't repeat it. Just list areas naturally (e.g., "There's an Office Area here" or "Office Area and Creative Hub"). If unsure, call get_areas_on_map tool silently, then respond naturally.
- "where is [area]" → Give coordinates only when specifically asked. Format naturally.
- "who's here"/"who's online" → Call get_people_on_map tool silently first, then list people naturally (e.g., "Khalid ABC is here" or "Khalid ABC and John are here"). Don't repeat location.
- "where are you" → Use get_bot_position tool, format as natural location.
- "what can we do here"/"what can we do"/"whats the plan" → Check "Recent conversation" - if you already said location, don't repeat it. Suggest activities naturally based on available areas. Be conversational.

**NAVIGATION (Be helpful naturally):**
- "take me to [person/area]" → Call navigate_to tool FIRST, then respond naturally like "Follow me!" or "I'll take you there"
- Only offer to lead when explicitly asked - don't say "Follow me!" when just describing what's available
- If already leading and they ask why not moving, reassure them naturally

**FOLLOW-UP QUESTIONS (Be natural, not repetitive):**
- "whats that"/"where" → Check "Recent conversation" to understand what they're referring to - answer directly
- Don't repeat information you already gave - if you just said the location and they ask "what areas", just list areas without repeating location
- Don't explain why you said something - just answer the current question naturally
- Be conversational - avoid repetitive phrases, vary your responses
- Format location naturally as "[universe], [world], [room]" - use actual names from context`;

            // Check if Qwen model (for /no_think directive)
            const isQwenModel = config.model.toLowerCase().includes('qwen');

            // Define tools for function calling
            const tools = this.buildTools(botClient, adminApiService || this.adminApiService);

            // Generate stream with tools
            let tokensUsed = 0;
            let error = false;
            let streamCompleted = false;
            let accumulatedContent = '';
            let pendingToolCalls: ToolCall[] = [];
            // Map to accumulate tool call arguments by ID (for streaming tool calls where arguments come in chunks)
            const toolCallAccumulator: Map<string, { id: string; name: string; arguments: string }> = new Map();

            // For Qwen models, add /no_think to user message instead of system prompt
            const userMessageForQwen = isQwenModel 
                ? message + '\n\n/no_think'
                : message;

            try {
                for await (const chunk of this.providerRegistry.generateStream(
                    providerId,
                    systemPrompt,
                    userMessageForQwen,
                    config,
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
                        // Convert accumulated tool calls to array (arguments should now be complete)
                        pendingToolCalls = Array.from(toolCallAccumulator.values()).map(tc => ({
                            id: tc.id,
                            name: tc.name,
                            // If arguments are empty after accumulation, default to '{}' for JSON parsing
                            arguments: tc.arguments || '{}'
                        }));
                        
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] 🔧 About to execute ${pendingToolCalls.length} tool calls:`, pendingToolCalls.map(tc => ({ 
                                name: tc.name, 
                                id: tc.id, 
                                argsPreview: tc.arguments.substring(0, 100),
                                argsLength: tc.arguments.length
                            })));
                        }
                        // Execute tool calls and continue conversation
                        const toolResults = await this.executeToolCalls(pendingToolCalls, botClient, adminApiService || this.adminApiService);
                        pendingToolCalls = [];
                        toolCallAccumulator.clear();

                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] ✅ Tool execution completed. Results:`, toolResults.map(tr => ({ name: tr.name, hasResult: !!tr.result, success: tr.result?.success, error: tr.result?.error, areasCount: tr.result?.areas?.length || 0 })));
                        }

                        // Continue conversation with tool results
                        const toolResultsMessage = this.formatToolResults(toolResults);
                        // Include explicit instruction to use tool results - be very direct
                        // Format as a clear instruction to the AI
                        const followUpMessage = `User asked: "${message}"

You called tools and received these results:
${toolResultsMessage}

CRITICAL ANTI-HALLUCINATION RULES:
- Use ONLY information from tool results above - never invent or make up details
- If results show universe="[universe]", world="[world]", room="[room]" → say "[universe] Universe, [world] World, [room] room" (use actual values from results - if world is "StudentHub", say "StudentHub World", not "[universe] World")
- You only know room/area names, not appearance - never describe physical features
- If areas listed, mention them. If none, say "There are no areas defined here"
- Use actual names/values from results - never placeholders or made-up text
- NEVER show tool JSON, placeholders, or internal markers in responses
- Be conversational but ONLY use real information from tools`;
                        
                        // Add /no_think for Qwen models in follow-up message
                        const followUpMessageWithNoThink = isQwenModel 
                            ? followUpMessage + '\n\n/no_think'
                            : followUpMessage;

                        for await (const resultChunk of this.providerRegistry.generateStream(
                            providerId,
                            systemPrompt,
                            followUpMessageWithNoThink,
                            config,
                            tools.length > 0 ? tools : undefined
                        )) {
                            yield resultChunk;
                        }
                        continue;
                    }

                    // Accumulate content (only if no tool calls pending)
                    if (chunk.content && pendingToolCalls.length === 0) {
                        accumulatedContent += chunk.content;
                    }

                    // Track metadata from chunk
                    if (chunk.metadata?.tokensUsed) {
                        tokensUsed = chunk.metadata.tokensUsed;
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Received chunk with tokensUsed: ${tokensUsed}`);
                        }
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

                    // Only yield chunk if no tool calls are pending
                    // (If tool calls are coming, wait for them to complete first)
                    if (pendingToolCalls.length === 0) {
                        yield chunk;
                    } else if (process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[AIService] Skipping chunk yield - waiting for tool calls to complete`);
                    }
                }
            } finally {
                // Always track usage, even if stream doesn't complete normally
                const latency = Date.now() - startTime;
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[AIService] Stream loop ended. streamCompleted=${streamCompleted}, tokensUsed=${tokensUsed}, latency=${latency}ms, error=${error}`);
                    console.log(`[AIService] Tracking usage: botId=${botId}, providerId=${providerId}`);
                }
                
                // Always track usage - fire and forget
                this.trackUsage(botId, providerId, {
                    tokensUsed,
                    latency,
                    error,
                }).catch(err => {
                    // Always log errors, even without debug mode
                    console.error('[AIService] Failed to track usage:', err);
                    if (err instanceof Error) {
                        console.error('[AIService] Error details:', err.message);
                    }
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

            // Yield error chunk
            yield {
                content: '',
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
     * Calculate cost based on provider pricing model
     */
    private calculateCost(providerId: string, metadata: AIUsageMetadata): number {
        try {
            const cached = this.credentialCache.get(providerId);
            if (!cached) {
                return 0; // Can't calculate without config
            }

            const config = cached.credentials;
            const tokensUsed = metadata.tokensUsed || 0;
            const durationSeconds = metadata.durationSeconds;

            // Voice AI: per-minute pricing
            if (config.type === 'ultravox' || config.type === 'gpt-voice') {
                if (!durationSeconds) {
                    return 0;
                }
                const costPerMinute = config.settings?.costPerMinute || 0.05;
                const durationMinutes = Math.ceil(durationSeconds / 60);
                const minimumMinutes = config.settings?.minimumMinutes || 1;
                const actualMinutes = Math.max(minimumMinutes, durationMinutes);
                return actualMinutes * costPerMinute;
            }

            // LMStudio: per-token pricing (default)
            if (config.type === 'lmstudio') {
                const costPerToken = config.settings?.costPerToken || 0.00001;
                return tokensUsed * costPerToken;
            }

            // OpenAI/Anthropic: per-token with optional markup
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
    private buildTools(botClient?: BotClient, adminApiService?: AdminApiService): any[] {
        const tools: any[] = [];

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

        return tools;
    }

    /**
     * Execute tool calls requested by AI
     * Executes all tool calls in parallel for better performance
     */
    private async executeToolCalls(
        toolCalls: ToolCall[],
        botClient?: BotClient,
        adminApiService?: AdminApiService
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


                    default:
                        // Log unknown tool for debugging
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.warn(`[AIService] Unknown tool called: ${toolCall.name || '(empty)'}`, toolCall);
                        }
                        result = { error: `Unknown tool: ${toolCall.name || '(empty name)'}` };
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

