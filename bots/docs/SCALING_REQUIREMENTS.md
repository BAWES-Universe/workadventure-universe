# Scaling Requirements

## Overview

This document outlines the scaling requirements for the bot system, including infrastructure needs, performance targets, and scaling strategies for different deployment sizes.

## Infrastructure Requirements by Scale

### Small Deployment (100-500 bots)

**Server Requirements:**
- **CPU**: 1-2 cores
- **RAM**: 2-4 GB
- **Network**: 10 Mbps
- **Storage**: 100 MB (configs + metrics)

**Database Requirements:**
- **Type**: Single PostgreSQL/MySQL instance
- **CPU**: 1 core
- **RAM**: 1-2 GB
- **Storage**: 500 MB
- **Connections**: 10-20

**Performance Targets:**
- Bot update latency: <16ms (60fps)
- API response time: <100ms (p95)
- Database query time: <50ms (p95)

**Scaling Strategy:**
- Single server deployment
- No special optimizations needed
- Standard database configuration

### Medium Deployment (1,000-5,000 bots)

**Server Requirements:**
- **CPU**: 4-8 cores
- **RAM**: 8-16 GB
- **Network**: 100 Mbps
- **Storage**: 500 MB - 2 GB

**Database Requirements:**
- **Type**: PostgreSQL/MySQL with read replicas
- **CPU**: 2-4 cores
- **RAM**: 4-8 GB
- **Storage**: 2-5 GB
- **Connections**: 50-100

**Performance Targets:**
- Bot update latency: <16ms (60fps)
- API response time: <200ms (p95)
- Database query time: <100ms (p95)

**Scaling Strategy:**
- Single bot server with spatial partitioning
- Update frequency optimization enabled
- Database with read replicas
- Caching layer (Redis)

**Optimizations Required:**
- Spatial partitioning for bot updates
- Update frequency optimization (distant bots at 30fps)
- Database indexing
- Connection pooling

### Large Deployment (5,000-10,000 bots)

**Server Requirements:**
- **CPU**: 8-16 cores
- **RAM**: 16-32 GB
- **Network**: 1 Gbps
- **Storage**: 2-5 GB

**Database Requirements:**
- **Type**: PostgreSQL/MySQL cluster
- **CPU**: 4-8 cores (per node)
- **RAM**: 8-16 GB (per node)
- **Storage**: 5-10 GB
- **Connections**: 100-200

**Performance Targets:**
- Bot update latency: <16ms (60fps) for nearby bots
- API response time: <300ms (p95)
- Database query time: <150ms (p95)

**Scaling Strategy:**
- Multiple bot server instances (load balanced)
- Full optimization suite enabled
- Database cluster with read replicas
- Distributed caching (Redis cluster)
- Message queue for coordination

**Optimizations Required:**
- Spatial partitioning
- Update frequency optimization (distant bots at 10fps)
- Distributed execution
- Database partitioning
- Aggressive caching

### Enterprise Deployment (10,000+ bots)

**Server Requirements:**
- **CPU**: 16+ cores (per instance)
- **RAM**: 32+ GB (per instance)
- **Network**: 10 Gbps
- **Storage**: 5-20 GB

**Database Requirements:**
- **Type**: Distributed database cluster
- **CPU**: 8+ cores (per node)
- **RAM**: 16+ GB (per node)
- **Storage**: 10-50 GB
- **Connections**: 200+

**Performance Targets:**
- Bot update latency: <16ms (60fps) for nearby bots, <100ms for distant
- API response time: <500ms (p95)
- Database query time: <200ms (p95)

**Scaling Strategy:**
- Multi-region deployment
- Auto-scaling bot servers
- Database sharding
- CDN for static assets
- Advanced monitoring and alerting

**Optimizations Required:**
- All previous optimizations
- Multi-region support
- Database sharding
- Advanced load balancing
- Real-time monitoring

## Performance Metrics

### Bot Update Performance

**Target Update Rates:**
- Nearby bots (<500px): 60fps (16.67ms per update)
- Medium distance (500-2000px): 30fps (33.33ms per update)
- Distant bots (>2000px): 10fps (100ms per update)

**CPU Usage per Bot:**
- Nearby: ~0.01-0.1ms per update
- Medium: ~0.005-0.05ms per update
- Distant: ~0.001-0.01ms per update

**Total CPU Capacity:**
- 1,000 bots (all nearby): ~10-100ms per frame = 1-10% of one core
- 5,000 bots (mixed): ~50-500ms per frame = 5-50% of one core
- 10,000 bots (with optimization): ~100-1000ms per frame = 1-10 cores

### Network Performance

**Bandwidth per Bot:**
- Position updates: ~250-500 bytes/sec
- Chat messages: ~100-500 bytes per message (infrequent)
- Total: ~300-600 bytes/sec per bot

**Total Bandwidth:**
- 1,000 bots: ~300-600 KB/sec = ~1.8-3.6 MB/min
- 5,000 bots: ~1.5-3 MB/sec = ~90-180 MB/min
- 10,000 bots: ~3-6 MB/sec = ~180-360 MB/min

### Database Performance

**Write Throughput:**
- Configuration: ~1-10 writes/sec
- Usage metrics: ~1 write per bot per minute
- Conversations: ~10-50 events/sec per 1,000 bots
- Messages: ~50-200 events/sec per 1,000 bots

**Read Throughput:**
- Configuration queries: ~1-10 reads/sec
- Usage analytics: ~1-5 queries/sec
- Peak: ~50-100 queries/sec

**Storage Growth:**
- Configurations: ~1-5 MB/month
- Usage metrics: ~5 MB/month
- Conversations (90-day retention): ~60 MB/month per 10K conversations/day
- Messages (90-day retention): ~450 MB/month per 100K messages/day

## Scaling Strategies

### Horizontal Scaling

**Bot Servers:**
- Deploy multiple bot server instances
- Load balance bot distribution
- Use message queue (Redis/RabbitMQ) for coordination
- Shared bot registry (Redis)

**Database:**
- Read replicas for analytics queries
- Write sharding for high write volume
- Connection pooling per instance

### Vertical Scaling

**Bot Servers:**
- Increase CPU cores for more bots
- Increase RAM for more concurrent bots
- Faster network for higher bandwidth

**Database:**
- Larger instance for more storage
- More CPU for faster queries
- More RAM for better caching

### Optimization Strategies

**Phase 1: Basic (1,000 bots)**
- No optimizations needed
- Standard configuration

**Phase 2: Medium (5,000 bots)**
- Spatial partitioning
- Update frequency optimization (30fps for distant)
- Database indexing
- Basic caching

**Phase 3: Large (10,000 bots)**
- All Phase 2 optimizations
- Update frequency optimization (10fps for distant)
- Distributed execution
- Database read replicas
- Redis caching

**Phase 4: Enterprise (10,000+ bots)**
- All Phase 3 optimizations
- Multi-region deployment
- Database sharding
- Advanced load balancing
- CDN integration

## Resource Limits

### Per Server Limits

```typescript
const SERVER_LIMITS = {
  maxBotsPerServer: 1000,        // Conservative
  maxBotsPerServerOptimized: 5000, // With optimizations
  maxBotsPerServerEnterprise: 10000, // With full optimization suite
  
  // CPU limits
  maxCPUUsage: 80,               // Percentage
  targetUpdateTime: 16.67,       // ms (60fps)
  
  // Memory limits
  maxMemoryPerBot: 50,           // KB
  maxTotalMemory: 32 * 1024,     // GB
  
  // Network limits
  maxBandwidthPerBot: 1,         // KB/sec
  maxTotalBandwidth: 100,        // MB/sec
};
```

### Per User/Room/World Limits

```typescript
const LIMITS = {
  maxBotsPerUser: 50,
  maxBotsPerRoom: 100,
  maxBotsPerWorld: 500,
  maxBotsPerUniverse: 2000,
  
  maxActiveBotsPerUser: 20,
  maxConcurrentConversationsPerBot: 10,
};
```

## Monitoring Requirements

### Key Metrics to Monitor

**Bot Server:**
- CPU usage (per core and total)
- Memory usage (per bot and total)
- Network bandwidth (in/out)
- Bot count (active/total)
- Update loop time (p50, p95, p99)
- WebSocket connection count

**Database:**
- Query time (p50, p95, p99)
- Write throughput (writes/sec)
- Read throughput (reads/sec)
- Connection count
- Storage usage
- Replication lag (if using replicas)

**Admin API:**
- Request rate (requests/sec)
- Response time (p50, p95, p99)
- Error rate (errors/sec)
- Bot configuration operations
- Usage metric writes

### Alert Thresholds

**Critical Alerts:**
- CPU usage > 90%
- Memory usage > 90%
- Update loop time > 100ms (p95)
- Database query time > 1 second (p95)
- Error rate > 1%

**Warning Alerts:**
- CPU usage > 70%
- Memory usage > 70%
- Update loop time > 50ms (p95)
- Database query time > 500ms (p95)
- Error rate > 0.5%

## Auto-Scaling Configuration

### Bot Server Auto-Scaling

**Triggers:**
- CPU usage > 70% for 5 minutes → Scale up
- CPU usage < 30% for 15 minutes → Scale down
- Bot count > 80% of server capacity → Scale up
- Memory usage > 80% → Scale up

**Scaling Rules:**
- Min instances: 1
- Max instances: 10
- Scale up: +1 instance
- Scale down: -1 instance (with 5-minute cooldown)

### Database Auto-Scaling

**Triggers:**
- CPU usage > 70% for 10 minutes → Scale up
- Storage usage > 80% → Scale up storage
- Connection count > 80% of max → Scale up

**Scaling Rules:**
- Min instance size: Small
- Max instance size: XLarge
- Read replicas: Add when read load > 50% of write load

## Cost Estimates

### Small Deployment (1,000 bots)
- Bot Server: $50-100/month
- Database: $50-100/month
- **Total: $100-200/month**

### Medium Deployment (5,000 bots)
- Bot Servers: $200-400/month
- Database: $200-300/month
- Caching (Redis): $50-100/month
- **Total: $450-800/month**

### Large Deployment (10,000 bots)
- Bot Servers: $500-1000/month
- Database Cluster: $500-800/month
- Caching (Redis Cluster): $200-400/month
- Load Balancer: $50-100/month
- **Total: $1,250-2,300/month**

### Enterprise Deployment (10,000+ bots)
- Bot Servers (Multi-region): $2,000-5,000/month
- Database Cluster: $1,000-2,000/month
- Caching: $500-1,000/month
- CDN: $200-500/month
- Monitoring: $100-200/month
- **Total: $3,800-8,700/month**

*Note: Costs are estimates and vary by cloud provider and region*

## Disaster Recovery

### Backup Requirements

**Bot Configurations:**
- Backup frequency: Daily
- Retention: 30 days
- Location: Separate region/zone

**Usage Metrics:**
- Backup frequency: Daily
- Retention: 90 days
- Location: Separate region/zone

**Database:**
- Point-in-time recovery: Enabled
- Backup frequency: Every 6 hours
- Retention: 7 days

### Recovery Time Objectives (RTO)

- Bot configurations: < 1 hour
- Usage metrics: < 4 hours
- Full system: < 24 hours

### Recovery Point Objectives (RPO)

- Bot configurations: < 1 hour
- Usage metrics: < 6 hours
- Full system: < 24 hours

## Summary

The bot system is designed to scale from small deployments (100 bots) to enterprise scale (10,000+ bots) with appropriate infrastructure and optimizations. Key scaling factors:

1. **CPU**: Main constraint, addressed through optimizations
2. **Memory**: Not a bottleneck (~15-35 KB per bot)
3. **Network**: Manageable with proper bandwidth
4. **Database**: Requires proper indexing and scaling strategy
5. **Optimizations**: Critical for 5,000+ bots

Start with conservative limits and scale based on actual usage patterns and performance metrics.

