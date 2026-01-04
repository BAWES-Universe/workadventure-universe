# Redis Setup for Bot System

## Overview

The bot system uses Redis for horizontal scaling coordination. You can use either:
1. **WorkAdventure Redis** (same instance, different database)
2. **Admin API Redis** (separate instance)

## Option 1: WorkAdventure Redis (Recommended for Development)

Use the existing Redis instance from your WorkAdventure docker-compose setup.

### Configuration

```yaml
# docker-compose.yaml
bot-server:
  environment:
    REDIS_HOST: redis  # Same Redis service
    REDIS_PORT: 6379
    REDIS_PASSWORD: ""  # If set in WorkAdventure
    REDIS_DB_NUMBER: 1  # Use database 1 (WorkAdventure uses 0)
```

### Advantages
- ✅ No additional infrastructure needed
- ✅ Simple setup
- ✅ Good for development and small deployments

### Disadvantages
- ⚠️ Shared infrastructure (if Redis goes down, both systems affected)
- ⚠️ Limited isolation

## Option 2: Admin API Redis (Recommended for Production)

Use the Redis instance from your Admin API server.

### Configuration

```yaml
# docker-compose.yaml
bot-server:
  environment:
    REDIS_HOST: admin-api-redis  # Admin API Redis service
    REDIS_PORT: 6379
    REDIS_PASSWORD: "${ADMIN_REDIS_PASSWORD}"
    REDIS_DB_NUMBER: 0  # Or any available database
```

### Advantages
- ✅ Better isolation
- ✅ Can scale independently
- ✅ Better for production
- ✅ Multi-region support

### Disadvantages
- ⚠️ Requires Admin API Redis to be accessible
- ⚠️ Network configuration needed

## Redis Database Numbers

Redis supports 16 logical databases (0-15). Here's a recommended allocation:

```
Database 0: WorkAdventure backend (variables, etc.)
Database 1: Bot system (recommended)
Database 2-15: Available for other services
```

Or if using Admin API Redis:

```
Database 0: Bot system (or any available)
Database 1-N: Admin API uses
```

## Key Namespaces

The bot system uses the following Redis key prefixes:

```
bot:server:{serverId}     - Server registration and capacity
bot:assignment:{botId}    - Bot to server assignment
bot:conversation:{playerId} - Active conversation state
```

All keys are automatically prefixed, so they won't conflict with other systems.

## Environment Variables

```bash
# Required
REDIS_HOST=redis                    # Redis hostname
REDIS_PORT=6379                     # Redis port
REDIS_DB_NUMBER=1                   # Database number (0-15)

# Optional
REDIS_PASSWORD=your-password         # If Redis is password-protected
```

## Testing Connection

```typescript
import { BotRegistry } from './server/BotRegistry';

const registry = new BotRegistry('test-server', {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB_NUMBER || '1'),
});

await registry.connect();
await registry.registerServer(1000);
console.log('Redis connection successful!');
```

## Monitoring

### Check Redis Connection

```bash
# Connect to Redis
docker exec -it workadventure-redis redis-cli

# Select bot database
SELECT 1

# Check bot keys
KEYS bot:*

# Check server registrations
HGETALL bot:server:bot-server-1

# Check bot assignments
GET bot:assignment:bot-123
```

### Redis Insight

If you have RedisInsight running (from docker-compose), you can:
1. Connect to `redis.workadventure.localhost:8001`
2. Add connection to `redis:6379`
3. Select database 1
4. View all bot-related keys

## Troubleshooting

### Connection Issues

**Error: "Redis not connected"**
- Check `REDIS_HOST` is correct
- Verify Redis is running: `docker ps | grep redis`
- Check network connectivity

**Error: "Failed to select database"**
- Verify `REDIS_DB_NUMBER` is valid (0-15)
- Check Redis allows database selection
- Some Redis configurations disable database selection

### Key Conflicts

If you see unexpected keys:
- Verify `REDIS_DB_NUMBER` is correct
- Check if another service is using the same database
- Use RedisInsight to inspect keys

### Performance

For high bot counts:
- Monitor Redis memory usage
- Consider Redis Cluster for very large deployments
- Use Redis Sentinel for high availability

## Production Recommendations

1. **Use Admin API Redis** for better isolation
2. **Enable Redis persistence** (RDB or AOF)
3. **Set up Redis Sentinel** for high availability
4. **Monitor Redis memory** and set maxmemory policy
5. **Use Redis Cluster** for very large deployments (10,000+ bots)

## Summary

- **Development**: Use WorkAdventure Redis (DB 1)
- **Production**: Use Admin API Redis (better isolation)
- **Key Prefix**: All bot keys use `bot:` prefix
- **Database**: Use separate database number to avoid conflicts
- **Monitoring**: Use RedisInsight or redis-cli

