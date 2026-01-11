# AI Provider Implementations

This document describes the implementation details for each AI provider.

## Provider Interface

All providers implement the `AIProvider` interface:

```typescript
export interface AIProvider {
    getName(): string;
    isReady(): boolean;
    supportsStreaming(): boolean;
    
    async *generateStream(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig
    ): AsyncGenerator<AIStreamChunk>;
    
    async generate(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig
    ): Promise<AIResponse>;
}
```

## LMStudio Provider

### Configuration

```typescript
interface LMStudioConfig extends AIProviderConfig {
    type: 'lmstudio';
    endpoint: string;  // e.g., "http://localhost:1234"
    model: string;     // e.g., "local-model"
    temperature?: number;
    maxTokens?: number;
}
```

### API Format

**Endpoint:** `{endpoint}/v1/chat/completions`

**Request:**
```json
{
  "model": "local-model",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 500
}
```

**Streaming Response (SSE):**
```
data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" there"}}]}

data: {"usage":{"total_tokens":10}}

data: [DONE]
```

### Implementation Notes

- ✅ Supports streaming
- ✅ No API key required (local)
- ✅ Compatible with OpenAI API format
- ⚠️ Endpoint may be localhost (use `host.docker.internal` in Docker)

## OpenAI Provider (Future)

### Configuration

```typescript
interface OpenAIConfig extends AIProviderConfig {
    type: 'openai';
    endpoint: string;  // "https://api.openai.com/v1"
    apiKey: string;     // Encrypted in Admin API
    model: string;      // "gpt-4", "gpt-3.5-turbo", etc.
    temperature?: number;
    maxTokens?: number;
}
```

### API Format

**Endpoint:** `https://api.openai.com/v1/chat/completions`

**Request:**
```json
{
  "model": "gpt-4",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 500
}
```

**Streaming Response:** Same SSE format as LMStudio

### Implementation Notes

- ✅ Supports streaming
- ✅ Requires API key
- ✅ Rate limits apply
- ✅ Cost per token

## Anthropic Provider (Future)

### Configuration

```typescript
interface AnthropicConfig extends AIProviderConfig {
    type: 'anthropic';
    endpoint: string;  // "https://api.anthropic.com/v1"
    apiKey: string;    // Encrypted in Admin API
    model: string;     // "claude-3-opus", "claude-3-sonnet", etc.
    temperature?: number;
    maxTokens?: number;
}
```

### API Format

**Endpoint:** `https://api.anthropic.com/v1/messages`

**Request:**
```json
{
  "model": "claude-3-opus-20240229",
  "max_tokens": 500,
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "system": "You are a helpful assistant."
}
```

**Streaming Response:** SSE format (different structure)

### Implementation Notes

- ✅ Supports streaming
- ✅ Requires API key
- ✅ Different API format (not OpenAI-compatible)
- ✅ Cost per token

## Adding a New Provider

### Steps

1. **Create Provider Class**
   ```typescript
   // bots/ai/providers/NewProvider.ts
   export class NewProvider implements AIProvider {
       // Implement interface
   }
   ```

2. **Add to Registry**
   ```typescript
   // bots/ai/AIProviderRegistry.ts
   switch (config.type) {
       case 'newprovider':
           provider = new NewProvider();
           break;
   }
   ```

3. **Update Admin API**
   - Add provider type to database
   - Add to admin UI
   - Test connection

4. **Document**
   - Add to this file
   - Document API format
   - Document configuration

### Provider Checklist

- [ ] Streaming support
- [ ] Non-streaming fallback
- [ ] Error handling
- [ ] Retry logic
- [ ] Timeout handling
- [ ] Token counting
- [ ] Cost tracking (if applicable)
- [ ] Testing
- [ ] Documentation

## Provider Comparison

| Provider | Streaming | API Key | Software Cost | Infrastructure | Your Pricing | Local | Format | Code Sharing |
|----------|----------|---------|---------------|---------------|--------------|-------|--------|--------------|
| LMStudio | ✅ | ❌ | Free (OSS) | Your servers | **You set price** | ✅ | OpenAI-compatible | Can share with OpenAI |
| OpenAI | ✅ | ✅ | Paid (per token) | Included | Pass-through/markup | ❌ | OpenAI | Can share with LMStudio |
| Anthropic | ✅ | ✅ | Paid (per token) | Included | Pass-through/markup | ❌ | Custom | **Separate implementation** |

### Cost Models

**LMStudio:**
- ✅ Software is free (open source)
- ⚠️ Infrastructure costs (servers, compute, GPU)
- 💰 **You control pricing** - can charge per token, per request, or flat rate
- 📊 Track usage and calculate costs based on your infrastructure

**OpenAI/Anthropic:**
- 💰 Provider charges per token
- 📊 You can pass-through costs or add markup
- 📈 Costs scale with usage

## Implementation Strategy

### Code Sharing

**LMStudio and OpenAI:**
- ✅ Same API format (OpenAI-compatible)
- ✅ Same endpoint structure (`/v1/chat/completions`)
- ✅ Same streaming format (SSE)
- ✅ Can share 90% of code
- ⚠️ Only difference: API key handling

**Anthropic:**
- ❌ Different API format
- ❌ Different endpoint (`/v1/messages`)
- ❌ Different request structure (system is separate field)
- ❌ Different response format
- ⚠️ Needs separate implementation (can share base utilities)

### Recommended Approach

1. **Create Base Provider Class:**
   ```typescript
   abstract class BaseAIProvider implements AIProvider {
       // Common functionality: streaming parsing, error handling, retry logic
   }
   ```

2. **LMStudio Provider:**
   ```typescript
   class LMStudioProvider extends BaseAIProvider {
       // Extends base, no API key needed
   }
   ```

3. **OpenAI Provider:**
   ```typescript
   class OpenAIProvider extends BaseAIProvider {
       // Extends base, adds API key to headers
       // Reuses all streaming logic from base
   }
   ```

4. **Anthropic Provider:**
   ```typescript
   class AnthropicProvider implements AIProvider {
       // Separate implementation (different API format)
       // Can still use base utilities for error handling, etc.
   }
   ```

## Testing Providers

### Test Connection

```typescript
async function testProvider(provider: AIProvider): Promise<boolean> {
    try {
        const response = await provider.generate(
            "You are a test bot.",
            "Say hello",
            config
        );
        return response.message.length > 0;
    } catch (error) {
        console.error('Provider test failed:', error);
        return false;
    }
}
```

### Test Streaming

```typescript
async function testStreaming(provider: AIProvider): Promise<boolean> {
    try {
        let chunks = 0;
        for await (const chunk of provider.generateStream(...)) {
            chunks++;
            if (chunk.done) break;
        }
        return chunks > 0;
    } catch (error) {
        console.error('Streaming test failed:', error);
        return false;
    }
}
```

## Provider-Specific Features

### Thinking Models

Some providers support "thinking" or "reasoning" tokens:

- **OpenAI o1**: Shows reasoning process
- **Claude Sonnet 4.5**: Shows thinking tokens

**Handling:**
```typescript
if (chunk.metadata?.thinking) {
    // Store or display thinking
    console.log(`[Thinking] ${chunk.metadata.thinking}`);
}
```

### Function Calling

Some providers support function calling:

- **OpenAI**: `functions` parameter
- **Anthropic**: Tool use

**Future Enhancement:** Could enable bots to call WorkAdventure APIs

### Image Support

Some providers support images:

- **OpenAI GPT-4 Vision**: Image inputs
- **Claude 3**: Image inputs

**Future Enhancement:** Bots could analyze map screenshots

