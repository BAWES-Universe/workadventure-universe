# Getting Started with Self-Improvement

The self-improvement system is **built for the AI to use automatically** - it runs continuously in the background to improve bots.

## Quick Start

### 1. Enable Development Mode

The improvement system **only runs in development mode**:

```bash
export NODE_ENV=development
```

### 2. Start Bot Server

```bash
cd bots
npm run dev
```

You should see:
```
[BotServer] Improvement scheduler started (DEV MODE ONLY)
```

### 3. System is Now Active

The improvement scheduler will:
- **Run every hour** (configurable)
- **Analyze all active bots**
- **Generate recommendations**
- **Log findings** for review

## What Happens Automatically

### Every Hour:

1. **Check all bots** - Find active bots
2. **Analyze metrics** - Look for issues (repetition, personality violations, etc.)
3. **Generate recommendations** - Suggest fixes
4. **Log results** - Output findings to console

### Example Log Output:

```
[ImprovementScheduler] Running improvement cycle for 2 bot(s)
[ImprovementScheduler] Found 3 recommendations for bot bot-123
[ImprovementScheduler]   - [HIGH] repetition_fix: High repetition detected (average: 45.2%)
[ImprovementScheduler]   - [MEDIUM] personality_compliance: Low personality compliance (average: 72.1%)
[ImprovementScheduler]   - [LOW] performance: Slow response time (average: 5234ms)
```

## Manual Commands (Optional)

You can also manually trigger improvements:

### Check Status

```bash
./bots/scripts/check-status.sh
```

### Get Recommendations for a Bot

```bash
./bots/scripts/iterate.sh bot-123 analyze
```

### Run Full Improvement Cycle

```bash
./bots/scripts/iterate.sh bot-123 cycle
```

## Configuration

### Change Improvement Interval

```bash
export IMPROVEMENT_INTERVAL_MS=1800000  # 30 minutes (default: 1 hour)
```

### Enable Auto-Apply (Development Only)

```bash
export IMPROVEMENT_AUTO_APPLY=true
```

⚠️ **Warning**: Auto-apply will automatically apply fixes. Only use in development.

## What Gets Improved

The system automatically detects and suggests fixes for:

- **Repetition**: High repetition scores → suggests prompt changes
- **Personality Violations**: Low compliance → strengthens personality instructions
- **System Prompt Leakage**: Leaked prompts → adds filtering
- **Performance**: Slow responses → suggests context optimization

## Monitoring

### Check Logs

The scheduler logs all activity:
- When it runs
- What it finds
- Recommendations generated
- Any errors

### Check Metrics

```bash
curl http://localhost:3001/api/bots/bot-123/metrics?limit=10
```

## Production

**The improvement system is automatically disabled in production** - no configuration needed. Production only runs:
- Metrics collection (lightweight)
- Conversation storage (fire-and-forget)
- Normal bot operations

## Troubleshooting

### Scheduler Not Running

1. Check `NODE_ENV=development`
2. Restart bot server
3. Check logs for errors

### No Recommendations

1. Ensure bots are active and having conversations
2. Need at least 50 metrics before recommendations
3. Check metrics: `GET /api/bots/:botId/metrics`

### Endpoints Return 403

- Improvement endpoints are blocked in production
- Set `NODE_ENV=development`

## Next Steps

- The system runs automatically - just let it work!
- Check logs periodically to see what it finds
- Review recommendations in the logs
- System continuously improves bots over time
