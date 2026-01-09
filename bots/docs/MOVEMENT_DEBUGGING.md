# Bot Movement Debugging Guide

## Current Status

Movement logging and analysis system is set up and ready. Here's what we have:

### ✅ Implemented

1. **MovementLogger** - Comprehensive logging system
2. **API Endpoints** - REST API for accessing movement data
3. **Automatic Analysis** - Periodic analysis every 30 seconds
4. **Dev-Only Mode** - Only enabled when `ENABLE_MOVEMENT_LOGGING=true`

### 🔍 How to Use

#### 1. Enable Logging

Make sure `.env` has:
```
ENABLE_MOVEMENT_LOGGING=true
```

And `docker-compose.bots.yaml` passes it through (already configured).

#### 2. Check if Logging is Active

```bash
# Check startup logs
docker compose -f docker-compose.yaml -f docker-compose.bots.yaml logs bot-server | grep "Movement analysis"

# Should see: "[BotServer] Movement analysis started (DEV MODE - every 30s)"
```

#### 3. View Movement Logs

```bash
# Real-time logs
docker compose -f docker-compose.yaml -f docker-compose.bots.yaml logs bot-server -f | grep MovementLogger

# Or via API
curl http://localhost:3001/api/movement/logs?count=50 | jq
```

#### 4. Analyze Movement

```bash
# Get summary
curl http://localhost:3001/api/movement/summary | jq

# Analyze specific bot
curl http://localhost:3001/api/movement/analyze/<bot-id>?timeWindow=30000 | jq

# Use the analysis script
./bots/scripts/analyze-movement.sh
```

### 📊 What to Look For

**Speed Issues:**
- Check `speed` vs `effectiveSpeed` in logs
- Expected: `speed=100` → `effectiveSpeed=50` (halved)
- Expected: `moveDistance` should be ~0.8 per frame (50 * 0.016)

**Oscillation:**
- Look for rapid waypoint advances
- Check `oscillationDetected: true` in analysis
- Watch for back-and-forth position changes

**Path Failures:**
- High `pathFailures` count
- Many "No path found" messages
- Bots falling back to direct movement

### 🛠️ Next Steps

1. **Wait for bots to move** - Logs only appear when bots are actually moving
2. **Check API** - Once bots move, data will be available via API
3. **Analyze patterns** - Use the analysis endpoints to identify issues
4. **Make improvements** - Based on data, adjust speed, thresholds, etc.

### 🔧 Troubleshooting

If no logs appear:
1. Verify `ENABLE_MOVEMENT_LOGGING=true` in `.env`
2. Rebuild: `docker compose -f docker-compose.yaml -f docker-compose.bots.yaml build bot-server`
3. Restart: `docker compose -f docker-compose.yaml -f docker-compose.bots.yaml restart bot-server`
4. Check startup logs for "Movement analysis started" message
5. Wait for bots to actually move (logs only appear during movement)

### 📝 Current Issues to Investigate

From logs, I see:
- Many "No path found" errors
- "Start position is in a wall" warnings
- Bots may be spawning in invalid positions

These need investigation once movement logging is active.

