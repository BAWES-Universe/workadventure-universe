# AI Infrastructure Architecture

## Overview

The AI infrastructure enables bots to generate intelligent responses using various AI providers (LMStudio, OpenAI, Anthropic, etc.) while maintaining security, scalability, and debuggability.

## Architecture Decision: Direct Mode with Credential Delegation

We've chosen **direct mode** where the bot server makes AI provider calls directly, but credentials are fetched from Admin API. This provides:

- ✅ **Streaming Support**: Direct streaming from AI provider to WebSocket
- ✅ **Low Latency**: No proxy hop, minimal network overhead
- ✅ **Debuggability**: Full visibility of requests/responses in bot server logs
- ✅ **Scalability**: Handles thousands of concurrent streams efficiently
- ✅ **Security**: Credentials stored in Admin API, never hardcoded

## System Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        Admin API                             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ AI Provider Configuration                            │  │
│  │  - Provider credentials (encrypted)                  │  │
│  │  - Endpoints, models, settings                       │  │
│  │  - Enable/disable providers                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           │ (1) Request credentials          │
│                           │     (Bearer: BOT_SERVICE_TOKEN)  │
│                           ▼                                  │
└─────────────────────────────────────────────────────────────┘
                           │
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Bot Server                              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ AIService                                            │  │
│  │  - Fetches provider credentials from Admin API        │  │
│  │  - Caches credentials (1 hour TTL)                   │  │
│  │  - Manages provider registry                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           │ (2) Stream from AI provider      │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ AI Provider (LMStudio, OpenAI, etc.)                 │  │
│  │  - Direct API calls                                  │  │
│  │  - Streaming support                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           │ (3) Stream response chunks       │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Behavior (SocialBehavior, etc.)                      │  │
│  │  - Processes stream chunks                           │  │
│  │  - Sends to WebSocket                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           │ (4) Stream to client             │
│                           ▼                                  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  WorkAdventure Client                        │
│                                                              │
│  - Receives streamed chat messages                          │
│  - Displays in real-time                                    │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Admin API

**Responsibilities:**
- Store AI provider configurations (credentials, endpoints, models)
- Store bot `aiProviderRef` (string reference to provider)
- Issue credentials to bot server (via service token)
- Track AI usage (tokens, API calls, costs)
- Manage provider enable/disable state

**Endpoints Needed:**
- `GET /api/bots/ai-providers/:providerId/credentials` - Get provider credentials (using `aiProviderRef` from bot config)
- `GET /api/bots/ai-providers?enabled=true` - List available providers
- `POST /api/bots/ai-usage` - Track usage metrics

**Existing Schema:**
- Bot model already has `aiProviderRef String?` field
- This is the reference string (e.g., "lmstudio-local", "openai-gpt4")
- Bot server uses this to fetch full provider config from Admin API

### 2. Bot Server (AIService)

**Responsibilities:**
- Fetch provider credentials from Admin API
- Cache credentials securely (short TTL)
- Stream responses from AI providers
- Track usage back to Admin API
- Handle multiple provider types (LMStudio, OpenAI, etc.)

**Key Classes:**
- `AIService` - Main service for AI operations
- `AIProviderRegistry` - Manages provider instances
- `LMStudioProvider` - LMStudio implementation
- `OpenAIProvider` - OpenAI implementation (future)
- `AnthropicProvider` - Anthropic implementation (future)

### 3. Behavior Integration

**Responsibilities:**
- Call AIService when player sends message
- Stream response chunks to WebSocket
- Store conversation in memory
- Track usage metrics

**Integration Points:**
- `SocialBehavior.onChatMessage()` - Triggers AI response
- `PatrolBehavior.onChatMessage()` - Triggers AI response
- `IdleBehavior.onChatMessage()` - Triggers AI response

## Data Flow: Streaming Response

```
1. Player sends message → Behavior.onChatMessage()
2. Behavior gets bot config (includes aiProviderRef: "lmstudio-local")
3. Behavior calls AIService.generateBotResponseStream(..., aiProviderRef)
4. AIService fetches provider credentials using aiProviderRef (cached if available)
5. AIService streams from AI provider:
   - Chunk 1: "Hello"
   - Chunk 2: " there"
   - Chunk 3: "!"
   - Done: { tokensUsed: 3 }
6. Behavior processes chunks:
   - Accumulates full message (WorkAdventure chat requires complete messages)
   - Handles thinking tokens (logs for debugging)
7. Behavior sends complete message via WebSocket (sendChatMessage)
8. Behavior stores in ConversationMemory
9. Behavior tracks usage to Admin API
```

**Note:** WorkAdventure's chat system doesn't support incremental updates, so we accumulate chunks and send the complete message when done. This still benefits from streaming (lower memory, faster processing).

## Security Model

### Service Token

Bot server uses `BOT_SERVICE_TOKEN` (not admin token) with scoped permissions:
- ✅ Read bot configurations
- ✅ Read AI provider credentials
- ✅ Write AI usage tracking
- ❌ No access to user data
- ❌ No access to admin functions

### Credential Management

1. **Storage**: Credentials encrypted in Admin API database
2. **Transmission**: HTTPS only, never logged
3. **Caching**: Short TTL (1 hour), memory-only
4. **Rotation**: Admin can rotate credentials, bot server fetches new ones

### Network Security

- All communication over HTTPS
- Internal network for Admin API ↔ Bot Server
- Bot Server ↔ AI Providers (external, but encrypted)

## Scalability Considerations

### Concurrent Streams

- Each bot conversation = 1 stream
- 1000 bots = 1000 concurrent streams (if all chatting)
- Memory per stream: ~1KB buffer
- Total memory: ~1MB for 1000 streams

### Credential Caching

- Cache credentials per provider (not per bot)
- 10 providers × 1KB = 10KB cached
- Reduces Admin API load significantly

### Usage Tracking

- Batch usage tracking (don't track every chunk)
- Track after stream completes
- Async tracking (don't block response)

## Error Handling

### Provider Errors

- **Network errors**: Retry with exponential backoff
- **Rate limits**: Queue requests, retry later
- **Invalid credentials**: Clear cache, refetch from Admin API
- **Provider down**: Fallback message to user

### Fallback Behavior

If AI generation fails:
1. Log error with full context
2. Send friendly fallback message to user
3. Track error in usage metrics
4. Continue bot operation (don't crash)

## Future Enhancements

1. **Incremental Updates**: Send chunks as they arrive (not just final message)
2. **Thinking Models**: Display reasoning/thinking tokens in UI
3. **Multi-Provider**: Fallback to different provider if primary fails
4. **Cost Optimization**: Route to cheaper providers for simple queries
5. **Response Caching**: Cache common responses to reduce API calls

