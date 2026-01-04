# Scalability & Resource Usage

## Overview

The bot system is designed to be highly scalable, capable of supporting thousands of bots simultaneously. This document provides detailed information about resource usage, limits, and optimization strategies.

## Memory Usage Per Bot

### Base Memory Footprint

**Idle Bot (minimal activity):**
- `BotClient` instance: ~2-5 KB
  - WebSocket connection (uWebSockets.js): ~8-16 KB
  - BotState: ~100 bytes
  - Config object: ~500 bytes
  - Basic Maps (spaces, players): ~1-2 KB
- `IdleBehavior`: ~500 bytes
- **Total: ~12-24 KB per idle bot**

**Active Social Bot (with conversations):**
- Base BotClient: ~12-24 KB
- `SocialBehavior` with state:
  - Conversation history Map: ~1-5 KB (depends on history size)
  - Active conversations Map: ~500 bytes - 2 KB
  - Player tracking: ~50-200 bytes per tracked player
  - Wander state: ~200 bytes
- **Total: ~15-35 KB per active social bot**

**Patrol Bot:**
- Base BotClient: ~12-24 KB
- `PatrolBehavior`: ~1 KB (waypoints array)
- **Total: ~13-25 KB per patrol bot**

### Memory Breakdown

```typescript
// Per bot memory estimate:
BotClient:            ~15 KB (base)
  - WebSocket:         ~12 KB (uWebSockets.js is efficient)
  - State objects:     ~2 KB
  - Maps/collections:  ~1 KB

Behavior (varies):
  - IdleBehavior:      ~0.5 KB
  - PatrolBehavior:    ~1 KB
  - SocialBehavior:    ~2-10 KB (depends on activity)

Player tracking:      ~0.1 KB per tracked player
Active spaces:         ~0.1 KB per space

Total per bot:         ~15-35 KB average
```

## Scalability Limits

### Per Server Capacity

**Theoretical Limits:**
- **WebSocket connections**: No hard limit in code (OS/file descriptor limits apply)
- **Memory**: With 8GB RAM, ~200,000-500,000 idle bots (theoretical)
- **CPU**: Main bottleneck (update loop at 60fps)

**Practical Limits (Recommended):**

```typescript
// Conservative estimates for production:
const BOT_LIMITS = {
  maxBotsPerServer: 1000,        // Per bot server instance
  maxBotsPerMap: 100,            // Per room/map
  maxBotsPerUser: 50,            // Per user account
  maxBotsPerWorld: 500,          // Per world
  maxBotsPerUniverse: 2000,      // Per universe/organization
};
```

**With 8GB RAM server:**
- 1,000 bots × 30 KB = ~30 MB (memory is NOT the bottleneck)
- **CPU and network bandwidth are the real constraints**

### CPU Considerations

Each bot updates at 60fps (every 16.67ms):
- Behavior update: ~0.01-0.1ms per bot
- Position updates: ~0.01ms per bot
- Message handling: ~0.05ms per message

**CPU Capacity:**
- **1,000 bots**: ~10-100ms per frame (very manageable)
- **5,000 bots**: ~50-500ms per frame (needs optimization)
- **10,000+ bots**: Requires spatial partitioning and update frequency optimization

### Network Bandwidth

**Per Bot Network Usage:**
- Position updates: ~50-100 bytes every 200ms = ~250-500 bytes/sec
- Chat messages: ~100-500 bytes per message (infrequent)
- Protocol overhead: ~10-20%

**Total per bot: ~300-600 bytes/sec**

**For 1,000 bots:**
- ~300-600 KB/sec = ~1.8-3.6 MB/min
- Very manageable on modern networks

## Recommended Limits

### Per User Limits

```typescript
// Suggested limits to prevent abuse:
const USER_LIMITS = {
  maxBotsPerUser: 50,           // Total bots a user can create
  maxBotsPerRoom: 10,           // Bots per room (user's rooms)
  maxBotsPerWorld: 20,          // Bots per world
  maxActiveBotsPerUser: 20,     // Simultaneously active bots
};
```

### Per Server Limits

```typescript
// Server-wide limits:
const SERVER_LIMITS = {
  maxBotsPerServer: 1000,       // Per bot server instance
  maxBotsPerMap: 100,           // Per room/map
  maxBotsPerWorld: 500,         // Per world
  maxBotsPerUniverse: 2000,     // Per organization
  botSpawnRate: 10,             // Bots per second spawn rate
};
```

## Real-World Estimates

### Small Deployment (100 bots)
- **RAM**: ~3-5 MB
- **CPU**: Negligible (<1% of one core)
- **Network**: ~30-60 KB/sec

### Medium Deployment (1,000 bots)
- **RAM**: ~30-50 MB
- **CPU**: ~10-20% of one core
- **Network**: ~300-600 KB/sec

### Large Deployment (10,000 bots)
- **RAM**: ~300-500 MB
- **CPU**: ~1-2 cores (needs optimization)
- **Network**: ~3-6 MB/sec
- **Requires**: Spatial partitioning, update frequency optimization, distributed execution

## Optimization Strategies

### 1. Spatial Partitioning
Only update bots in visible/active areas:

```typescript
// Only update bots within viewport of real players
if (isBotInActiveArea(bot)) {
  bot.update(deltaTime);
}
```

**Benefit**: Reduces CPU usage by 70-90% for large deployments while maintaining visibility

### 2. Update Frequency Optimization
Reduce update frequency for distant bots while keeping them always visible:

```typescript
// Bots are always visible, but update at different rates based on distance
const distanceToNearestPlayer = getDistanceToNearestPlayer(bot);
let updateRate: number;

if (distanceToNearestPlayer < 500) {
  // Nearby: Full updates (60fps)
  updateRate = 60;
  bot.update(deltaTime);
  bot.processAI(); // Full AI processing
} else if (distanceToNearestPlayer < 2000) {
  // Medium distance: Reduced updates (30fps)
  updateRate = 30;
  if (shouldUpdate(30)) {
    bot.update(deltaTime);
    bot.processAI(); // Reduced AI processing
  }
} else {
  // Far away: Minimal updates (10fps)
  updateRate = 10;
  if (shouldUpdate(10)) {
    bot.update(deltaTime);
    // Skip AI processing, just maintain position
  }
}
```

**Benefit**: Reduces CPU usage by 50-80% for distant bots while maintaining full visibility

### 4. Connection Pooling
Reuse WebSocket connections when possible (future optimization)

**Benefit**: Reduces memory overhead

### 5. Message Batching
Batch multiple bot operations together:

```typescript
// Batch position updates
batchPositionUpdates(bots, positions);
```

**Benefit**: Reduces network overhead

## Performance Monitoring

### Key Metrics to Track

1. **CPU Usage**
   - Per bot CPU time
   - Total update loop time
   - Frame rate (should stay at 60fps)

2. **Memory Usage**
   - Per bot memory
   - Total bot memory
   - Memory growth over time

3. **Network Bandwidth**
   - Bytes per second per bot
   - Total network usage
   - Message rate

4. **Bot Activity**
   - Active vs idle bots
   - Conversation rate
   - Message rate

### Monitoring Implementation

```typescript
class BotMetrics {
  private cpuTime: Map<string, number> = new Map();
  private memoryUsage: Map<string, number> = new Map();
  private networkBytes: Map<string, number> = new Map();
  
  trackBot(botId: string) {
    // Track metrics per bot
  }
  
  getAverageCPUPerBot(): number {
    // Calculate average CPU usage
  }
  
  getTotalMemory(): number {
    // Calculate total memory usage
  }
}
```

## Scaling Recommendations

### Phase 1: Start Small (100-500 bots)
- No optimizations needed
- All bots update at 60fps
- Monitor CPU and memory
- Track user behavior

### Phase 2: Medium Scale (1,000-5,000 bots)
- Implement spatial partitioning
- Add update frequency optimization (distant bots at 30fps)
- Monitor and alert on thresholds

### Phase 3: Large Scale (5,000-10,000 bots)
- Full optimization suite
- Update frequency optimization (distant bots at 10fps)
- Distributed execution
- Load balancing
- Auto-scaling bot servers

### Phase 4: Enterprise Scale (10,000+ bots)
- Multi-region deployment
- Advanced caching
- Database optimization
- CDN for bot assets
- Aggressive update frequency optimization

## Best Practices

1. **Start with Conservative Limits**
   - 50 bots per user
   - 100 bots per map
   - 1,000 bots per server

2. **Monitor and Scale**
   - Track CPU usage per bot
   - Monitor memory growth
   - Measure network bandwidth

3. **Implement Optimizations as Needed**
   - Spatial partitioning for 1,000+ bots
   - Update frequency optimization for 5,000+ bots
   - Distributed execution for 10,000+ bots

4. **Resource Monitoring**
   - Track bot count per user/room/world
   - Alert on resource thresholds
   - Auto-scale bot servers

## Configuration Examples

### Development Environment
```typescript
const DEV_LIMITS = {
  maxBotsPerServer: 100,
  maxBotsPerMap: 10,
  maxBotsPerUser: 5,
};
```

### Production Environment
```typescript
const PROD_LIMITS = {
  maxBotsPerServer: 1000,
  maxBotsPerMap: 100,
  maxBotsPerUser: 50,
  enableSpatialPartitioning: true,
  enableUpdateFrequencyOptimization: true,
  updateRate: 60, // fps for nearby bots
  mediumDistanceUpdateRate: 30, // fps
  farDistanceUpdateRate: 10, // fps
};
```

### Enterprise Environment
```typescript
const ENTERPRISE_LIMITS = {
  maxBotsPerServer: 5000,
  maxBotsPerMap: 500,
  maxBotsPerUser: 200,
  enableSpatialPartitioning: true,
  enableUpdateFrequencyOptimization: true,
  enableDistributedExecution: true,
  updateRate: 60, // fps for nearby bots
  mediumDistanceThreshold: 2000, // pixels
  mediumDistanceUpdateRate: 30, // fps
  farDistanceThreshold: 5000, // pixels
  farDistanceUpdateRate: 10, // fps for distant bots
};
```

## Summary

- **Memory**: ~15-35 KB per bot (memory is NOT the bottleneck)
- **CPU**: Main constraint (update loop at 60fps)
- **Network**: ~300-600 bytes/sec per bot
- **Recommended limits**: 50 bots/user, 100 bots/map, 1,000 bots/server
- **Scalability**: Can handle thousands with proper optimization

The system is designed to scale efficiently, with **CPU being the main constraint** rather than memory. With proper optimizations (spatial partitioning, update frequency optimization), you can support **10,000+ bots on a single server**. **All bots remain visible to players** - optimizations reduce update frequency and processing, not visibility.

