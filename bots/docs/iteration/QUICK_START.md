# Quick Start: Continuous Iteration

Get started with continuous bot improvement in 5 minutes.

## Setup

1. **Enable development mode:**
```bash
export NODE_ENV=development
export ENABLE_TESTING=true
export ENABLE_IMPROVEMENT=true
export ENABLE_BOT_DEBUG=true
```

2. **Start your bot server** (with Admin API configured)

3. **Have a bot running** (spawn a bot via Admin API)

## Quick Iteration Cycle

### Option 1: Use the Script

```bash
# Full cycle: analyze -> improve -> test
./bots/scripts/iterate.sh bot-123 cycle

# Just get recommendations
./bots/scripts/iterate.sh bot-123 analyze

# Just run improvement
./bots/scripts/iterate.sh bot-123 improve
```

### Option 2: Use API Directly

```bash
# 1. Get recommendations
curl http://localhost:3000/api/bots/improve/recommendations?botId=bot-123

# 2. Run improvement cycle
curl -X POST http://localhost:3000/api/bots/improve/cycle \
  -H "Content-Type: application/json" \
  -d '{"botId":"bot-123"}'

# 3. Check metrics
curl http://localhost:3000/api/bots/bot-123/metrics?limit=10
```

## Common Workflows

### Fix Repetition Issues

1. **Identify**: Check metrics for high `repetitionScore`
2. **Analyze**: `GET /api/bots/improve/recommendations?botId=bot-123`
3. **Improve**: `POST /api/bots/improve/cycle`
4. **Verify**: Check metrics again

### Fix Personality Violations

1. **Create test case** for the personality issue
2. **Run test**: `POST /api/bots/test/run-suite`
3. **Get recommendations**: `GET /api/bots/improve/recommendations`
4. **Improve**: `POST /api/bots/improve/cycle`
5. **Re-run test**: Verify fix

### Test Specific Scenarios

1. **Create test case**:
```json
{
  "id": "test-1",
  "name": "Bot should greet friendly",
  "botId": "bot-123",
  "chatInstructions": "You are a friendly bot.",
  "input": "Hello",
  "expectedBehavior": {
    "shouldContain": ["hello", "hi"],
    "personalityCompliance": true
  }
}
```

2. **Run test**:
```bash
curl -X POST http://localhost:3000/api/bots/test/run-suite \
  -H "Content-Type: application/json" \
  -d '{"testSuite":{"testCases":[testCase]},"botId":"bot-123"}'
```

3. **If it fails, improve and re-test**

## What Gets Improved

The system automatically improves:
- **Repetition**: Reduces repeated responses
- **Personality Compliance**: Ensures bots match their instructions
- **Response Quality**: Improves conversation quality
- **Tool Usage**: Better tool calling
- **Performance**: Faster response times

## Monitoring Progress

Check metrics regularly:
```bash
curl http://localhost:3000/api/bots/bot-123/metrics?limit=100 | \
  jq '[.[] | .metrics] | add | {
    repetitionScore,
    personalityCompliance,
    conversationQuality,
    responseTime
  }'
```

## Next Steps

- Read [ITERATION_WORKFLOW.md](./ITERATION_WORKFLOW.md) for detailed workflow
- Read [TESTING_GUIDE.md](../testing/TESTING_GUIDE.md) for test case examples
- Read [SELF_IMPROVEMENT.md](../improvement/SELF_IMPROVEMENT.md) for improvement details
