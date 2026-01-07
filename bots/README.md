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
- **Patrol**: Follow predefined routes with smart engagement
  - Only engages when players actively move into proximity
  - Walks through idle players without triggering bubbles
  - Skips waypoint pauses if players nearby
- **Social**: Actively seek conversations with users
  - Smart conversation management with memory
  - Respects player status and cooldowns
  - Wanders without stopping on idle players
- **Custom**: Extensible behavior system
- **Assigned Spaces**: Bots can be assigned to specific areas and will return after conversations
- **Ghost Mode**: All bots can walk through idle players without engaging

### 4. Smart Conversation Management
- **Status Awareness**: Respect player availability status
- **Anti-Spam**: Prevent multiple bots from targeting same player
- **Conversation History**: Track who bot has talked to
- **Busy Detection**: Detect when players are in conversations
- **Auto-Return**: Bots automatically return to assigned space after conversations end
- **Idle Player Detection**: Bots only engage when players actively move into proximity
- **Ghost Mode**: Bots walk through idle players without triggering UI changes

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

## Documentation

See [docs/README.md](./docs/README.md) for organized documentation.

**Quick Links:**
- [Quick Start Guide](./docs/getting-started/QUICK_START.md) - Get started quickly
- [Implementation Plan](./docs/getting-started/IMPLEMENTATION_PLAN.md) - Step-by-step roadmap
- [Architecture Overview](./docs/architecture/ARCHITECTURE.md) - System design
- [Horizontal Scaling](./docs/scaling/HORIZONTAL_SCALING.md) - Multi-server setup
- [Admin API Integration](./docs/admin-api/ADMIN_API_INTEGRATION.md) - Admin API guide
- [Security Guide](./docs/security/SECURITY.md) - Security best practices

## Current Status

### ✅ Production Ready Features
- **Core Bot System**: Full WebSocket client with state management
- **Behavior System**: Idle, Patrol, and Social behaviors fully implemented
- **Bot Editor UI**: Complete visual editor integrated into map editor
- **Engagement System**: Smart proximity detection and engagement logic
- **Viewport System**: Dynamic viewport for accurate player detection
- **Room Management**: On-demand spawning and automatic cleanup
- **Admin API Integration**: Configuration tracking and usage metrics

### 🚧 Next Major Milestone: AI Integration
The bot system is ready for AI provider integration. Infrastructure is in place:
- Conversation memory system
- Chat message handling
- Context management
- Provider interface ready

**Next Steps:**
1. Implement `AIProvider` interface
2. Create `LMStudioProvider` for local LLM
3. Integrate with conversation memory
4. Add response generation

See [STATUS.md](./STATUS.md) for detailed status and roadmap.

## Getting Started

1. **Read the [Quick Start Guide](./docs/getting-started/QUICK_START.md)** - Get up and running quickly
2. **Follow the [Implementation Plan](./docs/getting-started/IMPLEMENTATION_PLAN.md)** - Step-by-step roadmap
3. **Review the [Extension Module Guide](./docs/getting-started/EXTENSION_MODULE_GUIDE.md)** - How to build the extension

## Architecture Overview

The bot system is built as an **independent extension**:

- **Extension Module**: Lives in `play/src/front/external-modules/bots/` (UI injection)
- **Bot Server**: Lives in `bots/server/` (standalone service)
- **Bot Clients**: Live in `bots/client/` (WebSocket clients)
- **Behaviors**: Live in `bots/behaviors/` (behavior system)

Only the extension module UI code lives in WorkAdventure's directory structure. All other code (server, client, behaviors) remains independent in the `bots/` directory.

See [Architecture Overview](./docs/architecture/ARCHITECTURE.md) for detailed implementation details.

## Deployment

The bot server is deployed as a standalone Docker service using `docker-compose.bots.yaml`:

```bash
# Start bot server alongside WorkAdventure
docker-compose -f docker-compose.yaml -f docker-compose.bots.yaml up
```

**Key Components:**
- **Bot Server**: REST API server for bot management (port 3001)
- **Bot Manager**: Orchestrates bot lifecycle and spawning
- **Bot Registry**: Redis-based registry for horizontal scaling
- **Health Check**: `/health` endpoint for monitoring

**Configuration:**
- Environment variables for Admin API, Redis, and WorkAdventure URLs
- Traefik integration for reverse proxy routing (accessible at `http://bot-server.workadventure.localhost`)
- Health checks for container orchestration

**Hostname Setup:**
The bot server is accessible via Traefik at `http://bot-server.workadventure.localhost`. You need to add this hostname to your hosts file:

**Linux / macOS:**
Edit `/etc/hosts` and add:
```
127.0.0.1 bot-server.workadventure.localhost
```

**Windows:**
Edit `C:\Windows\System32\drivers\etc\hosts` (requires administrator privileges) and add:
```
127.0.0.1 bot-server.workadventure.localhost
```

Note: On Windows, you may need to run your text editor as Administrator to edit the hosts file.

See [Quick Start Guide](./docs/getting-started/QUICK_START.md) for deployment instructions and [Architecture](./docs/architecture/ARCHITECTURE.md) for deployment architecture details.

