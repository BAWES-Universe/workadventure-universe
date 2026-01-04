# Data Storage & Manipulation

## Overview

The bot system uses a hybrid storage approach combining in-memory runtime state, persistent configuration storage, and external database tracking. This document explains where data is stored and how it's manipulated.

## Storage Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Persistent Storage                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ WAM Files    │  │ Admin API    │  │ Map Storage   │      │
│  │ (Planned)    │  │ (Database)   │  │ (Disk/S3)     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Runtime Storage (In-Memory)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ BotClient    │  │ BotRegistry  │  │ UsageTracker │      │
│  │ Instances    │  │ (Planned)    │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## 1. Bot Configuration Storage

### WAM Files (Planned - Primary Storage)

**Location:** Map Storage Service (disk or S3)

**Format:** JSON in WAM file structure

**Path:** Same as map files (e.g., `/maps/room.wam`)

**Structure (Public Data Only):**
```json
{
  "version": "1.0.0",
  "mapUrl": "https://play.workadventu.re/@/org/world/room",
  "entities": { ... },
  "areas": [ ... ],
  "bots": {
    "bot-1": {
      "botId": "bot-1",
      "name": "Helper Bot",
      "position": { "x": 100, "y": 100 },
      "viewport": { "top": 0, "bottom": 1000, "left": 0, "right": 1000 },
      "characterTextureIds": ["texture-1"],
      "companionTextureId": null,
      "behaviorType": "social",
      "behaviorConfig": {
        "conversationRadius": 300,
        "wanderRadius": 500,
        "wanderCenter": { "x": 500, "y": 500 },
        "assignedSpace": {
          "center": { "x": 500, "y": 500 },
          "radius": 200
        }
      },
      "aiProvider": "lmstudio",  // Provider name only
      "aiConfigRef": "bot-1-ai-config"  // Reference to fetch from Admin API
    }
  }
}
```

**⚠️ Security Note:** WAM files are publicly accessible. Sensitive data (API keys, chat instructions, movement instructions) must be stored in Admin API, not in WAM files. See [SECURITY.md](./SECURITY.md) for details.

**Manipulation:**
- Created/edited via Bot Editor UI
- Saved to WAM file via map-storage service
- Auto-saved every 15 seconds (same as entities)
- Loaded when map loads
- Spawned by BotManager service

**Backend:**
- Disk: `STORAGE_DIRECTORY` environment variable (default: `/maps`)
- S3: If `AWS_BUCKET` configured, uses S3-compatible storage

### Admin API (Primary Storage for Sensitive Data)

**Location:** External Admin API database

**Purpose:** 
- **Secure storage** for sensitive bot configuration
- Centralized tracking across all maps
- Analytics and reporting
- User management
- Backup/restore capability

**Sensitive Data Stored:**
- AI provider credentials (API keys, tokens, endpoints)
- Chat instructions (system prompts for AI behavior)
- Movement instructions (behavioral rules for who to approach)
- Private configuration

**Format:** REST API calls to Admin API

**Endpoints:**
- `POST /api/bots/configuration` - Save bot config (including sensitive data)
- `GET /api/bots/configuration/:botId` - Get bot config (with sensitive data if authenticated)
- `GET /api/bots/configuration` - List bots (with filters, sensitive data excluded)
- `DELETE /api/bots/configuration/:botId` - Delete bot config

**Synchronization:**
- Public config stored in WAM file
- Sensitive config stored in Admin API
- Both linked by `botId`
- Bot editor fetches both and combines for display
- Bot server fetches sensitive config at initialization

**Security:**
- Protected by authentication (Bearer token)
- User permissions enforced
- Sensitive data never exposed in public files

## 2. Runtime State (In-Memory)

### BotClient Instances

**Location:** Bot server process memory

**Data Structures:**
```typescript
class BotClient {
  private config: BotConfig;              // Bot configuration
  private state: BotState;                // Position, direction, moving
  private behavior: BaseBehavior;         // Behavior instance
  private spaces: Map<string, spaceUserId>; // Active spaces
  private players: Map<number, PlayerInfo>; // Tracked players
  private pendingQueries: Map<number, Promise>; // Async operations
}
```

**Memory Usage:** ~15-35 KB per bot

**Manipulation:**
- Updated every frame (60fps) via `bot.update(deltaTime)`
- Modified by behavior logic
- Sent to server via WebSocket messages
- Cleared when bot disconnects

### BotRegistry (Planned)

**Location:** Bot server process memory

**Purpose:** Track active bots and coordinate conversations

**Data Structures:**
```typescript
class BotRegistry {
  private bots: Map<string, BotClient>;           // botId -> BotClient
  private conversations: Map<string, ConversationState>; // Track active conversations
  private playerTargets: Map<number, Set<string>>; // playerId -> Set<botId>
}
```

**Manipulation:**
- Updated when bots spawn/despawn
- Updated during conversations
- Used to prevent spam (multiple bots targeting same player)

## 3. Usage Metrics (Hybrid Storage)

### In-Memory (BotUsageTracker)

**Location:** Bot server process memory

**Data Structures:**
```typescript
class BotUsageTracker {
  private metrics: Map<string, BotUsageMetrics>;
  private conversationCounts: Map<string, number>;
  private messageCounts: Map<string, number>;
  private activeTime: Map<string, number>;
  private startTimes: Map<string, Date>;
}
```

**Manipulation:**
- Updated in real-time as bots interact
- Aggregated in memory
- Flushed to Admin API periodically (every 60 seconds)

### Persistent Storage (Admin API Database)

**Location:** External Admin API database

**Tables:**
- `bots_usage` - Aggregated metrics
- `bots_conversations` - Individual conversation events
- `bots_messages` - Individual message events

**Manipulation:**
- Written via Admin API endpoints
- Queried for analytics and reporting
- Retained for historical analysis

## Data Flow

### Configuration Flow

```
1. User creates bot in Bot Editor UI
   ↓
2. Bot config saved to WAM file (via map-storage)
   ↓
3. WAM file saved to disk/S3
   ↓
4. Config also synced to Admin API (for tracking)
   ↓
5. On map load, BotManager reads WAM file
   ↓
6. BotManager spawns BotClient instances
   ↓
7. BotClient connects via WebSocket
```

### Runtime Flow

```
1. BotClient instance created in memory
   ↓
2. Behavior updates state every frame (60fps)
   ↓
3. State changes sent via WebSocket to game server
   ↓
4. Usage metrics tracked in memory (BotUsageTracker)
   ↓
5. Metrics flushed to Admin API periodically (every 60s)
   ↓
6. Admin API stores in database
```

### Conversation Flow

```
1. Bot detects nearby player
   ↓
2. BotRegistry checks if player is available
   ↓
3. Bot joins space (conversation bubble)
   ↓
4. Conversation tracked in memory
   ↓
5. Conversation event sent to Admin API
   ↓
6. Admin API stores in database
```

## Storage Backends

### Map Storage Service

**Disk Backend:**
- Environment: `STORAGE_DIRECTORY` (default: `/maps`)
- File system: Direct file I/O
- Suitable for: Single server, development

**S3 Backend:**
- Environment: `AWS_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Compatible with: AWS S3, MinIO, DigitalOcean Spaces, etc.
- Suitable for: Production, multi-server, cloud deployments

### Admin API Database

**Requirements:**
- PostgreSQL, MySQL, or similar relational database
- JSON/JSONB support for flexible config storage
- High write throughput for metrics
- Query capabilities for analytics

## Data Consistency

### WAM Files vs Admin API

**WAM Files:**
- Source of truth for map-specific bots
- Loaded when map loads
- Edited via map editor

**Admin API:**
- Source of truth for cross-map queries
- Used for analytics and reporting
- User management and permissions

**Synchronization Strategy:**
- Write to WAM file first (primary)
- Sync to Admin API asynchronously (secondary)
- Admin API can rebuild from WAM files if needed
- Conflict resolution: WAM file takes precedence

## Data Retention

### Configuration Data
- **WAM Files**: Retained indefinitely (part of map)
- **Admin API**: Retained indefinitely (for analytics)

### Usage Metrics
- **In-Memory**: Cleared when bot disconnects
- **Admin API**: Retained per your retention policy
  - Recommended: 90 days for detailed metrics
  - Aggregated metrics: Indefinitely

### Runtime State
- **In-Memory**: Cleared when bot disconnects
- **Not persisted**: Recreated from WAM file on map load

## Backup & Recovery

### WAM Files
- Backed up as part of map backup
- Can be restored from version control
- S3 versioning enabled (if using S3)

### Admin API
- Standard database backup procedures
- Point-in-time recovery recommended
- Export capability for migration

## Security Considerations

1. **WAM Files**: Publicly accessible - only non-sensitive data
2. **Admin API**: Protected by API token authentication - stores all sensitive data
3. **Runtime State**: In-memory only, cleared on disconnect
4. **Usage Metrics**: Sanitized before storage (no PII)
5. **Sensitive Data**: AI credentials, chat instructions, movement instructions stored only in Admin API

**⚠️ Critical**: WAM files are publicly accessible via HTTP. Never store sensitive data (API keys, tokens, chat instructions, movement instructions) in WAM files. See [SECURITY.md](./SECURITY.md) for detailed security guidelines.

