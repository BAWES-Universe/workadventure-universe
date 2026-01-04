# WorkAdventure Bot System

A scalable, intelligent bot system for WorkAdventure that allows authenticated users to create and manage AI-powered bots on maps.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Bot Management Layer                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Bot Editor   │  │ Bot Manager  │  │ Bot Registry │       │
│  │ (UI Sidebar) │  │  (Backend)   │  │  (Runtime)   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Bot Client Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ WebSocket    │  │ Behavior     │  │ AI Provider   │     │
│  │ Connection   │  │ Engine       │  │ (LMStudio/    │     │
│  │              │  │              │  │  Ultravox)    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    WorkAdventure Game                        │
│              (WebSocket Protocol Buffers)                     │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
bots/
├── client/              # Bot client implementation (WebSocket)
│   ├── BotClient.ts     # Main bot WebSocket client
│   ├── BotState.ts      # Bot state management
│   └── BotConnection.ts # Connection handling
├── server/              # Backend bot management
│   ├── BotManager.ts    # Bot lifecycle management
│   ├── BotRegistry.ts   # Active bot registry
│   └── BotAPI.ts        # REST API endpoints
├── editor/              # Frontend bot editor UI
│   ├── BotEditor.svelte # Main editor component
│   ├── BotPropertiesEditor.svelte # Bot configuration
│   └── BotBehaviorEditor.svelte # Behavior configuration
├── behaviors/           # Bot behavior implementations
│   ├── BaseBehavior.ts  # Base behavior class
│   ├── IdleBehavior.ts  # Standing in place
│   ├── PatrolBehavior.ts # Routing/patrolling
│   └── SocialBehavior.ts # Social butterfly
└── docs/                # Documentation
    ├── ARCHITECTURE.md  # Detailed architecture
    ├── API.md          # API documentation
    └── BEHAVIORS.md    # Behavior system docs
```

## Key Features

### 1. Scalability
- **Connection Pooling**: Manage thousands of WebSocket connections efficiently
- **Resource Management**: Smart allocation of bot instances
- **Horizontal Scaling**: Support for distributed bot execution

### 2. Bot Editor UI
- **Sidebar Integration**: Similar to entity editor, accessible to authenticated users
- **Visual Configuration**: Drag-and-drop bot placement on map
- **Behavior Selection**: Choose from predefined behaviors or create custom ones

### 3. Behavior System
- **Idle**: Stand in place, respond to interactions
- **Patrol**: Follow predefined routes
- **Social**: Actively seek conversations with users
- **Custom**: Extensible behavior system
- **Assigned Spaces**: Bots can be assigned to specific areas and will return after conversations

### 4. Smart Conversation Management
- **Status Awareness**: Respect player availability status
- **Anti-Spam**: Prevent multiple bots from targeting same player
- **Conversation History**: Track who bot has talked to
- **Busy Detection**: Detect when players are in conversations
- **Auto-Return**: Bots automatically return to assigned space after conversations end

### 5. AI Integration
- **LMStudio**: Initial support for local LLM
- **Ultravox**: Voice AI integration (planned)
- **GPT Voice**: Alternative voice AI (planned)
- **Extensible**: Easy to add new AI providers

### 6. Admin API Integration
- **Configuration Tracking**: Track bot configurations per room/world/universe/user
- **Usage Metrics**: Monitor bot conversations, messages, and active time
- **Analytics**: Get insights into bot performance and usage patterns
- **Centralized Management**: Manage bots across your WorkAdventure instance

## Scalability

The bot system is highly scalable, supporting thousands of bots simultaneously:
- **Memory**: ~15-35 KB per bot
- **CPU**: Main constraint (60fps update loop)
- **Network**: ~300-600 bytes/sec per bot
- **Recommended limits**: 50 bots/user, 100 bots/map, 1,000 bots/server

See [SCALABILITY.md](./docs/SCALABILITY.md) for detailed resource usage and optimization strategies.

## Getting Started

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for detailed implementation details.

