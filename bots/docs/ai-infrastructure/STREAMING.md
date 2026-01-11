# Streaming Implementation

## Overview

Streaming allows bots to send AI responses token-by-token as they're generated, providing better UX and supporting thinking models.

## Why Streaming?

### Benefits

1. **Lower Perceived Latency**
   - Non-streaming: User waits 3s for full response
   - Streaming: User sees first token in 0.1s

2. **Better UX**
   - Users see response being generated
   - Feels more interactive and natural

3. **Memory Efficiency**
   - Process chunks instead of buffering full response
   - 1000 streams × 1KB buffer = 1MB (vs 10MB non-streaming)

4. **Thinking Models Support**
   - Can display reasoning/thinking tokens
   - Better transparency for complex models

## Streaming Protocol

### AI Provider → Bot Server

**Format:** Server-Sent Events (SSE) or similar

**Example (LMStudio):**
```
data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" there"}}]}

data: {"choices":[{"delta":{"content":"!"}}]}

data: {"usage":{"total_tokens":10}}

data: [DONE]
```

### Bot Server Processing

```typescript
interface AIStreamChunk {
    content: string;        // Token content
    done: boolean;          // Is stream complete?
    metadata?: {
        tokensUsed?: number;
        thinking?: string;  // For thinking models
    };
}
```

### Current Implementation: Accumulate and Send

**Current approach:** Accumulate chunks, send complete message when done.

**Why?** WorkAdventure's chat system (`spaceMessage`) only accepts complete message strings. There's no native support for incremental updates.

```typescript
let fullMessage = '';

for await (const chunk of stream) {
    if (chunk.content) {
        fullMessage += chunk.content;
    }
    
    if (chunk.done) {
        // Send complete message
        bot.sendChatMessage(spaceName, fullMessage);
    }
}
```

**Pros:**
- ✅ Simple implementation
- ✅ Works with current WorkAdventure chat system
- ✅ No upstream changes needed
- ✅ Still benefits from streaming (lower memory, faster processing)
- ✅ Handles thinking tokens (can log/store them)

**Cons:**
- ❌ User doesn't see tokens appearing in real-time
- ❌ Still waits for full response before seeing message

**Note:** Even though users don't see streaming, we still benefit:
- Lower memory usage (process chunks, don't buffer full response)
- Faster processing (can start sending as soon as done)
- Better error handling (can detect issues mid-stream)

### Future: Incremental Updates

**Future approach:** Send chunks as they arrive.

**Requirements:**
- WorkAdventure chat system needs to support incremental updates
- Or use custom message format

```typescript
for await (const chunk of stream) {
    if (chunk.content) {
        // Send incremental update
        bot.sendChatMessageIncremental(spaceName, chunk.content);
    }
}
```

## Provider Support

### LMStudio

**Status:** ✅ Supports streaming

**Implementation:**
```typescript
// Enable streaming
body: JSON.stringify({
    stream: true,
    // ... other params
})

// Parse SSE stream
const reader = response.body.getReader();
// ... parse chunks
```

### OpenAI

**Status:** ✅ Supports streaming

**Implementation:**
```typescript
// Similar to LMStudio
body: JSON.stringify({
    stream: true,
    // ... other params
})
```

### Anthropic

**Status:** ✅ Supports streaming (via SSE)

**Implementation:**
```typescript
// Uses SSE format
// Similar parsing logic
```

## Thinking Models

Some models (like o1, Claude Sonnet 4.5) output "thinking" tokens that show reasoning.

### Handling Thinking Tokens

```typescript
interface AIStreamChunk {
    content: string;
    done: boolean;
    metadata?: {
        thinking?: string;  // Reasoning/thinking content
        tokensUsed?: number;
    };
}
```

### Display Options

1. **Log Only (Current)**
   ```typescript
   if (chunk.metadata?.thinking) {
       console.log(`[AI Thinking] ${chunk.metadata.thinking}`);
   }
   ```

2. **UI Display (Future)**
   - Show thinking in a collapsible section
   - Or as a tooltip
   - Or in debug panel

3. **Hidden**
   - Store in memory for context
   - Don't display to user

## Error Handling in Streams

### Network Errors

```typescript
try {
    for await (const chunk of stream) {
        // Process chunk
    }
} catch (error) {
    if (error instanceof NetworkError) {
        // Retry stream
        return this.generateBotResponseStream(...);
    }
    throw error;
}
```

### Incomplete Streams

```typescript
let timeout = setTimeout(() => {
    throw new Error('Stream timeout');
}, 30000); // 30s timeout

try {
    for await (const chunk of stream) {
        clearTimeout(timeout);
        timeout = setTimeout(...); // Reset timeout
        
        // Process chunk
    }
} finally {
    clearTimeout(timeout);
}
```

## Performance Considerations

### Concurrent Streams

**Memory:**
- Each stream: ~1KB buffer
- 1000 streams: ~1MB total

**CPU:**
- Parsing chunks is lightweight
- Main cost is network I/O

**Network:**
- Many small chunks vs few large responses
- Similar total bandwidth
- Better perceived performance

### Batching

**Option:** Batch multiple chunks before sending

```typescript
let buffer = '';
const BATCH_SIZE = 10; // Send every 10 chunks

for await (const chunk of stream) {
    buffer += chunk.content;
    
    if (buffer.length >= BATCH_SIZE || chunk.done) {
        bot.sendChatMessage(spaceName, buffer);
        buffer = '';
    }
}
```

**Trade-off:**
- Lower network overhead
- Slightly higher latency
- Simpler implementation

## Testing Streaming

### Unit Tests

```typescript
describe('AIService Streaming', () => {
    it('should stream chunks correctly', async () => {
        const chunks: string[] = [];
        
        for await (const chunk of aiService.generateBotResponseStream(...)) {
            if (chunk.content) {
                chunks.push(chunk.content);
            }
        }
        
        expect(chunks.join('')).toBe('Hello there!');
    });
});
```

### Integration Tests

```typescript
it('should handle streaming from LMStudio', async () => {
    const response = await testLMStudioStreaming();
    expect(response).toContain('Hello');
});
```

### Load Tests

```typescript
it('should handle 100 concurrent streams', async () => {
    const streams = Array(100).fill(null).map(() => 
        aiService.generateBotResponseStream(...)
    );
    
    await Promise.all(streams.map(async stream => {
        for await (const chunk of stream) {
            // Process
        }
    }));
});
```

## Future Enhancements

1. **Incremental UI Updates**
   - Send chunks as they arrive
   - Update chat in real-time

2. **Thinking Display**
   - Show reasoning in UI
   - Collapsible thinking section

3. **Stream Compression**
   - Compress chunks for lower bandwidth
   - Decompress on client

4. **Stream Prioritization**
   - Prioritize active conversations
   - Queue low-priority streams

