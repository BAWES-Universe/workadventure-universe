# Horizontal Scaling Guide

## Overview

The bot system is designed to support horizontal scaling across multiple bot server instances. This allows you to distribute bot load across multiple servers, improving performance and fault tolerance.

## Architecture

### Components

1. **BotRegistry** (`server/BotRegistry.ts`)
   - Redis-based shared state
   - Tracks bot assignments (which bot is on which server)
   - Tracks server capacity and availability
   - Manages conversation state across servers

2. **BotServerCoordinator** (`server/BotServerCoordinator.ts`)
   - Coordinates bot distribution
   - Handles bot assignment logic
   - Manages local bot instances
   - Provides cluster status

3. **Redis** (Shared State)
   - Stores bot assignments
   - Stores server registrations
   - Stores conversation state
   - Enables coordination between servers

## Redis Configuration

### Using WorkAdventure Redis

The bot system can use the existing WorkAdventure Redis instance on a different database number:

```yaml
# docker-compose.yaml
bot-server:
  environment:
    REDIS_HOST: redis  # Same Redis instance
    REDIS_PORT: 6379
    REDIS_PASSWORD: ""  # If set
    REDIS_DB_NUMBER: 1  # Use database 1 for bots (WorkAdventure uses 0)
```

### Using Admin API Redis

Alternatively, you can use the Admin API Redis instance:

```yaml
bot-server:
  environment:
    REDIS_HOST: admin-api-redis  # Admin API Redis
    REDIS_PORT: 6379
    REDIS_PASSWORD: "${ADMIN_REDIS_PASSWORD}"
    REDIS_DB_NUMBER: 0  # Or any available database
```

### Recommended Setup

**Option 1: WorkAdventure Redis (Recommended for Development)**
- Use the same Redis instance as WorkAdventure
- Use database 1 for bots (WorkAdventure uses 0)
- Simple setup, no additional infrastructure

**Option 2: Admin API Redis (Recommended for Production)**
- Use Admin API Redis instance
- Better isolation
- Can scale independently
- Better for multi-region deployments

## Setup

### 1. Install Dependencies

```bash
cd bots
npm install
```

### 2. Configure Environment Variables

```bash
# Bot server configuration
BOT_SERVER_ID=bot-server-1  # Unique ID for each server instance
BOT_MAX_BOTS_PER_SERVER=1000  # Maximum bots per server instance

# Redis configuration (WorkAdventure Redis)
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=""  # If set
REDIS_DB_NUMBER=1  # Use database 1 for bots

# Or Admin API Redis
# REDIS_HOST=admin-api-redis
# REDIS_PORT=6379
# REDIS_PASSWORD="${ADMIN_REDIS_PASSWORD}"
# REDIS_DB_NUMBER=0
```

### 3. Initialize Coordinator

```typescript
import { BotServerCoordinator } from './server/BotServerCoordinator';

const coordinator = new BotServerCoordinator({
    serverId: process.env.BOT_SERVER_ID || 'bot-server-1',
    maxBotsPerServer: parseInt(process.env.BOT_MAX_BOTS_PER_SERVER || '1000'),
    redisConfig: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB_NUMBER || '1'),
    },
});

await coordinator.initialize();
```

### 4. Assign and Spawn Bots

```typescript
// When a bot needs to be spawned
const assignment = await coordinator.assignBot(botConfig);

if (assignment.shouldSpawn) {
    // Spawn bot on this server
    const bot = new BotClient(botConfig);
    await bot.connect();
    await coordinator.registerLocalBot(botConfig.botId, bot);
} else {
    // Bot assigned to another server
    console.log(`Bot ${botConfig.botId} assigned to ${assignment.serverId}`);
}
```

## How It Works

### Bot Assignment Flow

```
1. Bot needs to be spawned
   ↓
2. Coordinator checks if bot already assigned
   ↓
3. If not, check if this server has capacity
   ↓
4. If yes, assign to this server and spawn
   ↓
5. If no, find another server with capacity
   ↓
6. Assign to that server (they will spawn it)
```

### Server Registration

Each bot server:
1. Connects to Redis
2. Registers itself with capacity
3. Sends heartbeat every 5 seconds
4. Updates bot count as bots are assigned/unassigned

### Conversation Coordination

When a bot wants to start a conversation:
1. Check if player is already in conversation (via Redis)
2. If yes, only allow if it's the same bot
3. If no, allow and track conversation in Redis
4. All servers can see conversation state

## Load Balancing

### Automatic Distribution

Bots are automatically distributed based on:
- Server capacity
- Current bot count
- Server availability (heartbeat)

### Manual Assignment

You can manually assign bots to specific servers:

```typescript
// Force assignment to this server
await coordinator.getRegistry().assignBot(botId);
```

## Monitoring

### Cluster Status

```typescript
const status = await coordinator.getClusterStatus();
console.log(status);
// {
//   serverId: 'bot-server-1',
//   localBots: 500,
//   totalBots: 2000,
//   servers: [
//     { serverId: 'bot-server-1', capacity: 1000, currentBots: 500, ... },
//     { serverId: 'bot-server-2', capacity: 1000, currentBots: 750, ... },
//     { serverId: 'bot-server-3', capacity: 1000, currentBots: 750, ... },
//   ]
// }
```

### Server Health

```typescript
const servers = await coordinator.getRegistry().getActiveServers();
for (const server of servers) {
    console.log(`${server.serverId}: ${server.currentBots}/${server.capacity}`);
}
```

## Scaling Strategies

### Vertical Scaling (Single Server)

```yaml
bot-server:
  deploy:
    resources:
      limits:
        cpus: '4'
        memory: 8G
  environment:
    BOT_MAX_BOTS_PER_SERVER: 5000
```

### Horizontal Scaling (Multiple Servers)

```yaml
bot-server-1:
  environment:
    BOT_SERVER_ID: bot-server-1
    BOT_MAX_BOTS_PER_SERVER: 1000

bot-server-2:
  environment:
    BOT_SERVER_ID: bot-server-2
    BOT_MAX_BOTS_PER_SERVER: 1000

bot-server-3:
  environment:
    BOT_SERVER_ID: bot-server-3
    BOT_MAX_BOTS_PER_SERVER: 1000
```

### Auto-Scaling

Use Kubernetes or Docker Swarm with auto-scaling:

```yaml
# Kubernetes example
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bot-server
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: bot-server
        env:
        - name: BOT_SERVER_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: BOT_MAX_BOTS_PER_SERVER
          value: "1000"
```

## Failure Handling

### Server Failure

If a server fails:
1. Heartbeat stops (30 second timeout)
2. Server marked as inactive
3. Bots on that server become "orphaned"
4. Other servers can reassign orphaned bots

### Redis Failure

If Redis is unavailable:
- Bot assignment fails gracefully
- Local bots continue operating
- New bots cannot be assigned
- System degrades gracefully

### Recovery

On server restart:
1. Server reconnects to Redis
2. Re-registers with capacity
3. Orphaned bots can be reassigned
4. System resumes normal operation

## Best Practices

1. **Unique Server IDs**: Use unique IDs for each server instance
2. **Capacity Planning**: Set realistic capacity limits
3. **Monitoring**: Monitor server health and bot distribution
4. **Graceful Shutdown**: Always shutdown gracefully to unassign bots
5. **Redis High Availability**: Use Redis Sentinel or Cluster for production
6. **Load Testing**: Test with multiple servers before production

## Example Deployment

### Docker Compose (Multiple Servers)

```yaml
services:
  bot-server-1:
    build: ./bots
    environment:
      BOT_SERVER_ID: bot-server-1
      BOT_MAX_BOTS_PER_SERVER: 1000
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_DB_NUMBER: 1
    deploy:
      replicas: 1

  bot-server-2:
    build: ./bots
    environment:
      BOT_SERVER_ID: bot-server-2
      BOT_MAX_BOTS_PER_SERVER: 1000
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_DB_NUMBER: 1
    deploy:
      replicas: 1

  bot-server-3:
    build: ./bots
    environment:
      BOT_SERVER_ID: bot-server-3
      BOT_MAX_BOTS_PER_SERVER: 1000
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_DB_NUMBER: 1
    deploy:
      replicas: 1
```

## Troubleshooting

### Bots Not Distributing

- Check Redis connectivity
- Verify server registrations
- Check server capacity
- Verify heartbeat is working

### Conversation Conflicts

- Check conversation state in Redis
- Verify TTL is set correctly
- Check for stale conversation entries

### Server Not Registering

- Check Redis connection
- Verify server ID is unique
- Check Redis database number
- Verify heartbeat interval

## Summary

Horizontal scaling is achieved through:
- **Redis**: Shared state coordination
- **BotRegistry**: Tracks assignments and conversations
- **BotServerCoordinator**: Manages distribution
- **Heartbeat**: Keeps servers alive
- **Automatic Distribution**: Load balancing based on capacity

The system gracefully handles server failures and automatically distributes bots across available servers.

