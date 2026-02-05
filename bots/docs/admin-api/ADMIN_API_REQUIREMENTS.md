# Admin API Requirements

## Overview

This document outlines what needs to be implemented in your Admin API to support the WorkAdventure bot system. The Admin API serves as the centralized backend for bot configuration management, usage tracking, and analytics.

> **Quick Reference**: See [ADMIN_API_QUICK_REFERENCE.md](./ADMIN_API_QUICK_REFERENCE.md) for a condensed version of this document.

## Required Endpoints

### 1. Bot Configuration Management

#### POST `/api/bots/configuration`

**Purpose:** Save or update a bot configuration

**Request:**
```http
POST /api/bots/configuration
Authorization: Bearer {ADMIN_API_TOKEN}
Content-Type: application/json

{
  "botId": "bot-123",
  "name": "Helper Bot",
  "roomUrl": "https://play.workadventu.re/@/org/world/room",
  "worldUrl": "https://play.workadventu.re/@/org/world",
  "universeUrl": "https://play.workadventu.re/@/org",
  "userId": "user-456",
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
  "aiProvider": "lmstudio",
  "aiConfig": {
    "model": "llama-2-7b",
    "temperature": 0.7
  },
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

**Response:**
- `200 OK` or `204 No Content` on success
- `400 Bad Request` for invalid data
- `403 Forbidden` for unauthorized access
- `500 Internal Server Error` for server errors

**Requirements:**
- Validate all required fields
- Check user permissions (can user create bots?)
- Enforce limits (max bots per user/room/world)
- Upsert logic (create if not exists, update if exists)

#### GET `/api/bots/configuration/:botId`

**Purpose:** Get a specific bot's configuration

**Request:**
```http
GET /api/bots/configuration/bot-123
Authorization: Bearer {ADMIN_API_TOKEN}
```

**Response:**
```json
{
  "botId": "bot-123",
  "name": "Helper Bot",
  "roomUrl": "https://play.workadventu.re/@/org/world/room",
  "worldUrl": "https://play.workadventu.re/@/org/world",
  "universeUrl": "https://play.workadventu.re/@/org",
  "userId": "user-456",
  "behaviorType": "social",
  "behaviorConfig": { ... },
  "aiProvider": "lmstudio",
  "aiConfig": { ... },
  "assignedSpace": { ... },
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

**Response Codes:**
- `200 OK` with bot config
- `404 Not Found` if bot doesn't exist
- `403 Forbidden` for unauthorized access

#### GET `/api/bots/configuration`

**Purpose:** List bot configurations with filters

**Query Parameters:**
- `roomUrl` (optional) - Filter by room
- `worldUrl` (optional) - Filter by world
- `universeUrl` (optional) - Filter by universe
- `userId` (optional) - Filter by user who created the bot
- `includeSensitive` (optional, default: false) - Include sensitive data
- `limit` (optional) - Max results (default: 100, max: 1000)
- `offset` (optional) - Pagination offset

**Request:**
```http
GET /api/bots/configuration?worldUrl=https://play.workadventu.re/@/org/world&limit=50
Authorization: Bearer {ADMIN_API_TOKEN}
```

**Response (includeSensitive=false):**
```json
[
  {
    "botId": "bot-123",
    "name": "Helper Bot",
    "aiProvider": "lmstudio",
    "aiConfig": null,  // Sensitive data excluded
    "chatInstructions": null,  // Sensitive data excluded
    "movementInstructions": null,  // Sensitive data excluded
    ...
  }
]
```

**Response Codes:**
- `200 OK` with array of bot configs (sensitive data excluded by default)
- `400 Bad Request` for invalid query parameters
- `403 Forbidden` for unauthorized access

**Security:**
- Sensitive data (AI config, instructions) excluded by default
- Only include if `includeSensitive=true` AND user has permissions

#### DELETE `/api/bots/configuration/:botId`

**Purpose:** Delete a bot configuration

**Request:**
```http
DELETE /api/bots/configuration/bot-123
Authorization: Bearer {ADMIN_API_TOKEN}
```

**Response:**
- `204 No Content` on success
- `404 Not Found` if bot doesn't exist
- `403 Forbidden` for unauthorized access

**Requirements:**
- Check user permissions (can user delete this bot?)
- Soft delete option (mark as deleted, don't actually delete)
- Cascade delete usage metrics (optional)

### 2. Bot Usage Metrics

#### POST `/api/bots/usage`

**Purpose:** Track or update bot usage metrics

**Request:**
```http
POST /api/bots/usage
Authorization: Bearer {ADMIN_API_TOKEN}
Content-Type: application/json

{
  "botId": "bot-123",
  "roomUrl": "https://play.workadventu.re/@/org/world/room",
  "worldUrl": "https://play.workadventu.re/@/org/world",
  "universeUrl": "https://play.workadventu.re/@/org",
  "userId": "user-456",
  "totalConversations": 42,
  "totalMessages": 150,
  "totalActiveTime": 3600000,
  "lastActiveAt": "2024-01-01T12:00:00Z",
  "conversationsByDate": [
    { "date": "2024-01-01", "count": 10 },
    { "date": "2024-01-02", "count": 12 }
  ]
}
```

**Response:**
- `200 OK` or `204 No Content` on success
- `400 Bad Request` for invalid data

**Requirements:**
- Upsert logic (update if exists, create if not)
- Handle high write volume (bots flush every 60 seconds)
- Optimize for batch updates

#### GET `/api/bots/usage`

**Purpose:** Query bot usage metrics

**Query Parameters:**
- `roomUrl` (optional) - Filter by room
- `worldUrl` (optional) - Filter by world
- `universeUrl` (optional) - Filter by universe
- `userId` (optional) - Filter by user
- `botId` (optional) - Filter by bot
- `startDate` (optional) - Start date (ISO 8601)
- `endDate` (optional) - End date (ISO 8601)
- `limit` (optional) - Max results
- `offset` (optional) - Pagination offset

**Request:**
```http
GET /api/bots/usage?worldUrl=https://play.workadventu.re/@/org/world&startDate=2024-01-01T00:00:00Z
Authorization: Bearer {ADMIN_API_TOKEN}
```

**Response:**
```json
[
  {
    "botId": "bot-123",
    "roomUrl": "...",
    "totalConversations": 42,
    "totalMessages": 150,
    "totalActiveTime": 3600000,
    "lastActiveAt": "2024-01-01T12:00:00Z",
    "conversationsByDate": [ ... ]
  }
]
```

**Requirements:**
- Efficient querying with indexes
- Support date range queries
- Aggregation capabilities

### 3. Conversation Events

#### POST `/api/bots/conversations`

**Purpose:** Track individual conversation events

**Request:**
```http
POST /api/bots/conversations
Authorization: Bearer {ADMIN_API_TOKEN}
Content-Type: application/json

{
  "botId": "bot-123",
  "playerId": 789,
  "roomUrl": "https://play.workadventu.re/@/org/world/room",
  "duration": 120000,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Response:**
- `200 OK` or `204 No Content` on success

**Requirements:**
- Handle high write volume (many conversations)
- Consider batching for performance
- Index on botId, playerId, timestamp for queries

### 4. Message Events

#### POST `/api/bots/messages`

**Purpose:** Track individual message events

**Request:**
```http
POST /api/bots/messages
Authorization: Bearer {ADMIN_API_TOKEN}
Content-Type: application/json

{
  "botId": "bot-123",
  "roomUrl": "https://play.workadventu.re/@/org/world/room",
  "messageLength": 50,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Response:**
- `200 OK` or `204 No Content` on success

**Requirements:**
- Handle very high write volume (many messages)
- Consider batching or async processing
- Index on botId, timestamp for queries

### 5. Conversation Memory

### 6. Bot Metrics

#### POST `/api/bots/metrics`

**Purpose:** Store bot metrics (high volume, time-series data)

**Request:**
```http
POST /api/bots/metrics
Authorization: Bearer {BOT_SERVICE_TOKEN}
Content-Type: application/json

{
  "metrics": [
    {
      "botId": "bot-123",
      "timestamp": 1704067200000,
      "metrics": {
        "responseTime": 1250,
        "tokenUsage": {
          "prompt": 500,
          "completion": 200,
          "total": 700
        },
        "repetitionScore": 0.1,
        "systemPromptLeakage": false,
        "personalityCompliance": 0.95,
        "conversationQuality": 0.9
      },
      "metadata": {
        "playerId": 123,
        "spaceName": "room-456"
      }
    }
  ]
}
```

**Response:**
- `200 OK` with `{ "saved": number }`
- `400 Bad Request` for invalid data

**Requirements:**
- High write throughput (thousands of metrics per minute)
- Time-series optimized storage
- Batch inserts for performance

#### GET `/api/bots/:botId/metrics`

**Purpose:** Query metrics with filters

**Query Parameters:**
- `metricType`: Filter by metric type (response_time, token_usage, etc.)
- `startTime`: Start timestamp (milliseconds)
- `endTime`: End timestamp (milliseconds)
- `limit`: Maximum results (default: 100)
- `offset`: Pagination offset

**Response:**
```json
[
  {
    "botId": "bot-123",
    "timestamp": 1704067200000,
    "metrics": { ... },
    "metadata": { ... }
  }
]
```

**Database Schema:**
```sql
CREATE TABLE bots_metrics (
    id SERIAL PRIMARY KEY,
    bot_id VARCHAR(255) NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    metric_value NUMERIC NOT NULL,
    metadata JSONB,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bot_timestamp (bot_id, timestamp),
    INDEX idx_type_timestamp (metric_type, timestamp)
);
```

### 7. Conversation Storage (Production)

#### GET `/api/bots/:botId/conversations`

**Purpose:** Get recent conversations for admin viewing

**Query Parameters:**
- `limit`: Maximum results (default: 50)
- `offset`: Pagination offset
- `playerId`: Filter by player ID
- `startDate`: Start timestamp
- `endDate`: End timestamp

**Response:**
```json
{
  "botId": "bot-123",
  "conversations": [
    {
      "id": 1,
      "botId": "bot-123",
      "playerId": 456,
      "playerName": "John",
      "messages": [
        {
          "sender": "person",
          "message": "Hello",
          "timestamp": 1704067200000
        },
        {
          "sender": "bot",
          "message": "Hi there!",
          "timestamp": 1704067201000
        }
      ],
      "startedAt": 1704067200000,
      "endedAt": 1704067205000,
      "messageCount": 2,
      "createdAt": 1704067205000
    }
  ],
  "count": 1
}
```

#### GET `/api/bots/:botId/conversations/stats`

**Purpose:** Get conversation statistics

**Response:**
```json
{
  "botId": "bot-123",
  "totalConversations": 150,
  "oldestConversation": 1704067200000,
  "newestConversation": 1704153600000,
  "totalSize": 1048576
}
```

#### DELETE `/api/bots/:botId/conversations/cleanup`

**Purpose:** Manual cleanup for specific bot (admin only)

**Query Parameters:**
- `olderThanDays`: Delete conversations older than X days
- `keepRecent`: Keep only last N conversations

**Response:**
```json
{
  "deletedCount": 50,
  "spaceFreed": 524288,
  "botsAffected": 1
}
```

#### DELETE `/api/bots/conversations/cleanup`

**Purpose:** Manual cleanup for all bots (admin only)

**Query Parameters:**
- `olderThanDays`: Delete conversations older than X days
- `maxPerBot`: Maximum conversations per bot
- `maxTotal`: Maximum total conversations

**Database Schema:**
```sql
CREATE TABLE bots_conversations_recent (
    id SERIAL PRIMARY KEY,
    bot_id VARCHAR(255) NOT NULL,
    player_id INTEGER NOT NULL,
    player_name VARCHAR(255),
    messages JSONB NOT NULL,
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP NOT NULL,
    message_count INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bot_created (bot_id, created_at),
    INDEX idx_player (player_id),
    INDEX idx_created_at (created_at)
);
```

**Note:** No automatic cleanup triggers. Admin must manually trigger cleanup via API endpoints.

### 8. Test Results

#### POST `/api/bots/test/results`

**Purpose:** Store test results

**Request:**
```json
{
  "testId": "test-123",
  "botId": "bot-123",
  "testSuite": "personality_compliance",
  "results": { ... },
  "passed": true
}
```

**Database Schema:**
```sql
CREATE TABLE bots_test_results (
    id SERIAL PRIMARY KEY,
    test_id VARCHAR(255) UNIQUE NOT NULL,
    bot_id VARCHAR(255),
    test_suite VARCHAR(255),
    results JSONB NOT NULL,
    passed BOOLEAN NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bot_id (bot_id),
    INDEX idx_test_suite (test_suite)
);
```

### 9. Improvements

#### POST `/api/bots/improvements`

**Purpose:** Store improvement cycles

**Request:**
```json
{
  "botId": "bot-123",
  "improvementType": "repetition_fix",
  "changes": { ... },
  "metricsBefore": { ... },
  "metricsAfter": { ... },
  "deployed": false
}
```

**Database Schema:**
```sql
CREATE TABLE bots_improvements (
    id SERIAL PRIMARY KEY,
    bot_id VARCHAR(255),
    improvement_type VARCHAR(50),
    changes JSONB NOT NULL,
    metrics_before JSONB,
    metrics_after JSONB,
    deployed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bot_id (bot_id),
    INDEX idx_deployed (deployed)
);
```

### 5. Conversation Memory (Enhanced)

#### POST `/api/bots/memory/:botId`

**Purpose:** Save conversation memories for a bot

**Request:**
```http
POST /api/bots/memory/bot-123
Authorization: Bearer {ADMIN_API_TOKEN}
Content-Type: application/json

{
  "memories": [
    {
      "playerId": 123,
      "playerName": "John",
      "conversationHistory": [...],
      "emotions": {
        "botEmotion": { "anger": 20, "happiness": 70, "trust": 60, "familiarity": 80 },
        "playerEmotion": { "anger": 0, "happiness": 80, "trust": 70 }
      },
      "personalInfo": {
        "birthday": "January 15",
        "name": "John",
        "preferences": ["pizza", "video games"],
        "facts": [["favorite_color", "blue"]]
      },
      "relationship": {
        "firstMet": 1704067200000,
        "lastMet": 1704153600000,
        "totalConversations": 5,
        "totalMessages": 25,
        "importantEvents": [...]
      },
      "lastUpdated": 1704153600000,
      "createdAt": 1704067200000
    }
  ],
  "timestamp": 1704153600000
}
```

**Response:**
- `200 OK` or `204 No Content` on success

**Requirements:**
- Upsert logic (update if exists, create if not)
- Index on botId, playerId for fast lookups
- Handle large memory objects efficiently
- Consider batching for multiple memories

#### GET `/api/bots/memory/:botId`

**Purpose:** Load conversation memories for a bot

**Request:**
```http
GET /api/bots/memory/bot-123
Authorization: Bearer {ADMIN_API_TOKEN}
```

**Response:**
```json
{
  "memories": [
    {
      "playerId": 123,
      "playerName": "John",
      "conversationHistory": [...],
      "emotions": {...},
      "personalInfo": {...},
      "relationship": {...},
      "lastUpdated": 1704153600000,
      "createdAt": 1704067200000
    }
  ]
}
```

**Response Codes:**
- `200 OK` with memories array
- `404 Not Found` if bot has no memories (return empty array `[]`)

**Requirements:**
- Return all memories for the bot
- Efficient querying (index on botId)
- Handle large result sets
- Return empty array if no memories exist (not an error)

## Database Schema

### bots_configuration

```sql
CREATE TABLE bots_configuration (
  bot_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  room_url TEXT NOT NULL,
  world_url TEXT NOT NULL,
  universe_url TEXT,
  user_id VARCHAR(255),
  behavior_type VARCHAR(50) NOT NULL CHECK (behavior_type IN ('idle', 'patrol', 'social')),
  behavior_config JSONB NOT NULL,
  ai_provider VARCHAR(50) CHECK (ai_provider IN ('lmstudio', 'ultravox', 'gpt-voice')),
  ai_config JSONB, -- Contains API keys, endpoints, tokens (SENSITIVE)
  chat_instructions TEXT, -- System prompt for AI (SENSITIVE)
  movement_instructions TEXT, -- Behavioral rules (SENSITIVE)
  assigned_space JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for common queries
  INDEX idx_room_url (room_url),
  INDEX idx_world_url (world_url),
  INDEX idx_universe_url (universe_url),
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at)
);
```

### bots_usage

```sql
CREATE TABLE bots_usage (
  id SERIAL PRIMARY KEY,
  bot_id VARCHAR(255) NOT NULL,
  room_url TEXT NOT NULL,
  world_url TEXT NOT NULL,
  universe_url TEXT,
  user_id VARCHAR(255),
  total_conversations INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_active_time BIGINT DEFAULT 0, -- milliseconds
  last_active_at TIMESTAMP,
  conversations_by_date JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(bot_id, room_url),
  
  -- Indexes
  INDEX idx_bot_id (bot_id),
  INDEX idx_room_url (room_url),
  INDEX idx_world_url (world_url),
  INDEX idx_universe_url (universe_url),
  INDEX idx_user_id (user_id),
  INDEX idx_last_active_at (last_active_at),
  
  -- Foreign key (optional)
  FOREIGN KEY (bot_id) REFERENCES bots_configuration(bot_id) ON DELETE CASCADE
);
```

### bots_conversations

```sql
CREATE TABLE bots_conversations (
  id SERIAL PRIMARY KEY,
  bot_id VARCHAR(255) NOT NULL,
  player_id INTEGER NOT NULL,
  room_url TEXT NOT NULL,
  duration INTEGER NOT NULL, -- milliseconds
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for queries
  INDEX idx_bot_id (bot_id),
  INDEX idx_player_id (player_id),
  INDEX idx_room_url (room_url),
  INDEX idx_timestamp (timestamp),
  INDEX idx_bot_timestamp (bot_id, timestamp),
  
  -- Foreign key (optional)
  FOREIGN KEY (bot_id) REFERENCES bots_configuration(bot_id) ON DELETE CASCADE
);
```

### bots_messages

```sql
CREATE TABLE bots_messages (
  id SERIAL PRIMARY KEY,
  bot_id VARCHAR(255) NOT NULL,
  room_url TEXT NOT NULL,
  message_length INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_bot_id (bot_id),
  INDEX idx_room_url (room_url),
  INDEX idx_timestamp (timestamp),
  INDEX idx_bot_timestamp (bot_id, timestamp),
  
  -- Foreign key (optional)
  FOREIGN KEY (bot_id) REFERENCES bots_configuration(bot_id) ON DELETE CASCADE
);
```

### bots_memory

```sql
CREATE TABLE bots_memory (
  id SERIAL PRIMARY KEY,
  bot_id VARCHAR(255) NOT NULL,
  player_id INTEGER NOT NULL,
  memory_data JSONB NOT NULL, -- Full BotPlayerMemory object
  last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Unique constraint (one memory per bot-player pair)
  UNIQUE(bot_id, player_id),
  
  -- Indexes
  INDEX idx_bot_id (bot_id),
  INDEX idx_player_id (player_id),
  INDEX idx_last_updated (last_updated),
  INDEX idx_bot_player (bot_id, player_id),
  
  -- Foreign key (optional)
  FOREIGN KEY (bot_id) REFERENCES bots_configuration(bot_id) ON DELETE CASCADE
);
```

**Memory Data Structure (JSONB):**
The `memory_data` field stores a complete `BotPlayerMemory` object including:
- Conversation history (last N messages)
- Emotional state (bot and player emotions)
- Personal information (birthday, name, preferences, facts)
- Relationship context (first met, total conversations, important events)

See [CONVERSATION_MEMORY.md](../architecture/CONVERSATION_MEMORY.md) for detailed structure.

## Scaling Requirements

### Write Throughput

**Bot Configuration:**
- Low volume: ~1-10 writes/second
- Peak: ~50 writes/second (during map editing sessions)
- **Requirement**: Handle 100 writes/second comfortably

**Usage Metrics:**
- Volume: ~1 write per bot per minute (periodic flush)
- For 1,000 bots: ~17 writes/second
- For 10,000 bots: ~167 writes/second
- **Requirement**: Handle 200 writes/second comfortably

**Conversation Events:**
- Volume: Varies by bot activity
- Estimate: ~10-50 events/second per 1,000 active bots
- For 10,000 bots: ~100-500 events/second
- **Requirement**: Handle 1,000 events/second comfortably

**Message Events:**
- Volume: Varies significantly
- Estimate: ~50-200 events/second per 1,000 active bots
- For 10,000 bots: ~500-2,000 events/second
- **Requirement**: Handle 5,000 events/second comfortably

### Read Throughput

**Configuration Queries:**
- Low volume: ~1-10 reads/second
- Peak: ~50 reads/second (during map loads)
- **Requirement**: Handle 100 reads/second comfortably

**Usage Analytics:**
- Low volume: ~1-5 queries/second
- Peak: ~20 queries/second (during reporting)
- **Requirement**: Handle 50 queries/second comfortably

### Storage Requirements

**Bot Configurations:**
- Size per config: ~2-5 KB
- For 10,000 bots: ~20-50 MB
- Growth rate: ~1-5 MB/month (depending on bot creation rate)

**Usage Metrics:**
- Size per metric: ~500 bytes
- For 10,000 bots: ~5 MB
- Growth rate: ~5 MB/month

**Conversation Events:**
- Size per event: ~200 bytes
- For 1,000 conversations/day: ~200 KB/day = ~6 MB/month
- For 10,000 conversations/day: ~2 MB/day = ~60 MB/month
- **Retention**: Recommend 90 days = ~180 MB for 10K conversations/day

**Message Events:**
- Size per event: ~150 bytes
- For 10,000 messages/day: ~1.5 MB/day = ~45 MB/month
- For 100,000 messages/day: ~15 MB/day = ~450 MB/month
- **Retention**: Recommend 90 days = ~1.35 GB for 100K messages/day

**Total Storage Estimate:**
- Small deployment (1,000 bots): ~100 MB
- Medium deployment (10,000 bots): ~500 MB - 2 GB
- Large deployment (100,000 bots): ~5 GB - 20 GB

### Database Performance

**Recommended Configuration:**
- **Connection Pool**: 20-50 connections
- **Query Timeout**: 5-10 seconds
- **Write Timeout**: 10-30 seconds (for batch operations)
- **Indexes**: All foreign keys and commonly queried fields
- **Partitioning**: Consider partitioning `bots_conversations` and `bots_messages` by date for large deployments

### Caching Strategy

**Recommended:**
- Cache bot configurations (TTL: 5-10 minutes)
- Cache usage metrics (TTL: 1-5 minutes)
- Invalidate on updates

**Cache Size:**
- For 10,000 bots: ~50-100 MB cache
- Use Redis or similar for distributed caching

## Rate Limiting

**Recommended Limits:**
- Configuration endpoints: 100 requests/minute per IP
- Usage endpoints: 1,000 requests/minute per IP
- Conversation/Message endpoints: 10,000 requests/minute per IP

## Authentication & Authorization

**Required:**
- Bearer token authentication (`ADMIN_API_TOKEN`)
- User-based permissions (can user create/edit/delete bots?)
- Room/world/universe-level permissions
- Rate limiting per user

**Permission Checks:**
- User can create bots in their rooms/worlds
- User can edit/delete their own bots
- Admins can manage all bots
- Check bot limits per user/room/world

## Error Handling

**Required:**
- Consistent error response format
- Proper HTTP status codes
- Error logging and monitoring
- Retry logic for transient failures

**Error Response Format:**
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

## Monitoring & Alerts

**Recommended Metrics:**
- Request rate (requests/second)
- Error rate (errors/second)
- Response time (p50, p95, p99)
- Database query time
- Storage usage
- Bot count per room/world/universe

**Alerts:**
- High error rate (>1%)
- Slow response time (>1 second p95)
- Storage approaching limits
- Bot count exceeding limits

## Implementation Priority

### Phase 1: Core Functionality (Required)
1. ✅ Bot configuration CRUD endpoints
2. ✅ Usage metrics tracking endpoint
3. ✅ Basic database schema
4. ✅ Authentication
5. ✅ Conversation memory storage endpoints

### Phase 2: Analytics (Important)
1. ✅ Usage query endpoint with filters
2. ✅ Conversation/message event tracking
3. ✅ Aggregation queries
4. ✅ Indexes for performance

### Phase 3: Optimization (Recommended)
1. Caching layer
2. Batch processing for events
3. Database partitioning
4. Read replicas for analytics

### Phase 4: Advanced Features (Optional)
1. Real-time analytics
2. Export/import functionality
3. Bot templates
4. Usage dashboards

## Testing Requirements

**Load Testing:**
- Test with 1,000 concurrent bot updates
- Test with 10,000 conversation events/minute
- Test with 50,000 message events/minute
- Verify database performance under load

**Integration Testing:**
- Test all endpoints with valid/invalid data
- Test authentication and authorization
- Test error handling
- Test rate limiting

## Security Considerations

1. **Input Validation**: 
   - Validate all input data
   - Validate instruction length (chat: max 10,000 chars, movement: max 5,000 chars)
   - Sanitize instructions to prevent XSS/injection
   
2. **SQL Injection**: Use parameterized queries

3. **Rate Limiting**: Prevent abuse

4. **Authentication**: Secure token handling

5. **Data Privacy**: Sanitize user data

6. **Access Control**: Enforce permissions

7. **Sensitive Data Protection**: 
   - AI config (API keys, tokens, endpoints) - NEVER expose in public endpoints
   - Chat instructions - May contain proprietary prompts - NEVER in WAM files
   - Movement instructions - May contain business logic - NEVER in WAM files
   - Always require authentication for sensitive data access
   - Use `includeSensitive` parameter to control access
   - Consider encrypting sensitive fields at rest
   - Log access to sensitive data for audit

8. **WAM File Security**: 
   - Never store sensitive data in WAM files (they're publicly accessible)
   - Only store references (aiConfigRef) in WAM files
   - Fetch sensitive data from Admin API at runtime

## Sensitive Data Fields

The following fields contain sensitive information and must be handled securely:

1. **aiConfig**: Contains API keys, tokens, endpoints
2. **chatInstructions**: System prompts that may contain proprietary information
3. **movementInstructions**: Behavioral rules that may contain business logic

**Security Requirements:**
- Never return in public endpoints (list endpoints)
- Only return when `includeSensitive=true` AND user has permissions
- Consider encrypting at rest
- Log access to sensitive data
- Validate and sanitize input

See [SECURITY.md](./SECURITY.md) and [CHAT_AND_MOVEMENT_INSTRUCTIONS.md](./CHAT_AND_MOVEMENT_INSTRUCTIONS.md) for detailed information.

## Example Implementation

See [ADMIN_API_INTEGRATION.md](./ADMIN_API_INTEGRATION.md) for detailed endpoint specifications and example queries.

