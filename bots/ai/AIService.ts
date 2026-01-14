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

            // Build system prompt
            let systemPrompt = chatInstructions || 'You are a friendly bot.';
            if (conversationContext) {
                systemPrompt += `\n\nConversation Context:\n${conversationContext}`;
            }
            
            // Add guidance for natural responses and tool usage
            systemPrompt += `\n\nWhen someone approaches you, respond naturally and conversationally. If you've met this person before, use your memory to respond appropriately. Don't ask meta questions about what kind of person they are - just respond naturally based on the situation.

CRITICAL RULES:
1. You MUST use tools to get information. Never guess or use placeholders like "[Room Name]", "[World Name]", "[Universe Name]", "[list of areas]", or any text in square brackets.
2. NEVER ask the user to call tools - YOU call them yourself when needed.
3. NEVER mention or describe calling tools in your responses - just call them silently and use the results. Don't say "I'll call the tool" or "Let me use the tool" - just call it and answer with the results.
4. NEVER show tool call JSON or "[END_TOOL_REQUEST]" in your response - these are internal, not for users.
5. NEVER respond with vague answers like "common area" or "large building" - always call get_map_context to get the actual location names.
6. Answer questions directly - don't ask the user questions back unless it's a natural conversation flow.
7. After getting location from tools, provide CONTEXTUAL answers based on the question type - don't just repeat the location.
8. ALWAYS use the EXACT values from tool results - copy them directly, never use placeholders.

When someone asks about:
- WHERE you are: "where are we", "what room", "what world", "what universe", "where is this" → Call get_map_context and respond with ALL THREE: universe name, world name, and room name. Always mention all three, never skip any.
- WHAT is this place: "what is this place", "what is this" → Call get_map_context to get location, then provide a brief description of what kind of place it is based on the room name (e.g., "This is the test room in the test world - it appears to be a testing or development space")
- WHAT the place is LIKE (description/atmosphere): "what is this place like", "describe this place", "what's this place like" → Call get_map_context, then provide a meaningful description of the place's character, atmosphere, or purpose based on the room name
- WHAT TO DO here: "what do we do here", "what can we do", "what happens here" → Call get_map_context to understand the location, then suggest activities or purposes based on the room name and context. Be creative but reasonable.
- Who's on the map: "who's here", "who's online", "whos online here" → Call get_people_on_map tool and list the people
- Map areas/sections: "what areas are here", "what sections", "what zones", "what rooms are on this map", "show me areas" → Call get_map_areas tool to get list of areas defined in the map editor
- Your position: "where are you" → Use get_bot_position tool

Remember: 
- YOU call the tools silently - never mention them in your response. Just call them and use the results to answer.
- After getting location, provide CONTEXTUAL answers - don't just repeat location for every question
- Different questions need different types of responses (location vs description vs activities)
- When asked multiple things (like "what's this place and what areas there are"), call ALL relevant tools and answer ALL parts of the question
- When asked "tell me more", "what else", or similar follow-ups, provide ADDITIONAL information you haven't mentioned yet:
  * Use get_map_areas to describe areas/sections on the map
  * Use get_people_on_map to mention who's currently here
  * Provide more creative details about the place based on the room name
  * Don't repeat what you just said - expand with new information
- Vary your responses - don't use the same format for every answer
- NEVER say "I'll call" or "Let me use" - just call tools and answer naturally`;

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
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Received tool calls:`, chunk.toolCalls);
                        }
                        pendingToolCalls.push(...chunk.toolCalls);
                    }

                    // If we have tool calls and chunk is done, execute them BEFORE yielding any content
                    if (chunk.done && pendingToolCalls.length > 0) {
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Executing ${pendingToolCalls.length} tool calls`);
                        }
                        // Execute tool calls and continue conversation
                        const toolResults = await this.executeToolCalls(pendingToolCalls, botClient, adminApiService || this.adminApiService);
                        pendingToolCalls = [];

                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[AIService] Tool results:`, toolResults);
                        }

                        // Continue conversation with tool results
                        const toolResultsMessage = this.formatToolResults(toolResults);
                        // Include explicit instruction to use tool results - be very direct
                        // Format as a clear instruction to the AI
                        const followUpMessage = `User asked: "${message}"

You called tools and received these results:
${toolResultsMessage}

IMPORTANT: 
- Use the context from the tool results above to answer naturally and conversationally
- Use the actual names/values from the results - never use placeholders like "[Room Name]", "[World Name]", or any text in square brackets
- NEVER show tool calls, JSON, or "[END_TOOL_REQUEST]" in your response - these are internal only
- When talking about location, naturally mention universe, world, and room using the actual names from the context
- Be conversational and natural - don't sound robotic or templated`;
                        
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

        if (adminApiService && botClient) {
            // Tool: Get map context (universe, world, room names)
            tools.push({
                type: 'function',
                function: {
                    name: 'get_map_context',
                    description: 'Get the current location context including universe name, world name, and room name. Use this ONLY for questions about WHERE you are (location), such as "where are we", "what room", "what world", "what universe". Do NOT use this for questions about what the place is LIKE (description/character).',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
            });

            // Tool: Get map areas
            if (this.mapDataService) {
                tools.push({
                    type: 'function',
                    function: {
                        name: 'get_map_areas',
                        description: 'Get a list of all areas defined on the map using the map editor. Areas are named zones/sections drawn on the map. Use this when asked about "what areas are here", "what sections", "what zones", "show me areas", or similar questions about map areas.',
                        parameters: {
                            type: 'object',
                            properties: {},
                            required: [],
                        },
                    },
                });
            }
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
        // Execute all tool calls in parallel for better performance
        const toolPromises = toolCalls.map(async (toolCall) => {
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

                    case 'get_map_context':
                        if (botClient && adminApiService) {
                            const roomUrl = botClient.getRoomUrl();
                            const metadata = await adminApiService.getRoomMetadata(roomUrl);
                            result = metadata || { error: 'Could not get room metadata' };
                        } else {
                            result = { error: 'Services not available' };
                        }
                        break;

                    case 'get_map_areas':
                        if (botClient && this.mapDataService) {
                            const roomUrl = botClient.getRoomUrl();
                            const areas = await this.mapDataService.getAreas(roomUrl);
                            // Format areas with name, position, and size
                            result = areas.map((area: any) => ({
                                name: area.name,
                                position: { x: area.x, y: area.y },
                                size: { width: area.width, height: area.height },
                                properties: area.properties || {},
                            }));
                        } else {
                            result = { error: 'Map data service not available' };
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
            if (r.name === 'get_map_context' && r.result && !r.result.error) {
                const { universeName, worldName, roomName } = r.result;
                // Provide context naturally - let the AI use it in its own words
                return `Location context:
- You are in the "${roomName}" room
- This room is in the "${worldName}" world  
- The world is part of the "${universeName}" universe

Use this context naturally in your response. Mention all three (universe, world, room) but in a conversational, natural way. Don't use placeholders - use the actual names: ${universeName}, ${worldName}, ${roomName}.`;
            }
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
            if (r.name === 'get_map_areas' && Array.isArray(r.result)) {
                if (r.result.length === 0) {
                    return `There are no defined areas on this map.`;
                }
                const areaNames = r.result.map((a: any) => a.name).filter(Boolean);
                return `Areas on this map: ${areaNames.join(', ')}

Use these area names naturally in your response. Don't use placeholders - mention the actual areas: ${areaNames.map((n: string) => `"${n}"`).join(', ')}.`;
            }
            // Fallback to JSON for other results or errors
            return `${r.name}: ${JSON.stringify(r.result)}`;
        }).join('\n');
    }
}

