# Bot Server Requirements for AI Infrastructure

This document outlines what needs to be implemented in the bot server to support AI provider functionality.

## Required Components

### 1. AIService

**Location:** `bots/ai/AIService.ts`

**Responsibilities:**
- Fetch provider credentials from Admin API
- Cache credentials securely (1 hour TTL)
- Stream responses from AI providers
- Track usage back to Admin API
- Handle errors gracefully

**Key Methods:**
```typescript
class AIService {
    // Generate streaming response
    async *generateBotResponseStream(
        botId: string,
        playerId: number,
        message: string,
        chatInstructions: string,
        movementInstructions: string | undefined,
        providerId: string,
        spaceName: string | undefined,
        conversationContext: string
    ): AsyncGenerator<AIStreamChunk>;

    // Get available providers (for bot editor)
    async getAvailableProviders(): Promise<Array<{ providerId: string; name: string }>>;
}
```

### 2. AIProvider Interface

**Location:** `bots/ai/AIProvider.ts`

**Purpose:** Abstract interface for all AI providers.

```typescript
export interface AIProvider {
    getName(): string;
    isReady(): boolean;
    supportsStreaming(): boolean;
    
    // Stream response
    async *generateStream(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig
    ): AsyncGenerator<AIStreamChunk>;
    
    // Non-streaming fallback
    async generate(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig
    ): Promise<AIResponse>;
}
```

### 3. Provider Implementations

**Location:** `bots/ai/providers/`

**Required Providers:**
- `LMStudioProvider.ts` - LMStudio implementation
- `OpenAIProvider.ts` - OpenAI implementation (future)
- `AnthropicProvider.ts` - Anthropic implementation (future)

### 4. AIProviderRegistry

**Location:** `bots/ai/AIProviderRegistry.ts`

**Purpose:** Manages provider instances and routes requests.

```typescript
class AIProviderRegistry {
    registerProvider(config: AIProviderConfig, provider: AIProvider): void;
    getProvider(providerId: string): AIProvider | null;
    async *generateStream(providerId: string, ...): AsyncGenerator<AIStreamChunk>;
}
```

## Integration Points

### BotManager Integration

**Location:** `bots/server/BotManager.ts`

```typescript
export class BotManager {
    private aiService: AIService;
    private conversationMemory: ConversationMemory;

    constructor() {
        this.conversationMemory = new ConversationMemory(50, 1000);
        this.aiService = new AIService(
            this.conversationMemory,
            process.env.ADMIN_API_URL,
            process.env.BOT_SERVICE_TOKEN
        );
    }

    getAIService(): AIService {
        return this.aiService;
    }

    getConversationMemory(): ConversationMemory {
        return this.conversationMemory;
    }
}
```

### Behavior Integration

**Location:** `bots/behaviors/SocialBehavior.ts`, `PatrolBehavior.ts`, `IdleBehavior.ts`

```typescript
// In SocialBehavior.ts
onChatMessage(spaceName: string, message: string, senderId: number): void {
    // ... existing code ...
    
    // Generate AI response
    this.generateAIResponseStream(spaceName, senderId, message, botId);
}

private async generateAIResponseStream(
    spaceName: string,
    playerId: number,
    playerMessage: string,
    botId: string
): Promise<void> {
    const aiService = this.getAIService();
    const botConfig = await adminApiService.getBotConfiguration(botId);
    
    // Note: Bot config uses aiProviderRef (string reference to provider)
    // This is the existing field in the Admin API bot model
    if (!botConfig?.aiProviderRef) {
        console.warn(`[SocialBehavior] Bot ${botId} has no AI provider configured (aiProviderRef missing)`);
        return;
    }

    const context = this.conversationMemory.getConversationContext(botId, playerId);
    
    let fullMessage = '';
    
    try {
        for await (const chunk of aiService.generateBotResponseStream(
            botId,
            playerId,
            playerMessage,
            botConfig.chatInstructions || 'You are a friendly bot.',
            botConfig.movementInstructions,
            botConfig.aiProviderRef, // This is the reference string (e.g., "lmstudio-local")
            spaceName,
            context
        )) {
            if (chunk.content) {
                fullMessage += chunk.content;
            }
            
            if (chunk.done) {
                // Send complete message (WorkAdventure chat requires complete messages)
                this.bot.sendChatMessage(spaceName, fullMessage);
                
                // Store in memory
                this.conversationMemory.addMessage(botId, playerId, fullMessage, 'bot', spaceName);
                
                // Track usage
                if (chunk.metadata?.tokensUsed) {
                    await this.trackAIUsage(botId, botConfig.aiProviderRef, {
                        tokensUsed: chunk.metadata.tokensUsed,
                    });
                }
            }
        }
    } catch (error) {
        console.error(`[SocialBehavior] AI error:`, error);
        this.bot.sendChatMessage(spaceName, "I'm having trouble processing that. Could you rephrase?");
    }
}
```

## Environment Variables

**Required:**
```bash
# Admin API
ADMIN_API_URL=http://admin-api.workadventure.localhost
BOT_SERVICE_TOKEN=bot-service-readonly-token

# AI Mode (optional, defaults to 'direct')
AI_MODE=direct  # or 'proxy' (future)

# Debug
ENABLE_BOT_DEBUG=true
NODE_ENV=development
```

## Credential Caching

**Strategy:**
- Cache credentials per provider (not per bot)
- TTL: 1 hour
- Memory-only (never persisted)
- Clear cache on credential fetch errors

**Implementation:**
```typescript
private credentialCache: Map<string, {
    credentials: AIProviderConfig;
    expiresAt: number;
}> = new Map();

private readonly CREDENTIAL_TTL = 60 * 60 * 1000; // 1 hour

private async getProviderCredentials(providerId: string): Promise<AIProviderConfig> {
    // Check cache
    const cached = this.credentialCache.get(providerId);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.credentials;
    }

    // Fetch from Admin API
    const credentials = await this.fetchFromAdminAPI(providerId);
    
    // Cache
    this.credentialCache.set(providerId, {
        credentials,
        expiresAt: Date.now() + this.CREDENTIAL_TTL,
    });
    
    return credentials;
}
```

## Streaming Implementation

### LMStudio Streaming

```typescript
private async *streamFromLMStudio(
    config: AIProviderConfig,
    systemPrompt: string,
    userMessage: string
): AsyncGenerator<AIStreamChunk> {
    const response = await fetch(`${config.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            stream: true,
            temperature: config.temperature,
            max_tokens: config.maxTokens,
        }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tokensUsed = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                    yield { content: '', done: true, metadata: { tokensUsed } };
                    return;
                }

                try {
                    const json = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta;

                    if (delta?.content) {
                        yield { content: delta.content, done: false };
                    }

                    if (json.usage?.total_tokens) {
                        tokensUsed = json.usage.total_tokens;
                    }
                } catch (e) {
                    // Skip invalid JSON
                }
            }
        }
    }

    yield { content: '', done: true, metadata: { tokensUsed } };
}
```

## Error Handling

### Retry Logic

```typescript
private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = 3
): Promise<Response> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            }
            
            // Don't retry on 4xx errors (except 429)
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                throw new Error(`Client error: ${response.status}`);
            }
            
            // Retry with exponential backoff
            await this.sleep(Math.pow(2, i) * 1000);
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await this.sleep(Math.pow(2, i) * 1000);
        }
    }
    
    throw new Error('Max retries exceeded');
}
```

### Fallback Messages

```typescript
const FALLBACK_MESSAGES = [
    "I'm having trouble processing that. Could you rephrase?",
    "I didn't quite understand that. Can you try again?",
    "Something went wrong on my end. Let's try again?",
];

private getFallbackMessage(): string {
    return FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)];
}
```

## Usage Tracking

**Strategy:**
- Track after stream completes (not per chunk)
- Async tracking (don't block response)
- Batch multiple requests if possible

```typescript
private async trackUsage(
    botId: string,
    providerId: string,
    metadata: { tokensUsed?: number; latency?: number; error?: boolean }
): Promise<void> {
    // Calculate cost based on provider pricing model
    const cost = this.calculateCost(providerId, metadata.tokensUsed || 0, metadata.latency || 0);
    
    // Fire and forget
    fetch(`${this.adminApiUrl}/api/bots/ai-usage`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${this.serviceToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            botId,
            providerId,
            tokensUsed: metadata.tokensUsed || 0,
            apiCalls: 1,
            latency: metadata.latency,
            cost, // Calculated cost (for LMStudio: your pricing, for OpenAI/Anthropic: API cost or markup)
            error: metadata.error || false,
            timestamp: new Date().toISOString(),
        }),
    }).catch(err => {
        // Don't throw - tracking shouldn't break bot functionality
        console.error(`[AIService] Failed to track usage:`, err);
    });
}

/**
 * Calculate cost based on provider pricing model
 * For LMStudio: Use your pricing (per-token, per-request, hybrid, etc.)
 * For OpenAI/Anthropic: Use actual API cost or your markup
 */
private calculateCost(providerId: string, tokensUsed: number, latency: number): number {
    const providerConfig = this.getProviderConfig(providerId);
    if (!providerConfig) return 0;

    // LMStudio: Your pricing model
    if (providerConfig.type === 'lmstudio') {
        // Per-token pricing (default)
        const costPerToken = providerConfig.costPerToken || 0.00001;
        return tokensUsed * costPerToken;
        
        // Or per-request + per-token (hybrid)
        // const baseCost = providerConfig.costPerRequest || 0.001;
        // return baseCost + (tokensUsed * costPerToken);
    }

    // OpenAI/Anthropic: Provider cost or markup
    if (providerConfig.type === 'openai' || providerConfig.type === 'anthropic') {
        const costPerToken = providerConfig.costPerToken || 0.00003;
        const markup = providerConfig.markup || 1.0; // No markup by default
        return (tokensUsed * costPerToken) * markup;
    }

    return 0;
}
```

## Testing Requirements

1. **Unit Tests:**
   - Credential caching
   - Streaming parsing
   - Error handling
   - Retry logic

2. **Integration Tests:**
   - End-to-end streaming
   - Admin API integration
   - Multiple concurrent streams
   - Error scenarios

3. **Load Tests:**
   - 1000 concurrent streams
   - Memory usage
   - Latency measurements

## File Structure

```
bots/
├── ai/
│   ├── AIService.ts
│   ├── AIProvider.ts
│   ├── AIProviderRegistry.ts
│   └── providers/
│       ├── LMStudioProvider.ts
│       ├── OpenAIProvider.ts (future)
│       └── AnthropicProvider.ts (future)
├── server/
│   └── BotManager.ts (integration)
└── behaviors/
    ├── SocialBehavior.ts (integration)
    ├── PatrolBehavior.ts (integration)
    └── IdleBehavior.ts (integration)
```

