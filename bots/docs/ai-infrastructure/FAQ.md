# AI Infrastructure FAQ

## Chat Streaming

### Q: Can bots stream AI tokens directly to the chat window?

**A:** Not directly with WorkAdventure's current chat system. Here's the situation:

**Current WorkAdventure Chat System:**
- Messages are sent via `PublicEvent` with `spaceMessage`
- Each message is a **complete string** - no incremental updates
- The chat UI displays complete messages, not partial ones

**Our Approach:**

**Phase 1 (Initial): Accumulate and Send**
```typescript
// Stream from AI provider, accumulate chunks, send when done
let fullMessage = '';

for await (const chunk of aiService.generateBotResponseStream(...)) {
    if (chunk.content) {
        fullMessage += chunk.content;
    }
    
    if (chunk.done) {
        // Send complete message to chat
        bot.sendChatMessage(spaceName, fullMessage);
    }
}
```

**Benefits:**
- ✅ Works with existing WorkAdventure chat system
- ✅ No upstream changes needed
- ✅ Simple implementation
- ✅ Still benefits from streaming (lower memory, faster processing)

**Limitations:**
- ❌ User doesn't see tokens appearing in real-time
- ❌ Still waits for full response before seeing message

**Phase 2 (Future): Incremental Updates**
If WorkAdventure adds support for incremental message updates, we could:
- Send chunks as they arrive
- Update chat message in real-time
- Show thinking tokens (if supported by UI)

**For Thinking Models:**
- Thinking tokens are captured in `chunk.metadata.thinking`
- Currently: Logged for debugging (not shown to user)
- Future: Could display in a collapsible "thinking" section in chat UI

## aiProviderRef in Admin API

### Q: We already have `aiProviderRef` in our bot model. How does it work?

**A:** `aiProviderRef` is a **string reference** to an AI provider configuration stored in Admin API. Here's how it works:

**Database Schema:**
```prisma
model Bot {
  id            String
  aiProviderRef String?  @map("ai_provider_ref") @db.VarChar(100)
  // ... other fields
}
```

**How It Works:**

1. **Admin Creates Provider:**
   ```json
   {
     "providerId": "lmstudio-local",
     "name": "LMStudio (Local)",
     "type": "lmstudio",
     "enabled": true,
     "endpoint": "http://localhost:1234",
     "model": "local-model"
   }
   ```

2. **User Creates Bot:**
   ```json
   {
     "botId": "bot-123",
     "name": "Helper Bot",
     "aiProviderRef": "lmstudio-local"  // Reference to provider
   }
   ```

3. **Bot Server Uses Reference:**
   ```typescript
   // Get bot config from Admin API
   const botConfig = await adminApiService.getBotConfiguration(botId);
   // botConfig.aiProviderRef = "lmstudio-local"
   
   // Fetch provider credentials using the reference
   const providerConfig = await aiService.getProviderConfig(botConfig.aiProviderRef);
   // Returns full provider config with credentials
   ```

**Benefits:**
- ✅ Separation of concerns: Provider config separate from bot config
- ✅ Reusability: Multiple bots can use same provider
- ✅ Security: Credentials stored once, referenced many times
- ✅ Easy updates: Change provider config, all bots using it get update

**Implementation:**
```typescript
// In AIService
async generateBotResponse(
    botId: string,
    // ...
    providerRef: string  // This is aiProviderRef from bot config
): Promise<string> {
    // Fetch provider config using the reference
    const providerConfig = await this.getProviderConfig(providerRef);
    
    // Use provider config to make AI call
    return await this.callAIProvider(providerConfig, ...);
}
```

## Provider Implementation Differences

### Q: Do OpenAI and Anthropic need different code implementations than LMStudio?

**A:** Yes! Here's the breakdown:

### LMStudio vs OpenAI

**Similarities:**
- ✅ Both use OpenAI-compatible API format
- ✅ Same endpoint structure: `/v1/chat/completions`
- ✅ Same request/response format
- ✅ Same streaming format (SSE)

**Differences:**
- 🔑 **API Key**: OpenAI requires API key, LMStudio doesn't
- 🌐 **Endpoint**: Different URLs
- 💰 **Cost**: OpenAI charges per token, LMStudio is free
- ⚡ **Rate Limits**: OpenAI has strict rate limits

**Implementation:**
```typescript
// LMStudioProvider and OpenAIProvider can share most code
// Only difference is endpoint and API key handling

class LMStudioProvider implements AIProvider {
    async *generateStream(...) {
        // No API key needed
        const response = await fetch(`${config.endpoint}/v1/chat/completions`, {
            headers: { 'Content-Type': 'application/json' },
            // No Authorization header
        });
    }
}

class OpenAIProvider implements AIProvider {
    async *generateStream(...) {
        // API key required
        const response = await fetch(`${config.endpoint}/v1/chat/completions`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,  // Required!
            },
        });
    }
}
```

### Anthropic

**Major Differences:**
- ❌ **Different API Format**: Not OpenAI-compatible
- ❌ **Different Endpoint**: `/v1/messages` (not `/v1/chat/completions`)
- ❌ **Different Request Structure**: `system` is separate field, not in messages array
- ❌ **Different Response Format**: Different SSE structure

**Implementation:**
```typescript
class AnthropicProvider implements AIProvider {
    async *generateStream(systemPrompt: string, userMessage: string, config: AIProviderConfig) {
        // Different endpoint
        const response = await fetch(`${config.endpoint}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,  // Different header name!
                'anthropic-version': '2023-06-01',  // Required version header
            },
            body: JSON.stringify({
                model: config.model,
                max_tokens: config.maxTokens,
                messages: [
                    { role: 'user', content: userMessage }  // No system in messages
                ],
                system: systemPrompt,  // System is separate field!
                stream: true,
            }),
        });
        
        // Different SSE parsing (different event types)
        // Anthropic uses: event: message_start, content_block_start, content_block_delta, etc.
    }
}
```

### Summary

| Provider | API Format | Endpoint | Auth | Implementation |
|----------|-----------|----------|------|----------------|
| LMStudio | OpenAI-compatible | `/v1/chat/completions` | None | Can share code with OpenAI |
| OpenAI | OpenAI | `/v1/chat/completions` | Bearer token | Can share code with LMStudio |
| Anthropic | Custom | `/v1/messages` | x-api-key | **Needs separate implementation** |

**Code Sharing Strategy:**
1. **Base Provider Class**: Common functionality (streaming parsing, error handling)
2. **LMStudioProvider**: Extends base, no API key
3. **OpenAIProvider**: Extends base, adds API key handling
4. **AnthropicProvider**: **Separate implementation** (different API format)

## Implementation Plan

### Phase 1: LMStudio (Easiest)
- ✅ No API key needed
- ✅ OpenAI-compatible format
- ✅ Good for testing

### Phase 2: OpenAI (Similar to LMStudio)
- ✅ Same format as LMStudio
- ✅ Just add API key handling
- ✅ Reuse most code

### Phase 3: Anthropic (Different)
- ⚠️ Needs separate implementation
- ⚠️ Different API format
- ⚠️ More complex

## Thinking Models

### Q: How do we handle thinking models that output reasoning tokens?

**A:** Thinking tokens are captured but not displayed in chat (currently).

**Current Implementation:**
```typescript
for await (const chunk of stream) {
    if (chunk.metadata?.thinking) {
        // Log for debugging
        console.log(`[AI Thinking] ${chunk.metadata.thinking}`);
        // Could also store in conversation memory for context
    }
    
    if (chunk.content) {
        fullMessage += chunk.content;
    }
}
```

**Future Options:**
1. **Debug Panel**: Show thinking in a collapsible debug section
2. **Chat Annotation**: Add thinking as a tooltip or annotation
3. **Memory Only**: Store thinking for context, don't display
4. **Admin Dashboard**: Show thinking in usage analytics

**Recommendation:** Start with logging, add UI display later if needed.

## Cost Models and Billing

### Q: LMStudio is free, but can we charge for our LMStudio implementation?

**A:** Yes! Even though LMStudio software is free/open source, hosting it has costs. You can charge for:

1. **Infrastructure Costs:**
   - Server hosting (CPU, RAM, GPU if using GPU acceleration)
   - Network bandwidth
   - Storage for models

2. **Usage-Based Pricing:**
   - Per token (similar to OpenAI)
   - Per API call
   - Per compute hour
   - Flat rate per bot

3. **Service Costs:**
   - Bot service infrastructure
   - Support and maintenance
   - Custom features

### Cost Calculation

**For LMStudio (Self-Hosted):**
```typescript
// Calculate cost based on your infrastructure
interface LMStudioCost {
    // Infrastructure costs
    serverCostPerHour: number;      // e.g., $0.10/hour for GPU instance
    computeCostPerToken: number;     // e.g., $0.00001 per token (based on compute time)
    
    // Or flat rate
    costPerRequest: number;         // e.g., $0.001 per request
    
    // Or hybrid
    baseCost: number;                // Base monthly cost
    costPerToken: number;            // Additional per-token cost
}
```

**Usage Tracking:**
```typescript
// Track usage for billing
await adminApiService.trackAIUsage({
    botId: "bot-123",
    providerId: "lmstudio-local",
    tokensUsed: 150,
    apiCalls: 1,
    latency: 1250,
    cost: calculateLMStudioCost(150, 1250), // Your cost calculation
    timestamp: new Date().toISOString(),
});
```

### Cost Calculation Examples

**Example 1: Per-Token Pricing**
```typescript
function calculateLMStudioCost(tokensUsed: number, latency: number): number {
    // Base cost per token (based on your infrastructure costs)
    const costPerToken = 0.00001; // $0.00001 per token
    
    // Or based on compute time
    const computeTimeHours = latency / (1000 * 60 * 60);
    const serverCostPerHour = 0.10; // $0.10/hour for GPU instance
    const costPerToken = (computeTimeHours * serverCostPerHour) / tokensUsed;
    
    return tokensUsed * costPerToken;
}
```

**Example 2: Flat Rate + Usage**
```typescript
function calculateLMStudioCost(tokensUsed: number, apiCalls: number): number {
    // Base cost per request
    const baseCost = 0.001; // $0.001 per request
    
    // Additional cost per token (for high usage)
    const costPerToken = 0.000005; // $0.000005 per token
    
    return (apiCalls * baseCost) + (tokensUsed * costPerToken);
}
```

**Example 3: Tiered Pricing**
```typescript
function calculateLMStudioCost(tokensUsed: number): number {
    // Tier 1: First 1000 tokens free
    if (tokensUsed <= 1000) return 0;
    
    // Tier 2: 1001-10000 tokens at $0.00001 per token
    if (tokensUsed <= 10000) {
        return (tokensUsed - 1000) * 0.00001;
    }
    
    // Tier 3: 10001+ tokens at $0.000005 per token (volume discount)
    return (9000 * 0.00001) + ((tokensUsed - 10000) * 0.000005);
}
```

### Provider Cost Comparison

| Provider | Software Cost | Infrastructure Cost | Your Pricing Model |
|----------|-------------|-------------------|-------------------|
| **LMStudio** | Free (open source) | Your server costs | **You set the price** |
| **OpenAI** | Paid (per token) | Included in API cost | Pass-through or markup |
| **Anthropic** | Paid (per token) | Included in API cost | Pass-through or markup |

### Billing Integration

**Admin API Usage Tracking:**
```typescript
// bots_ai_usage table tracks:
{
    botId: "bot-123",
    providerId: "lmstudio-local",
    tokensUsed: 150,
    apiCalls: 1,
    cost: 0.0015,  // Your calculated cost
    latency: 1250,
    timestamp: "2025-01-09T12:00:00Z"
}
```

**Billing Calculation:**
```typescript
// Admin API can aggregate costs for billing
SELECT 
    botId,
    providerId,
    SUM(tokensUsed) as totalTokens,
    SUM(apiCalls) as totalCalls,
    SUM(cost) as totalCost
FROM bots_ai_usage
WHERE timestamp >= '2025-01-01'
GROUP BY botId, providerId;
```

### Pricing Strategy Recommendations

1. **Start Simple:**
   - Flat rate per bot per month
   - Or per-token pricing (match OpenAI pricing for simplicity)

2. **Add Tiers:**
   - Free tier: 1000 tokens/month
   - Basic: $10/month for 10,000 tokens
   - Pro: $50/month for 100,000 tokens

3. **Cost-Plus Pricing:**
   - Calculate your actual infrastructure costs
   - Add markup (e.g., 2x or 3x)
   - Price competitively with OpenAI/Anthropic

4. **Hybrid Model:**
   - Base subscription fee
   - Usage-based overage charges
   - Best of both worlds

### Q: Ultravox charges $0.05 per minute. Does the model account for this?

**A:** Yes! The billing model now supports per-minute pricing for voice AI providers like Ultravox.

**Configuration:**
```typescript
const ultravoxConfig: AIProviderConfig = {
    providerId: 'ultravox-production',
    type: 'ultravox',
    pricingModel: 'per-minute',
    costPerMinute: 0.05, // $0.05 per minute
    roundUpMinutes: true, // Round up to nearest minute (default)
    minimumMinutes: 1, // Minimum 1 minute charge (default)
};
```

**Cost Calculation:**
- Duration is tracked in seconds
- Rounded up to nearest minute (default behavior)
- Minimum charge applies (e.g., 1 minute minimum)
- Example: 90 seconds = 2 minutes (rounded up) = $0.10

**Usage Tracking:**
```typescript
// Track voice AI usage with duration
await this.trackUsage(botId, 'ultravox-production', {
    tokensUsed: 0, // Not applicable for voice AI
    apiCalls: 1,
    latency: 1250,
    durationSeconds: 150, // 2.5 minutes
    cost: 0.15, // 3 minutes (rounded up) * $0.05 = $0.15
});
```

**Database:**
- `duration_seconds` field stores the actual duration
- `cost` field stores the calculated per-minute cost
- Admin API can aggregate costs by duration for billing

**Examples:**
- 30 seconds = 1 minute (minimum) = $0.05
- 90 seconds = 2 minutes (rounded up) = $0.10
- 150 seconds = 3 minutes (rounded up) = $0.15
- 60 seconds = 1 minute = $0.05

