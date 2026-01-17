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
                                mapContextInfo += `\n- Areas in this room (additional context, not a replacement for location): ${areaNames.join(', ')}`;
                                // Make positions more explicit and readable
                                const areaDetails = areas.filter(a => a && a.name).map(a => `${a.name} is at coordinates (${a.x}, ${a.y})`).join('; ');
                                mapContextInfo += `\n- Area locations (use these when asked "where is [area name]"): ${areaDetails}`;
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
            let systemPrompt = chatInstructions || 'You are a friendly bot.';
            if (mapContextInfo) {
                systemPrompt += mapContextInfo;
            }
            if (conversationContext) {
                systemPrompt += `\n\nConversation Context:\n${conversationContext}`;
                // Add instruction to use conversation history for context
                systemPrompt += `\n\nIMPORTANT: Use the "Recent Conversation" above to understand context. If someone says "whats that", "where", or "whats in there", look at the most recent messages to understand what they're referring to. If they just asked about location, "that" refers to the location. Answer directly without asking questions back.`;
            }
            
            // Add formatting rules
            systemPrompt += `\n\nRESPONSE FORMATTING:
- Always capitalize the first letter of your response
- Write in complete sentences with proper grammar
- Don't ask questions back - answer directly
- Be natural and conversational`;
            
            // Add guidance for natural responses and tool usage
            systemPrompt += `\n\nWhen someone approaches you, greet them based on your personality (defined in your chat instructions) and your relationship with them (from conversation memory). Your greeting should reflect:
- Your personality traits (friendly, formal, playful, serious, etc. - as defined in your chat instructions)
- Your emotional state toward this person (if you've met before and have a relationship)
Keep greetings simple and natural - just greet them directly. Don't mention location or areas in greetings unless it's relevant to your personality or the conversation context. A simple "Hello!" or "Hi there!" is often better than a long greeting with location details.

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
10. Answer questions directly - NEVER ask the user questions back. NEVER respond with questions like "What is this place?", "How can I help?", "How can I assist you today?", "What can I do for you?", "Would you like to talk to them?", "or go somewhere else?", or ANY other questions. Just answer what they asked with a statement. 
    - If they say "hey", "hi", "hello", "how u doing", "whats up", "u good", or other casual greetings, respond naturally and briefly with a matching casual greeting or acknowledgment - NEVER ask how you can help. Examples: "Hey!" for "hey", "Hi!" for "hi", "I'm doing well!" for "how u doing".
    - If they say "cool" or "nice", just acknowledge it briefly.
    - If they ask "whats that", answer based on conversation history, don't ask questions back.
    - After listing people, just state the facts - don't ask what they want to do.
11. Always capitalize the first letter of your response and write in complete sentences with proper grammar.
12. ALWAYS use the EXACT values from "Current Location Context" - copy them directly, never use placeholders, brackets, or make things up. If it says "Universe: test", use "test universe", NOT "[test universe]".

When someone asks about:
- WHERE you are: "where are we", "what room", "what world", "what universe", "where inside" → ALWAYS mention universe, world, and room from "Current Location Context". Do NOT include area coordinates unless specifically asked about an area. Just give the location: "test universe, test world, test room".
- WHAT is this place: "what is this place", "what is this", "what's here" → ALWAYS mention universe, world, and room first, then mention areas if they exist. Format: "[universe name] universe, [world name] world, [room name] room" + areas if any. Use the actual names from context, NOT placeholders with brackets.
- WHAT the place is LIKE: "what is this place like", "describe this place" → Describe based on the room name from context, but do NOT invent fictional details
- WHAT TO DO here: "what do we do here", "what can we do", "whats there to do here" → Describe what's available (areas, activities) based on room/area names from context. Just describe - do NOT offer to take them anywhere or say "Follow me!" unless they explicitly ask to go somewhere.
- Areas/sections: "what areas", "what areas are here", "any areas", "what's this area", "areas here?", "areas?" → Check "Current Location Context" above. If it shows "Areas in this room: Office Area" (or other area names), list those areas. If it shows "Areas: none", say "There are no areas defined here."
- Area location: "where is [area name]", "where is the office area", "wheres that area", "where is it" (after mentioning an area) → Use the "Area locations" from "Current Location Context" above. Give the coordinates directly like "Office Area is at coordinates (596, 606)" or "It's at coordinates (596, 606)". Don't repeat the area name or location - just give coordinates.
- Navigation requests: "can you take me to [person/area]", "show me where [person/area] is", "lead me to [person/area]", "take me to [person/area]", "i wanna go to [person/area]", "take me there" → **CRITICAL: When someone asks you to take them somewhere, you MUST call the navigate_to tool FIRST. Do NOT generate any response text like "Follow me!" or "I'll take you there" until AFTER you have called the tool. The tool call must happen BEFORE any text response. For example, if they say "take me to the office area", you must: 1) Call navigate_to with targetType="area" and targetName="Office Area", 2) THEN respond with "Follow me!" or "I'll take you there".**
- **CRITICAL: Do NOT say "Follow me!" or offer to take someone somewhere unless they explicitly ask to go. When describing what's available ("whats there to do here"), just describe - don't offer to lead.**
- **If you already called navigate_to and said "Follow me!", and the user asks "why aren't you taking me" or "why aren't you moving", reassure them that you are leading them and they should follow. Do NOT say you can't take them - you already started leading.**
- Context questions: "whats that", "where", "whats in there", "whats this" → Look at the "Recent Conversation" in Conversation Context to understand what they're referring to. If they just asked "where we at" and you said "test universe, test world, test room", then "whats that" refers to that location. If they just asked about an area, "where is it" refers to that area's coordinates. Answer directly without asking questions back.
- Who's on the map: "who's here", "who's online" → **IMMEDIATELY call get_people_on_map tool FIRST. Do NOT say "I'll check" or announce you're checking. Just call the tool silently and then list the actual people from the results.**
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
- **CRITICAL: Vary your responses - NEVER repeat the same response for different questions or greetings**
- **For casual greetings, respond differently each time:**
  * "hey" → "Hey!" or "Hey there!" or "Hey, what's up!"
  * "hi" → "Hi!" or "Hi there!" or "Hey!"
  * "hello" → "Hello!" or "Hey!" or "Hi!"
  * "how u doing" / "hows it going" / "u good" → "I'm doing well!" or "Pretty good, thanks!" or "Doing great!" or "All good!"
  * "whats up" → "Not much!" or "Just hanging out!" or "What's up!" or "Hey!"
- **NEVER ask questions back** - NEVER say "How can I help you today?", "How can I assist you?", "What can I do for you?", or ANY other questions. Just respond naturally to what they said with a statement.
- Be conversational and natural - match the casual tone of their greeting
- Answer questions directly and contextually:
  * "where are we" → Give location once
  * "what's here" or "whats this" (after location mentioned) → Describe what this place is, mention areas if they exist, don't just repeat location
  * "what's in the office" or "where is [area]" or "wheres that area" → Just give the coordinates from "Area locations" in context, don't repeat the area name or full location
  * "whats there to do here" or "what can we do" → Just describe what's available (areas, activities). Do NOT offer to take them or say "Follow me!" - wait for them to explicitly ask to go somewhere.
  * "can you take me to [person/area]" or "show me where [person/area] is" or "lead me to [person/area]" or "take me there" → **ONLY when explicitly asked to go**, call navigate_to tool and respond naturally like "Follow me!" or "I'll take you there"
  * After calling get_people_on_map: List the people directly like "Khalid ABC is here." or "Khalid ABC and John are here." Do NOT mention coordinates or positions - people don't know about coordinates. Do NOT ask "Would you like to talk to them?" or any other questions. Just state the facts.
  * "areas?" or "any areas" → Check "Current Location Context" for areas. If "Areas in this room: Office Area" exists, say "There's an area called Office Area" or list them. If "Areas: none", say "There are no areas defined here."
- Don't append or repeat information - if you already said where you are, just answer the new question
- Be natural - like a real conversation where you don't repeat yourself
- Different questions need different responses - don't parrot the same answer`;

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
                return `get_people_on_map: People currently on the map: ${peopleList}`;
            }
            if (r.name === 'get_bot_position' && r.result && !r.result.error) {
                return `get_bot_position: Your current position is x: ${r.result.x}, y: ${r.result.y}`;
            }
            if (r.name === 'navigate_to' && r.result) {
                if (r.result.error) {
                    return `navigate_to: Error - ${r.result.error}. If navigation failed, explain the issue to the user (e.g., "I'm too close to that location" or "I couldn't find a path there"). Do NOT say you can't take them if you haven't tried yet - only say that if there was an actual error.`;
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

