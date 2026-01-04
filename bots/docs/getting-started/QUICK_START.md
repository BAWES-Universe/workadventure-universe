# Quick Start Guide

## Overview

This guide will help you get started with the WorkAdventure bot system. The system is designed to be scalable, allowing thousands of bots to interact naturally with players.

## Current Status

✅ **Completed:**
- Core bot client (WebSocket-based)
- Behavior system (Idle, Patrol, Social)
- Architecture documentation
- Base infrastructure

🚧 **In Progress:**
- Bot Editor UI (sidebar)
- Backend bot management
- AI integration (LMStudio)

## Architecture Summary

### Bot Client
The `BotClient` class connects to WorkAdventure via WebSocket using the same protocol as browser clients. This allows bots to:
- Move around the map
- Join conversation bubbles
- Send/receive chat messages
- Interact with players naturally

### Behavior System
Behaviors define how bots act:

1. **IdleBehavior**: Stands in place, responds to interactions
2. **PatrolBehavior**: Follows waypoints/routes
3. **SocialBehavior**: Actively seeks conversations with players

### Smart Conversation Management
The SocialBehavior includes logic to:
- Track conversation history
- Respect player status (busy, away, etc.)
- Prevent multiple bots from targeting the same player
- Implement cooldowns between conversations

## Example Usage

### Creating a Simple Idle Bot

```typescript
import { BotClient } from './client/BotClient';
import { IdleBehavior } from './behaviors/IdleBehavior';

const bot = new BotClient({
    botId: 'bot-1',
    name: 'Helper Bot',
    roomUrl: 'https://play.workadventu.re/@/org/world/room',
    pusherUrl: 'https://pusher.workadventu.re',
    position: { x: 100, y: 100 },
    viewport: { top: 0, bottom: 1000, left: 0, right: 1000 },
    characterTextureIds: ['texture-1'],
});

const behavior = new IdleBehavior({
    type: 'idle',
    position: { x: 100, y: 100 },
    responseRadius: 200,
    greetingMessages: ['Hello!', 'Hi there!', 'Welcome!'],
});

bot.setBehavior(behavior);
await bot.connect();

// Update loop (60fps)
setInterval(() => {
    bot.update(16.67); // ~16.67ms per frame
}, 16.67);
```

### Creating a Social Bot

```typescript
import { SocialBehavior } from './behaviors/SocialBehavior';

const socialBot = new BotClient({ /* ... */ });

const behavior = new SocialBehavior({
    type: 'social',
    conversationRadius: 300,
    minTimeBetweenConversations: 60000, // 1 minute
    maxConversationDuration: 300000, // 5 minutes
    conversationHistorySize: 50,
    respectPlayerStatus: true,
    maxConcurrentConversations: 3,
    conversationTopics: ['technology', 'gaming', 'AI'],
    wanderRadius: 500,
    wanderCenter: { x: 500, y: 500 },
    wanderSpeed: 100,
    approachDistance: 50,
});

socialBot.setBehavior(behavior);
await socialBot.connect();
```

### Creating a Patrol Bot

```typescript
import { PatrolBehavior } from './behaviors/PatrolBehavior';

const patrolBot = new BotClient({ /* ... */ });

const behavior = new PatrolBehavior({
    type: 'patrol',
    waypoints: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
    ],
    loop: true,
    pauseAtWaypoints: 2, // seconds
    speed: 150,
    respondToPlayers: true,
    responseRadius: 150,
});

patrolBot.setBehavior(behavior);
await patrolBot.connect();
```

## Next Steps

1. **Bot Editor UI**: Create the sidebar interface for adding bots to maps
2. **Backend Integration**: Implement bot persistence and spawning
3. **AI Integration**: Connect LMStudio for bot responses
4. **Testing**: Test with multiple bots and real players

## File Structure

```
bots/
├── client/              # Bot client implementation
│   ├── BotClient.ts     # Main WebSocket client
│   └── BotState.ts      # State management
├── behaviors/           # Behavior implementations
│   ├── BaseBehavior.ts
│   ├── IdleBehavior.ts
│   ├── SocialBehavior.ts
│   └── PatrolBehavior.ts
├── server/              # Backend (TODO)
├── editor/              # UI components (TODO)
└── docs/                # Documentation
```

## Integration Points

### With WorkAdventure

The bot system integrates with WorkAdventure at these points:

1. **WebSocket Connection**: Uses same protocol as browser clients
2. **Map Editor**: Bot editor will be added as a tool (similar to Entity Editor)
3. **Map Storage**: Bot configurations stored in WAM files
4. **Backend**: Bot spawning and management via backend services

### With AI Providers

- **LMStudio**: Initial support for local LLM
- **Ultravox**: Voice AI (planned)
- **GPT Voice**: Alternative voice AI (planned)

## Scalability

The bot system is designed to scale efficiently:
- **Memory**: ~15-35 KB per bot
- **CPU**: Main constraint (60fps update loop)
- **Network**: ~300-600 bytes/sec per bot
- **Recommended limits**: 50 bots/user, 100 bots/map, 1,000 bots/server

For detailed scalability information, see [SCALABILITY.md](./SCALABILITY.md).

## Docker Compose Setup

The bot server can be deployed using Docker Compose:

```bash
# Start bot server alongside WorkAdventure
docker-compose -f docker-compose.yaml -f docker-compose.bots.yaml up
```

**Environment Variables:**
- `ADMIN_API_URL`: URL of your Admin API
- `ADMIN_API_TOKEN`: Bearer token for Admin API authentication
- `PUSHER_URL`: WorkAdventure pusher URL
- `REDIS_HOST`: Redis hostname (default: `redis`)
- `REDIS_PORT`: Redis port (default: `6379`)
- `REDIS_DB_NUMBER`: Redis database number for bots (default: `1`)
- `BOT_SERVER_PORT`: Bot server REST API port (default: `3001`)
- `BOT_SERVER_ID`: Unique server identifier for horizontal scaling

**Health Check:**
The bot server exposes a health check endpoint at `/health`:
```bash
curl http://localhost:3001/health
```

## Authentication Requirements

- **Bot Editor**: Only authenticated users can access the bot editor tool in the map editor sidebar
- **Bot Interaction**: Unauthenticated users can still interact with bots (chat, proximity, etc.)
- The extension module checks `localUserStore.isLogged()` before showing the bot editor tool

## Questions?

See the [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) for detailed technical information.

