# Admin API Implementation Guide - AI Workflow System

This document provides complete specifications for implementing the Admin API endpoints required for the AI workflow system. All endpoints use `BOT_SERVICE_TOKEN` for authentication (already in use elsewhere in the system).

## Important Notes

- **BOT_SERVICE_TOKEN**: Already implemented and in use. Use the same token mechanism.
- **High Volume Metrics**: Only needed in **development** for testing. Production will have much lower volume.
- **Database**: Small Postgres DB is fine for now. May need to replace later for production scale.
- **Cleanup**: Mostly **manual** via admin endpoints. We need visibility endpoints to see what's bloating the DB.
- **UI Components**: Should be implemented in **Admin API Portal** (not BotEditor). BotEditor is for configuration only.

## Priority 1: Core Functionality (Required for Basic Operation)

### 1. Bot Metrics Storage

**Endpoint: `POST /api/bots/metrics`**

**Purpose:** Store bot performance metrics (high volume, time-series data)

**Request:**
```json
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

**Response:** `200 OK` with `{ "saved": number }`

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

**Notes:**
- **Volume**: High in development (thousands per minute), low in production
- **Storage**: Time-series optimized storage recommended but not critical for small DB
- **Performance**: Batch inserts for performance (we send arrays of metrics)
- **Authentication**: Uses `BOT_SERVICE_TOKEN` (already implemented)
- **Error Handling**: Should be fire-and-forget (don't block bot server if Admin API is down)

### 2. Bot Metrics Query

**Endpoint: `GET /api/bots/:botId/metrics`**

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

**Notes:**
- **Authentication**: Uses `BOT_SERVICE_TOKEN` (already implemented)
- **Performance**: Should support efficient time-range queries (index on timestamp)
- **Pagination**: Required for large result sets
- **Filtering**: Optional but recommended for better performance

## Priority 2: Conversation Storage (Production Viewing)

### 3. Store Conversation

**Endpoint: `POST /api/bots/:botId/conversations`**

**Purpose:** Store recent conversations for admin viewing

**Request:**
```json
{
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
  "messageCount": 2
}
```

**Response:** `200 OK` or `204 No Content`

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

**Notes:**
- **Cleanup**: No automatic cleanup triggers - manual cleanup only
- **Authentication**: Uses `BOT_SERVICE_TOKEN` for writes, admin auth for reads
- **Volume**: Moderate write throughput (conversations stored when they end)
- **Retention**: Admins control retention via cleanup endpoints

### 4. Get Conversations

**Endpoint: `GET /api/bots/:botId/conversations`**

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
  "conversations": [ ... ],
  "count": 10
}
```

### 5. Get Conversation Stats

**Endpoint: `GET /api/bots/:botId/conversations/stats`**

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

### 6. Cleanup Conversations

**Endpoint: `DELETE /api/bots/:botId/conversations/cleanup`**

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

**Endpoint: `DELETE /api/bots/conversations/cleanup`** (All bots)

**Query Parameters:**
- `olderThanDays`: Delete conversations older than X days
- `maxPerBot`: Maximum conversations per bot
- `maxTotal`: Maximum total conversations

**Notes:**
- **Authentication**: Admin-only (requires admin session/JWT, not BOT_SERVICE_TOKEN)
- **Cleanup**: Manual cleanup only - no automatic background jobs
- **Safety**: Should return preview of what will be deleted before executing
- **Logging**: Log all cleanup operations for audit trail

## Priority 3: Enhanced Memory (Emotions)

### 7. Enhanced Memory Save (Immediate Emotion Persistence)

**Endpoint: `POST /api/bots/memory/:botId`** (Already exists, but needs enhancement)

**Enhancement Needed:**
- Support immediate saves for emotion changes (not just periodic saves)
- The bot server will call this more frequently for emotion updates
- Should handle both batch saves (periodic) and immediate saves (emotions)

**Current Behavior:** Periodic saves every 5 minutes
**New Behavior:** Also accept immediate saves for emotion-only updates

**Request (Enhanced):**
```json
{
  "memories": [ ... ],
  "timestamp": 1704067200000,
  "saveType": "immediate" | "periodic" // New field
}
```

### 8. Get Bot Emotions

**Endpoint: `GET /api/bots/:botId/emotions`**

**Purpose:** Get all emotions for a bot (for admin UI)

**Response:**
```json
[
  {
    "playerId": 123,
    "playerName": "John",
    "emotions": {
      "botEmotion": {
        "anger": 10,
        "happiness": 80,
        "trust": 70,
        "familiarity": 60
      },
      "personEmotion": {
        "anger": 5,
        "happiness": 75,
        "trust": 65
      },
      "lastEmotionUpdate": 1704067200000
    }
  }
]
```

**Endpoint: `GET /api/bots/:botId/emotions/:playerId`**

**Purpose:** Get specific emotion for a bot-player pair

## Priority 4: Testing & Improvement (Development)

### 9. Store Test Results

**Endpoint: `POST /api/bots/test/results`**

**Purpose:** Store test results for regression testing

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

### 10. Store Improvement Cycles

**Endpoint: `POST /api/bots/improvements`**

**Purpose:** Store improvement cycles for tracking

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

## Implementation Order

### Phase 1: Critical (Do First)
1. ✅ Bot Metrics Storage (`POST /api/bots/metrics`)
2. ✅ Bot Metrics Query (`GET /api/bots/:botId/metrics`)
3. ✅ Conversation Storage (`POST /api/bots/:botId/conversations`)
4. ✅ Get Conversations (`GET /api/bots/:botId/conversations`)

### Phase 2: Important (Do Next)
5. ✅ Conversation Stats (`GET /api/bots/:botId/conversations/stats`)
6. ✅ Conversation Cleanup (`DELETE /api/bots/:botId/conversations/cleanup`)
7. ✅ Enhanced Memory Save (immediate emotion persistence)
8. ✅ Get Bot Emotions (`GET /api/bots/:botId/emotions`)

### Phase 3: Nice to Have (Development)
9. ✅ Test Results Storage (`POST /api/bots/test/results`)
10. ✅ Improvement Cycles (`POST /api/bots/improvements`)

## Authentication

All endpoints use `BOT_SERVICE_TOKEN` for authentication (separate from `ADMIN_API_TOKEN`):

```http
Authorization: Bearer {BOT_SERVICE_TOKEN}
```

**Exception:** Cleanup endpoints require admin authentication (session token or admin JWT).

## Database Considerations

### Performance
- **Metrics table**: High write throughput - consider partitioning by date or using time-series database
- **Conversations table**: Moderate write throughput - index on `bot_id` and `created_at` for cleanup queries
- **Memory table**: Already exists - ensure it handles frequent emotion updates efficiently

### Storage
- **Metrics**: Can grow large - consider retention policies (e.g., keep last 30 days)
- **Conversations**: Manual cleanup only - admins control retention
- **Test Results**: Can be archived after a period

## Testing

Test with:
- High volume metrics (1000+ metrics/minute)
- Concurrent conversation storage
- Cleanup operations with large datasets
- Time-range queries on metrics

## Next Steps for Bot Server

Once Admin API implements these endpoints:

1. **Metrics Collection**: Will automatically start working
2. **Conversation Storage**: Will automatically store conversations
3. **Emotion Persistence**: Will automatically save emotions immediately
4. **Admin UI**: Can be connected to display data
5. **Testing Framework**: Can store test results
6. **Self-Improvement**: Can track improvement cycles

## Database Monitoring & Visibility Endpoints

### Database Size Monitoring

**Endpoint: `GET /api/bots/database/stats`** (Admin only)

**Purpose:** Show what's bloating the database so admins know when cleanup is needed

**Response:**
```json
{
  "metrics": {
    "table": "bots_metrics",
    "rowCount": 1500000,
    "sizeBytes": 524288000,
    "oldestRecord": 1704067200000,
    "newestRecord": 1704153600000,
    "recommendation": "Consider cleanup: 1.5M rows, 500MB"
  },
  "conversations": {
    "table": "bots_conversations_recent",
    "rowCount": 50000,
    "sizeBytes": 104857600,
    "oldestRecord": 1704067200000,
    "newestRecord": 1704153600000,
    "recommendation": "OK: 50K rows, 100MB"
  },
  "memory": {
    "table": "bots_memory",
    "rowCount": 10000,
    "sizeBytes": 5242880,
    "recommendation": "OK: 10K rows, 5MB"
  },
  "testResults": {
    "table": "bots_test_results",
    "rowCount": 5000,
    "sizeBytes": 2621440,
    "recommendation": "OK: 5K rows, 2.5MB"
  },
  "improvements": {
    "table": "bots_improvements",
    "rowCount": 100,
    "sizeBytes": 131072,
    "recommendation": "OK: 100 rows, 128KB"
  },
  "totalSizeBytes": 636354560,
  "totalSizeMB": 606.7,
  "recommendations": [
    "bots_metrics table is large (1.5M rows, 500MB). Consider cleanup for records older than 30 days."
  ]
}
```

**Implementation:**
```sql
-- Example queries for stats
SELECT 
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('bots_metrics')) as size,
  MIN(timestamp) as oldest,
  MAX(timestamp) as newest
FROM bots_metrics;
```

### Cleanup Preview

**Endpoint: `GET /api/bots/:botId/conversations/cleanup/preview`** (Admin only)

**Purpose:** Preview what will be deleted before executing cleanup

**Query Parameters:**
- `olderThanDays`: Preview conversations older than X days
- `keepRecent`: Preview keeping only last N conversations

**Response:**
```json
{
  "botId": "bot-123",
  "cleanupType": "olderThanDays",
  "cleanupValue": 7,
  "willDelete": {
    "conversationCount": 50,
    "estimatedSizeBytes": 5242880,
    "oldestToDelete": 1704067200000,
    "newestToDelete": 1704153600000
  },
  "willKeep": {
    "conversationCount": 100,
    "oldestKept": 1704153600000,
    "newestKept": 1704240000000
  }
}
```

**Endpoint: `GET /api/bots/metrics/cleanup/preview`** (Admin only)

**Purpose:** Preview metrics cleanup

**Query Parameters:**
- `olderThanDays`: Preview metrics older than X days
- `maxRows`: Preview keeping only last N rows per bot

**Response:**
```json
{
  "cleanupType": "olderThanDays",
  "cleanupValue": 30,
  "willDelete": {
    "metricCount": 1000000,
    "estimatedSizeBytes": 419430400,
    "oldestToDelete": 1704067200000,
    "newestToDelete": 1704153600000,
    "botsAffected": 10
  },
  "willKeep": {
    "metricCount": 500000,
    "oldestKept": 1704153600000,
    "newestKept": 1704240000000
  }
}
```

## Implementation Details

### Authentication

**BOT_SERVICE_TOKEN** (already implemented):
- Used for: Metrics writes, conversation storage, memory saves
- Header: `Authorization: Bearer {BOT_SERVICE_TOKEN}`
- Already in use for other bot endpoints

**Admin Authentication**:
- Used for: Cleanup operations, database stats, conversation viewing
- Can use existing admin session/JWT mechanism
- Should verify admin permissions

### Database Schema Details

#### bots_metrics Table

```sql
CREATE TABLE bots_metrics (
    id SERIAL PRIMARY KEY,
    bot_id VARCHAR(255) NOT NULL,
    metric_type VARCHAR(50) NOT NULL, -- 'response_time', 'token_usage', 'repetition_score', etc.
    metric_value NUMERIC NOT NULL,
    metadata JSONB, -- Additional context (playerId, spaceName, etc.)
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bot_timestamp (bot_id, timestamp),
    INDEX idx_type_timestamp (metric_type, timestamp),
    INDEX idx_timestamp (timestamp) -- For cleanup queries
);

-- Partitioning (optional, for large scale):
-- CREATE TABLE bots_metrics_2025_01 PARTITION OF bots_metrics
-- FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

**Notes:**
- `metric_type` values: `response_time`, `token_usage`, `repetition_score`, `system_prompt_leakage`, `personality_compliance`, `conversation_quality`
- `metadata` can contain: `{ "playerId": 123, "spaceName": "room-456", "error": "..." }`
- Index on `timestamp` is critical for cleanup queries

#### bots_conversations_recent Table

```sql
CREATE TABLE bots_conversations_recent (
    id SERIAL PRIMARY KEY,
    bot_id VARCHAR(255) NOT NULL,
    player_id INTEGER NOT NULL,
    player_name VARCHAR(255),
    messages JSONB NOT NULL, -- Array of { sender, message, timestamp }
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP NOT NULL,
    message_count INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bot_created (bot_id, created_at),
    INDEX idx_player (player_id),
    INDEX idx_created_at (created_at), -- For cleanup queries
    INDEX idx_ended_at (ended_at) -- For cleanup by date
);
```

**Notes:**
- `messages` format: `[{ "sender": "person"|"bot", "message": "...", "timestamp": 1234567890 }]`
- No automatic cleanup - manual only
- Index on `created_at` and `ended_at` for cleanup queries

#### bots_test_results Table

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
    INDEX idx_test_suite (test_suite),
    INDEX idx_created_at (created_at) -- For cleanup queries
);
```

#### bots_improvements Table

```sql
CREATE TABLE bots_improvements (
    id SERIAL PRIMARY KEY,
    bot_id VARCHAR(255),
    improvement_type VARCHAR(50), -- 'repetition_fix', 'prompt_optimization', etc.
    changes JSONB NOT NULL,
    metrics_before JSONB,
    metrics_after JSONB,
    deployed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bot_id (bot_id),
    INDEX idx_deployed (deployed),
    INDEX idx_created_at (created_at) -- For cleanup queries
);
```

### Error Handling

**For BOT_SERVICE_TOKEN endpoints:**
- Should be fire-and-forget (don't block bot server)
- Return 200 OK even if there are minor issues
- Log errors but don't throw exceptions that would affect bot operation
- Bot server already handles errors gracefully

**For Admin endpoints:**
- Return proper HTTP status codes
- Provide detailed error messages
- Log all operations for audit trail

### Performance Considerations

**Development (High Volume):**
- Metrics: Thousands per minute
- Batch inserts recommended
- Consider connection pooling
- May need periodic cleanup during dev testing

**Production (Low Volume):**
- Metrics: Hundreds per hour (much lower)
- Standard inserts are fine
- Small Postgres DB is sufficient
- Manual cleanup as needed

**Optimization Tips:**
- Use batch inserts for metrics (we send arrays)
- Index on timestamp columns for cleanup queries
- Consider partitioning by date if table grows large
- Vacuum/analyze periodically

## Implementation Checklist

### Phase 1: Critical (Do First)
- [ ] `POST /api/bots/metrics` - Store metrics (batch)
- [ ] `GET /api/bots/:botId/metrics` - Query metrics
- [ ] `POST /api/bots/:botId/conversations` - Store conversations
- [ ] `GET /api/bots/:botId/conversations` - Get conversations
- [ ] Database tables created with proper indexes

### Phase 2: Important (Do Next)
- [ ] `GET /api/bots/:botId/conversations/stats` - Conversation stats
- [ ] `DELETE /api/bots/:botId/conversations/cleanup` - Cleanup conversations
- [ ] `DELETE /api/bots/conversations/cleanup` - Cleanup all conversations
- [ ] `GET /api/bots/database/stats` - Database monitoring
- [ ] `GET /api/bots/:botId/conversations/cleanup/preview` - Cleanup preview

### Phase 3: Enhanced Memory
- [ ] Enhanced `POST /api/bots/memory/:botId` - Support immediate emotion saves
- [ ] `GET /api/bots/:botId/emotions` - Get bot emotions (for admin UI)

### Phase 4: Development Features
- [ ] `POST /api/bots/test/results` - Store test results
- [ ] `POST /api/bots/improvements` - Store improvement cycles
- [ ] `GET /api/bots/metrics/cleanup/preview` - Metrics cleanup preview

## Testing Recommendations

1. **Load Testing**: Test with 1000 metrics/minute (dev scenario)
2. **Cleanup Testing**: Test cleanup operations with large datasets
3. **Error Handling**: Test with invalid tokens, missing data, etc.
4. **Preview Testing**: Verify cleanup previews are accurate
5. **Performance**: Test query performance with indexes

## Questions for Admin API Team

1. **BOT_SERVICE_TOKEN**: Confirm it's already implemented and working for other endpoints?
2. **Admin Auth**: What mechanism do you use for admin authentication? (JWT, session, etc.)
3. **Database**: Current Postgres version? Any constraints we should know about?
4. **Monitoring**: Do you have existing database monitoring we should integrate with?
5. **Cleanup UI**: Should cleanup preview be shown in Admin Portal UI, or just via API?
