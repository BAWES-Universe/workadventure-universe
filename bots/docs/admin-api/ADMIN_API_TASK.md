# Admin API Implementation Task - AI Workflow System

## Overview

The bot system needs these Admin API endpoints to support metrics collection, conversation storage, and analytics. This is a straightforward implementation task with clear specifications.

## Quick Summary

**What we need:**
- 10 endpoints (4 critical, 4 important, 2 optional)
- 5 database tables (with proper indexes)
- 2 monitoring endpoints (to see what's bloating the DB)

**Authentication:**
- `BOT_SERVICE_TOKEN` (already implemented - use existing mechanism)
- Admin auth for cleanup/monitoring endpoints

**Volume:**
- High volume only in **development** (thousands of metrics/minute)
- Low volume in **production** (hundreds of metrics/hour)
- Small Postgres DB is fine for now

**Cleanup:**
- **Manual only** - no automatic background jobs
- Need visibility endpoints to see what needs cleanup

## Critical Endpoints (Implement First)

### 1. POST /api/bots/metrics
Store bot metrics (batch writes). We send arrays of metrics.

**Request:**
```json
{
  "metrics": [
    {
      "botId": "bot-123",
      "timestamp": 1704067200000,
      "metrics": {
        "responseTime": 1250,
        "tokenUsage": { "prompt": 500, "completion": 200, "total": 700 },
        "repetitionScore": 0.1,
        "systemPromptLeakage": false,
        "personalityCompliance": 0.95
      },
      "metadata": { "playerId": 123, "spaceName": "room-456" }
    }
  ]
}
```

**Response:** `200 OK` with `{ "saved": number }`

**Auth:** `BOT_SERVICE_TOKEN` (already implemented)

### 2. GET /api/bots/:botId/metrics
Query metrics with filters (time range, metric type, pagination).

**Query Params:** `metricType`, `startTime`, `endTime`, `limit`, `offset`

**Auth:** `BOT_SERVICE_TOKEN`

### 3. POST /api/bots/:botId/conversations
Store conversations when they end.

**Auth:** `BOT_SERVICE_TOKEN`

### 4. GET /api/bots/:botId/conversations
Get conversations with filters (player, date range, pagination).

**Auth:** Admin (for viewing in portal)

## Important Endpoints (Implement Next)

### 5. GET /api/bots/:botId/conversations/stats
Get conversation statistics (count, oldest, newest, size).

### 6. DELETE /api/bots/:botId/conversations/cleanup
Manual cleanup (admin only). Query params: `olderThanDays` or `keepRecent`.

### 7. DELETE /api/bots/conversations/cleanup
Cleanup all bots (admin only).

### 8. GET /api/bots/database/stats
**Database monitoring** - show what's bloating the DB (row counts, sizes, recommendations).

**Response:**
```json
{
  "metrics": {
    "rowCount": 1500000,
    "sizeBytes": 524288000,
    "recommendation": "Consider cleanup: 1.5M rows, 500MB"
  },
  "conversations": { ... },
  "totalSizeMB": 606.7,
  "recommendations": ["bots_metrics table is large..."]
}
```

### 9. GET /api/bots/:botId/conversations/cleanup/preview
Preview what will be deleted before cleanup (admin only).

### 10. GET /api/bots/:botId/emotions
Get bot emotions for admin UI (admin only).

## Database Tables

See `IMPLEMENTATION_PRIORITY.md` for complete schemas. Key tables:

- `bots_metrics` - Time-series metrics data
- `bots_conversations_recent` - Recent conversations
- `bots_test_results` - Test results (dev only)
- `bots_improvements` - Improvement cycles (dev only)

**Important:** Add indexes on `timestamp` columns for cleanup queries.

## Full Documentation

See `bots/docs/admin-api/IMPLEMENTATION_PRIORITY.md` for:
- Complete endpoint specifications
- Request/response examples
- Database schemas with indexes
- Authentication details
- Error handling
- Performance considerations
- Testing recommendations

## Questions?

1. **BOT_SERVICE_TOKEN**: Confirm it's already implemented and working?
2. **Admin Auth**: What mechanism do you use? (JWT, session, etc.)
3. **Database**: Current Postgres version? Any constraints?
4. **Timeline**: When can we expect Phase 1 (critical endpoints)?

## Implementation Checklist

- [ ] Phase 1: Critical endpoints (4 endpoints)
- [ ] Phase 2: Important endpoints (6 endpoints)
- [ ] Database tables with indexes
- [ ] Database monitoring endpoint
- [ ] Cleanup preview endpoints
- [ ] Testing with high volume (dev scenario)
