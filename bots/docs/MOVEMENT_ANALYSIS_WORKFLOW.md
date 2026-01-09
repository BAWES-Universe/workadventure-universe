# Bot Movement Analysis Workflow

## Overview

This document describes the workflow for analyzing bot movement patterns, identifying issues, and making continuous improvements.

**⚠️ IMPORTANT: Movement logging and analysis is ONLY enabled in development mode.**

To enable movement logging, set one of these environment variables:
- `ENABLE_MOVEMENT_LOGGING=true`
- `NODE_ENV=development`

In production, movement logging is completely disabled to:
- Avoid performance overhead
- Prevent security issues (no sensitive movement data exposure)
- Reduce log bloat

## Enabling in Development

Add to your `docker-compose.bots.yaml` or environment:

```yaml
services:
  bot-server:
    environment:
      - ENABLE_MOVEMENT_LOGGING=true
      # OR
      - NODE_ENV=development
```

## Components

### 1. MovementLogger (`bots/utils/MovementLogger.ts`)

Comprehensive logging system that tracks:
- **Movement events**: Every move, stop, waypoint advance
- **Path events**: Path start, end, failures
- **Speed data**: Config speed, effective speed, move distance
- **Position data**: Current position, target position, distances
- **Metadata**: Delta time, waypoint indices, path lengths

### 2. API Endpoints

Access movement data via REST API:

```bash
# Get movement logs for all bots (last 100 events)
curl http://localhost:3001/api/movement/logs

# Get movement logs for specific bot
curl http://localhost:3001/api/movement/logs?botId=<bot-id>&count=50

# Analyze movement patterns for a bot (last 10 seconds)
curl http://localhost:3001/api/movement/analyze/<bot-id>?timeWindow=10000

# Get summary statistics
curl http://localhost:3001/api/movement/summary
```

### 3. Automatic Analysis

The system automatically:
- Logs movement events (throttled to 1 per second per bot)
- Analyzes movement patterns every 30 seconds
- Detects oscillation (back-and-forth movement)
- Logs warnings when issues are detected

## Workflow for Continuous Improvement

### Step 1: Collect Data

```bash
# Watch logs in real-time
docker compose -f docker-compose.yaml -f docker-compose.bots.yaml logs bot-server -f | grep MovementLogger

# Or get recent logs via API
curl http://localhost:3001/api/movement/logs?count=200 | jq
```

### Step 2: Identify Issues

Look for patterns in the logs:

**Speed Issues:**
```
[MovementLogger:xxx] MOVE speed=100 effSpeed=50.0 moveDist=0.800
```
- If `speed` is high but movement looks fast, check `effSpeed` and `moveDist`
- Expected: `effSpeed` should be ~50, `moveDist` should be ~0.8 per frame

**Oscillation:**
```
[MovementAnalysis] Bot xxx: OSCILLATION DETECTED!
```
- Check waypoint advancement frequency
- Look for rapid direction changes in position logs

**Path Failures:**
```
[MovementLogger:xxx] PATH_FAIL
```
- High path failure rate indicates pathfinding issues
- Check if bots are trying to reach unreachable targets

### Step 3: Analyze Specific Bot

```bash
# Get detailed analysis
curl http://localhost:3001/api/movement/analyze/<bot-id>?timeWindow=30000 | jq

# Response includes:
# - averageSpeed: Average movement speed
# - totalDistance: Total distance moved
# - waypointChanges: Number of waypoint advances
# - pathFailures: Number of pathfinding failures
# - oscillationDetected: Boolean flag
```

### Step 4: Review Logs

```bash
# Get recent events for a bot
curl http://localhost:3001/api/movement/logs?botId=<bot-id>&count=100 | jq '.events[] | select(.eventType=="move") | {timestamp, speed, effectiveSpeed, moveDistance, distanceToTarget}'
```

### Step 5: Make Improvements

Based on analysis:

1. **Speed Issues:**
   - Check if `effectiveSpeed` calculation is correct
   - Verify `moveDistance` matches expected values
   - Adjust speed multipliers if needed

2. **Oscillation:**
   - Increase waypoint threshold
   - Improve path smoothing
   - Add hysteresis to waypoint advancement

3. **Path Failures:**
   - Check collision grid accuracy
   - Verify target positions are valid
   - Improve pathfinding fallback logic

### Step 6: Test and Iterate

1. Make code changes
2. Rebuild and restart: `docker compose -f docker-compose.yaml -f docker-compose.bots.yaml restart bot-server`
3. Monitor logs for improvements
4. Repeat analysis cycle

## Example Analysis Session

```bash
# 1. Get summary
curl http://localhost:3001/api/movement/summary | jq

# 2. Identify problematic bot
curl http://localhost:3001/api/movement/logs | jq '.events[] | select(.eventType=="path_fail") | .botId' | sort | uniq -c

# 3. Analyze specific bot
BOT_ID="<bot-id>"
curl http://localhost:3001/api/movement/analyze/$BOT_ID | jq

# 4. Get detailed movement log
curl http://localhost:3001/api/movement/logs?botId=$BOT_ID&count=50 | jq '.events[] | {type: .eventType, speed: .speed, effSpeed: .effectiveSpeed, moveDist: .moveDistance, distToTarget: .distanceToTarget}'
```

## Log Format

Movement logs follow this format:
```
[MovementLogger:<bot-id>] <EVENT_TYPE> pos=(x,y) target=(x,y) speed=100 effSpeed=50.0 moveDist=0.800 deltaT=33 waypoint=2/10 distToTarget=45.2 [metadata] frames=123
```

**Key Fields:**
- `pos`: Current bot position
- `target`: Target waypoint position
- `speed`: Config speed value
- `effSpeed`: Effective speed after adjustments
- `moveDist`: Actual movement distance this frame
- `deltaT`: Frame delta time in ms
- `waypoint`: Current waypoint index / total path length
- `distToTarget`: Distance to current target waypoint

## Continuous Monitoring

The system automatically logs analysis every 30 seconds:
- Detects oscillation
- Tracks average speeds
- Monitors path failures
- Reports summary statistics

Watch for warnings in logs:
```
[MovementAnalysis] Bot xxx: OSCILLATION DETECTED!
```

## Next Steps

1. **Add metrics export**: Export to Prometheus/Grafana for visualization
2. **Add alerts**: Alert when oscillation or high path failure rate detected
3. **Add replay**: Replay movement logs to visualize bot paths
4. **Add comparison**: Compare movement patterns before/after changes

