# Bot System Architecture

## Overview

The WorkAdventure bot system is designed to be scalable, maintainable, and extensible. It follows a modular architecture that separates concerns between client connections, behavior logic, and AI integration.

## Core Components

### 1. Bot Client (`client/BotClient.ts`)

The bot client is a headless WebSocket client that connects to WorkAdventure using the same protocol as browser clients.

**Key Responsibilities:**
- Establish and maintain WebSocket connection
- Handle Protocol Buffer message encoding/decoding
- Manage bot state (position, status, etc.)
- Route messages to behavior system
- Handle space joining/leaving for conversations

**Connection Flow:**
```
1. Connect to ws://pusher/ws/room with bot credentials
2. Receive RoomJoinedMessage with initial state
3. Subscribe to user movements, groups, spaces
4. Execute behavior logic
5. Send UserMovesMessage, chat messages, etc.
```

### 2. Bot Manager (`server/BotManager.ts`)

Manages the lifecycle of bot instances across the system.

**Key Responsibilities:**
- Create/destroy bot instances
- Load bot configurations from database/storage
- Coordinate bot spawning on map load
- Handle bot persistence
- Monitor bot health

**Scalability Considerations:**
- Use connection pooling for WebSocket connections
- Implement bot instance limits per server
- Support distributed execution (multiple bot servers)
- Queue system for bot creation during high load

### 3. Bot Registry (`server/BotRegistry.ts`)

Tracks active bot instances and their states.

**Key Responsibilities:**
- Maintain map of active bots (botId -> BotInstance)
- Track bot positions and statuses
- Coordinate conversation management
- Prevent bot conflicts (multiple bots targeting same player)

**Conversation Management:**
```typescript
interface ConversationState {
  botId: string;
  playerId: number;
  spaceName: string;
  startTime: Date;
  lastMessageTime: Date;
}

class BotRegistry {
  private conversations: Map<string, ConversationState> = new Map();
  
  canBotStartConversation(botId: string, playerId: number): boolean {
    // Check if player is already in conversation
    // Check if player status allows conversation
    // Check if bot has talked to this player recently
    // Check if too many bots are targeting this player
  }
}
```

### 4. Behavior System (`behaviors/`)

Modular behavior system that defines bot actions.

**Base Behavior Interface:**
```typescript
abstract class BaseBehavior {
  abstract update(bot: BotClient, deltaTime: number): void;
  abstract onPlayerApproached(bot: BotClient, playerId: number): void;
  abstract onSpaceJoined(bot: BotClient, spaceName: string): void;
  abstract onSpaceLeft(bot: BotClient, spaceName: string): void;
}
```

**Behavior Types:**

1. **IdleBehavior**: Stands in place, responds to interactions
2. **PatrolBehavior**: Follows waypoints or routes
3. **SocialBehavior**: Actively seeks conversations
   - Tracks conversation history
   - Avoids players already talked to recently
   - Respects player status (busy, away, etc.)
   - Implements cooldown periods

### 5. Bot Editor (`editor/`)

Frontend UI for creating and configuring bots.

**Components:**
- `BotEditor.svelte`: Main editor sidebar (similar to EntityEditor)
- `BotPropertiesEditor.svelte`: Basic bot properties (name, appearance, position)
- `BotBehaviorEditor.svelte`: Behavior configuration
- `BotAIConfigEditor.svelte`: AI provider settings

**Integration Points:**
- Add `BotEditor` tool to `EditorToolName` enum
- Add bot editor button to `MapEditorSideBar`
- Store bot data in map WAM file (similar to entities)

## Data Flow

### Bot Creation Flow
```
1. User opens Bot Editor sidebar
2. User clicks "Add Bot" button
3. User configures bot (name, position, behavior, AI)
4. Bot data saved to map WAM file
5. On map load, BotManager spawns bot instances
6. Each bot connects via WebSocket
7. Bot executes assigned behavior
```

### Conversation Flow
```
1. Bot (SocialBehavior) detects nearby player
2. Bot checks BotRegistry.canBotStartConversation()
3. If allowed, bot moves closer to player
4. Backend creates group (proximity detection)
5. Backend sends joinSpaceRequestMessage
6. Bot joins space via emitJoinSpace()
7. Bot sends chat message or waits for player
8. Conversation continues via space messages
9. When players separate, bot leaves space
```

## Scalability Design

> **Note**: For detailed scalability information, resource usage, and optimization strategies, see [SCALABILITY.md](./SCALABILITY.md).

### Connection Management
- **Connection Pool**: Reuse WebSocket connections when possible
- **Batch Operations**: Group multiple bot operations
- **Update Frequency Optimization**: Reduce update rate for distant bots (they remain visible)

### Resource Limits
```typescript
interface BotLimits {
  maxBotsPerServer: number;        // e.g., 1000
  maxBotsPerMap: number;          // e.g., 100
  maxConcurrentConversations: number; // e.g., 10 per bot
  botSpawnRate: number;           // bots/second
}
```

### Resource Usage
- **Memory**: ~15-35 KB per bot (memory is NOT the bottleneck)
- **CPU**: Main constraint (60fps update loop)
- **Network**: ~300-600 bytes/sec per bot
- **Recommended limits**: 50 bots/user, 100 bots/map, 1,000 bots/server

### Distributed Execution
- Support multiple bot server instances
- Use message queue (Redis/RabbitMQ) for coordination
- Bot registry shared across instances
- Load balancing for bot distribution

### Optimization Strategies
- **Spatial Partitioning**: Prioritize updates for bots in active areas (all bots remain visible)
- **Update Frequency Optimization**: Reduce update rate for distant bots (they remain visible)
- **Configuration Lazy Loading**: Load bot configs from database only when needed
- **Message Batching**: Batch WebSocket messages

## AI Integration

### LMStudio Integration
```typescript
class LMStudioProvider implements AIProvider {
  async generateResponse(context: ConversationContext): Promise<string> {
    // Call LMStudio API
    // Handle streaming responses
    // Return bot response
  }
}
```

### Ultravox Integration (Future)
```typescript
class UltravoxProvider implements AIProvider {
  async generateVoiceResponse(audio: ArrayBuffer): Promise<ArrayBuffer> {
    // Send audio to Ultravox
    // Receive voice response
    // Return audio for WebRTC
  }
}
```

## Security Considerations

1. **Authentication**: Bots use special bot tokens**
2. **Rate Limiting**: Prevent bot spam
3. **Content Filtering**: Filter bot responses
4. **Permission System**: Only authenticated users can create bots
5. **Bot Validation**: Validate bot behavior before execution

## Performance Optimization

1. **Spatial Partitioning**: Only update bots in active areas (they remain visible)
2. **Update Frequency Optimization**: Reduce update rate for distant bots (60fps → 30fps → 10fps)
3. **Behavior Caching**: Cache behavior decisions
4. **Message Batching**: Batch WebSocket messages
5. **Async Processing**: Non-blocking AI calls

**Important**: Bots are always visible to players. Optimization reduces update frequency and AI processing, not visibility.

