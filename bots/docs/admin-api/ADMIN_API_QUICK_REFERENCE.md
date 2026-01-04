# Admin API Quick Reference

## Overview

This is a quick reference guide for implementing the Admin API endpoints required for the bot system. For detailed specifications, see [ADMIN_API_REQUIREMENTS.md](./ADMIN_API_REQUIREMENTS.md).

## Required Endpoints Summary

### Bot Configuration
- `POST /api/bots/configuration` - Create/update bot config
- `GET /api/bots/configuration/:botId` - Get bot config
- `GET /api/bots/configuration` - List bots (with filters)
- `DELETE /api/bots/configuration/:botId` - Delete bot config

### Usage Metrics
- `POST /api/bots/usage` - Track/update usage metrics
- `GET /api/bots/usage` - Query usage metrics

### Events
- `POST /api/bots/conversations` - Track conversation event
- `POST /api/bots/messages` - Track message event

## Database Tables Required

1. **bots_configuration** - Bot configurations (includes sensitive data)
2. **bots_usage** - Aggregated usage metrics
3. **bots_conversations** - Individual conversation events
4. **bots_messages** - Individual message events

**Sensitive Fields in bots_configuration:**
- `ai_config` - API keys, tokens, endpoints
- `chat_instructions` - System prompts for AI
- `movement_instructions` - Behavioral rules

See [ADMIN_API_REQUIREMENTS.md](./ADMIN_API_REQUIREMENTS.md) for full schema.

## Scaling Requirements Summary

### Write Throughput
- Configurations: 100 writes/sec
- Usage metrics: 200 writes/sec
- Conversations: 1,000 events/sec
- Messages: 5,000 events/sec

### Storage
- Small (1K bots): ~100 MB
- Medium (10K bots): ~500 MB - 2 GB
- Large (100K bots): ~5 GB - 20 GB

### Performance Targets
- API response: <200ms (p95)
- Database query: <100ms (p95)
- Handle 10,000+ concurrent bot updates

## Implementation Checklist

### Phase 1: Core (Required)
- [ ] Database schema creation
- [ ] Bot configuration CRUD endpoints
- [ ] Usage metrics tracking endpoint
- [ ] Authentication (Bearer token)
- [ ] Basic error handling

### Phase 2: Analytics (Important)
- [ ] Usage query endpoint with filters
- [ ] Conversation/message event tracking
- [ ] Database indexes
- [ ] Query optimization

### Phase 3: Optimization (Recommended)
- [ ] Caching layer (Redis)
- [ ] Batch processing for events
- [ ] Database read replicas
- [ ] Connection pooling

### Phase 4: Advanced (Optional)
- [ ] Real-time analytics
- [ ] Export/import
- [ ] Usage dashboards
- [ ] Bot templates

## Quick Start Implementation

### 1. Create Database Tables

```sql
-- See ADMIN_API_REQUIREMENTS.md for full schema
CREATE TABLE bots_configuration (
  bot_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  -- ... other fields ...
  ai_config JSONB,  -- SENSITIVE: API keys, tokens
  chat_instructions TEXT,  -- SENSITIVE: System prompts
  movement_instructions TEXT  -- SENSITIVE: Behavioral rules
);
CREATE TABLE bots_usage (...);
CREATE TABLE bots_conversations (...);
CREATE TABLE bots_messages (...);
```

**⚠️ Security**: Sensitive fields (ai_config, chat_instructions, movement_instructions) must never be exposed in public endpoints.

### 2. Implement Endpoints

```typescript
// Example Express.js implementation
app.post('/api/bots/configuration', authenticate, async (req, res) => {
  // Validate input
  // Check permissions
  // Save to database
  // Return success
});

app.get('/api/bots/configuration/:botId', authenticate, async (req, res) => {
  // Get from database
  // Return bot config
});
```

### 3. Add Authentication

```typescript
function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== ADMIN_API_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}
```

### 4. Add Rate Limiting

```typescript
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000 // limit each IP to 1000 requests per windowMs
});
app.use('/api/bots', limiter);
```

## Testing

### Load Testing
- Test with 1,000 concurrent bot updates
- Test with 10,000 conversation events/minute
- Test with 50,000 message events/minute

### Integration Testing
- Test all endpoints with valid/invalid data
- Test authentication and authorization
- Test error handling
- Test rate limiting

## Monitoring

### Key Metrics
- Request rate (requests/sec)
- Error rate (errors/sec)
- Response time (p50, p95, p99)
- Database query time
- Storage usage

### Alerts
- High error rate (>1%)
- Slow response time (>1 second p95)
- Storage approaching limits

## Next Steps

1. Review [ADMIN_API_REQUIREMENTS.md](./ADMIN_API_REQUIREMENTS.md) for detailed specs
2. Review [SCALING_REQUIREMENTS.md](./SCALING_REQUIREMENTS.md) for infrastructure needs
3. Review [DATA_STORAGE.md](./DATA_STORAGE.md) for data flow understanding
4. Implement Phase 1 endpoints
5. Test with load testing tools
6. Deploy and monitor

