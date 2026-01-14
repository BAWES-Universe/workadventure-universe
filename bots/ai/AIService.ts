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
                    const metadata = await adminApiService.getRoomMetadata(roomUrl);
                    
                    let areas: any[] = [];
                    if (this.mapDataService) {
                        areas = await this.mapDataService.getAreas(roomUrl);
                        console.log(`[AIService] Upfront context fetch - Found ${areas.length} areas for ${roomUrl}:`, areas.map(a => a.name));
                    } else {
                        console.log(`[AIService] Upfront context fetch - mapDataService not available`);
                    }
                    
                    if (metadata) {
                        mapContextInfo = `\n\nCurrent Location Context (you are always here - ALWAYS mention this when asked about location):
- Universe: ${metadata.universeName}
- World: ${metadata.worldName}
- Room: ${metadata.roomName}`;
                        
                        if (areas && areas.length > 0) {
                            const areaNames = areas.filter(a => a && a.name).map(a => a.name);
                            if (areaNames.length > 0) {
                                mapContextInfo += `\n- Areas in this room (additional context, not a replacement for location): ${areaNames.join(', ')}`;
                                // Make positions more explicit and readable
                                const areaDetails = areas.filter(a => a && a.name).map(a => `${a.name} is at coordinates (${a.x}, ${a.y})`).join('; ');
                                mapContextInfo += `\n- Area locations (use these when asked "where is [area name]"): ${areaDetails}`;
                                console.log(`[AIService] Upfront context - Including ${areaNames.length} areas: ${areaNames.join(', ')}`);
                            } else {
                                mapContextInfo += `\n- Areas: none`;
                                console.log(`[AIService] Upfront context - No valid area names found (${areas.length} areas but no names)`);
                            }
                        } else {
                            mapContextInfo += `\n- Areas: none`;
                            console.log(`[AIService] Upfront context - No areas found`);
                        }
                    } else {
                        // Fallback to URL parsing
                        const urlMatch = roomUrl.match(/\/@\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
                        if (urlMatch) {
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
                } catch (error) {
                    console.warn(`[AIService] Failed to fetch map context upfront:`, error);
                }
            }

            // Build system prompt
            let systemPrompt = chatInstructions || 'You are a friendly bot.';
            if (mapContextInfo) {
                systemPrompt += mapContextInfo;
            }
            if (conversationContext) {
                systemPrompt += `\n\nConversation Context:\n${conversationContext}`;
            }
            
            // Add guidance for natural responses and tool usage
            systemPrompt += `\n\nWhen someone approaches you, greet them based on your personality (defined in your chat instructions) and your relationship with them (from conversation memory). Your greeting should reflect:
- Your personality traits (friendly, formal, playful, serious, etc. - as defined in your chat instructions)
- Your emotional state toward this person (if you've met before and have a relationship)
- The context of your location and situation
Don't ask questions like "where are we" in your greeting - just greet them naturally based on who you are and your relationship with them. If you haven't met before, use your default personality. If you have a history, let that inform your greeting.

IMPORTANT: When you receive the message "Someone just approached you.", respond with ONLY a greeting - don't acknowledge the instruction, don't say you're ready, just greet them directly as if they just walked up to you.

CRITICAL ANTI-HALLUCINATION RULES:
1. You already know your location and areas from the "Current Location Context" above - use that information directly. You don't need to call get_map_context for location/area questions unless the context is missing.
2. NEVER invent, make up, or hallucinate details about places. Examples of hallucinations to avoid: "spacious open room", "large window", "field and trees", "ornate bronze door", "Starlight Hotel", "holographic dragon", "grand staircase".
3. Use ONLY the actual location names from the "Current Location Context" above. NEVER use brackets or placeholders like [test universe] or [test room]. Use the actual names directly: "test universe, test world, test room". Do NOT put brackets around names.
4. NEVER describe physical features of the room unless they are explicitly in the tool results. You don't know what the room looks like - only its name.
5. NEVER ask the user to call tools - YOU call them yourself when needed.
6. NEVER mention or describe calling tools in your responses - just call them silently and use the results.
7. NEVER show tool call JSON, "[END_TOOL_REQUEST]", "[Area Name 1]", "[END_MAP_CONTEXT]", or ANY placeholder text in your response - these are NOT real data.
8. NEVER use brackets around names like [test universe] or [test room]. Use the actual names directly: "test universe, test world, test room". Brackets are NOT part of the names.
9. NEVER use placeholder text like "[Area Name]", "[Area Name 1]", "[END_MAP_CONTEXT]" - if areas exist, use their actual names from the context. If no areas exist, say "There are no areas defined here".
10. Answer questions directly - don't ask the user questions back. If they say "cool" or "nice", just acknowledge it briefly, don't ask them anything.
11. ALWAYS use the EXACT values from "Current Location Context" - copy them directly, never use placeholders, brackets, or make things up. If it says "Universe: test", use "test universe", NOT "[test universe]".

When someone asks about:
- WHERE you are: "where are we", "what room", "what world", "what universe", "where inside" → ALWAYS mention universe, world, and room from "Current Location Context". Areas are additional info, not a replacement.
- WHAT is this place: "what is this place", "what is this", "what's here" → ALWAYS mention universe, world, and room first, then mention areas if they exist. Format: "[universe name] universe, [world name] world, [room name] room" + areas if any. Use the actual names from context, NOT placeholders with brackets.
- WHAT the place is LIKE: "what is this place like", "describe this place" → Describe based on the room name from context, but do NOT invent fictional details
- WHAT TO DO here: "what do we do here", "what can we do" → Suggest activities based on room/area names from context
- Areas/sections: "what areas", "what areas are here", "any areas", "what's this area" → Use the areas from "Current Location Context" above. If areas are listed, mention them. If "Areas: none", say "There are no areas defined here."
- Area location: "where is [area name]", "where is the office area" → Use the "Area positions" from "Current Location Context" above. Give the coordinates like "Office Area is at (596, 606)" or similar.
- Who's on the map: "who's here", "who's online" → Call get_people_on_map tool and list actual people
- Your position: "where are you" → Use get_bot_position tool

CRITICAL: 
- When asked "what's here" or "where are we" (first time in conversation), mention universe, world, and room. Areas are additional context.
- Format: Use actual names like "test universe, test world, test room" + (if areas exist: ", and there's an area called Office Area")
- Never use brackets around names like [test universe] - use the actual names directly
- BUT: If you already told them the location in this conversation, don't repeat it. Just answer the new question directly.
- When asked "where is [area name]", just give the coordinates without repeating the full location you already mentioned
- If asked "what areas" specifically, focus on areas. Don't repeat location if you already said it.

Remember: 
- YOU call the tools silently - never mention them in your response. Just call them and use the results to answer.
- Be conversational and natural - don't repeat information you just said
- If you just told them the location, don't repeat it again in the next response unless they specifically ask
- Answer questions directly and contextually:
  * "where are we" → Give location once
  * "what's here" → Give location and areas (if first time mentioning location)
  * "what's in the office" or "where is [area]" → Just answer the question directly, don't repeat the full location you already mentioned
  * "where is [area]" → Just give the coordinates, don't repeat the full location
- Don't append or repeat information - if you already said where you are, just answer the new question
- Be natural - like a real conversation where you don't repeat yourself
- Different questions need different responses - don't parrot the same answer`;

            // Define tools for function calling
            const tools = this.buildTools(botClient, adminApiService || this.adminApiService);

            // Generate stream with tools
            let tokensUsed = 0;
            let error = false;
            let streamCompleted = false;
            let accumulatedContent = '';
            let pendingToolCalls: ToolCall[] = [];

            try {
                for await (const chunk of this.providerRegistry.generateStream(
                    providerId,
                    systemPrompt,
                    message,
                    config,
                    tools.length > 0 ? tools : undefined
                )) {
                    // Collect tool calls first (before yielding content)
                    if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                        console.log(`[AIService] Received tool calls:`, chunk.toolCalls.map(tc => ({ name: tc.name, id: tc.id })));
                        pendingToolCalls.push(...chunk.toolCalls);
                    }

                    // If we have tool calls and chunk is done, execute them BEFORE yielding any content
                    if (chunk.done && pendingToolCalls.length > 0) {
                        console.log(`[AIService] Executing ${pendingToolCalls.length} tool calls:`, pendingToolCalls.map(tc => tc.name));
                        // Execute tool calls and continue conversation
                        const toolResults = await this.executeToolCalls(pendingToolCalls, botClient, adminApiService || this.adminApiService);
                        pendingToolCalls = [];

                        console.log(`[AIService] Tool results:`, toolResults.map(tr => ({ name: tr.name, hasResult: !!tr.result, areasCount: tr.result?.areas?.length || 0 })));

                        // Continue conversation with tool results
                        const toolResultsMessage = this.formatToolResults(toolResults);
                        // Include explicit instruction to use tool results - be very direct
                        // Format as a clear instruction to the AI
                        const followUpMessage = `User asked: "${message}"

You called tools and received these results:
${toolResultsMessage}

CRITICAL ANTI-HALLUCINATION RULES:
- Use ONLY the information from the tool results above. Do NOT invent, make up, or hallucinate ANY details.
- If tool results show universe="test", world="test", room="test" - then say "test universe, test world, test room". Do NOT add fictional descriptions like "spacious open room" or "large window".
- You do NOT know what the room looks like - only its name. Do NOT describe physical features unless they are in the tool results.
- **IF AREAS ARE LISTED IN THE TOOL RESULTS, YOU MUST MENTION THEM WHEN ASKED ABOUT AREAS OR "WHAT'S HERE"**
- **IF NO AREAS ARE LISTED, SAY "There are no areas defined here" when asked about areas**
- Use the actual names/values from the results - never use placeholders or make things up
- NEVER show tool calls, JSON, "[END_TOOL_REQUEST]", "[Area Name 1]", "[END_MAP_CONTEXT]", or ANY placeholder text in your response
- NEVER use placeholder text - if areas exist, use their actual names. If no areas exist, say "There are no areas defined here"
- When talking about location, mention universe, world, and room using the ACTUAL names from the tool results
- Be conversational, but ONLY use real information from the tools - no fictional details, no made-up descriptions, no placeholders`;
                        
                        for await (const resultChunk of this.providerRegistry.generateStream(
                            providerId,
                            systemPrompt,
                            followUpMessage,
                            config,
                            tools.length > 0 ? tools : undefined
                        )) {
                            if (resultChunk.content) {
                                accumulatedContent += resultChunk.content;
                            }
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

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
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

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
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
        }

        // Removed get_map_context and get_map_areas - location and areas are now provided upfront in system prompt

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
            console.warn(`[AIService] Filtered out ${invalidCalls.length} invalid tool calls:`, invalidCalls);
        }
        
        // Execute all tool calls in parallel for better performance
        const toolPromises = validToolCalls.map(async (toolCall) => {
            try {
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


                    default:
                        // Log unknown tool for debugging
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
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
                const peopleList = r.result.map((p: any) => `${p.name} (at position ${p.position.x}, ${p.position.y})`).join(', ');
                return `get_people_on_map: People currently on the map: ${peopleList}`;
            }
            if (r.name === 'get_bot_position' && r.result && !r.result.error) {
                return `get_bot_position: Your current position is x: ${r.result.x}, y: ${r.result.y}`;
            }
            // Fallback to JSON for other results or errors
            return `${r.name}: ${JSON.stringify(r.result)}`;
        }).join('\n');
    }
}

