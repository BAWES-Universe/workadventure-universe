# Continuous Iteration & Self-Improvement Workflow

This guide explains how to continuously test, iterate, and improve bot behavior using the self-improvement system.

## Overview

The goal is to create a feedback loop where you can:
1. **Test scenarios** - Run test cases to identify issues
2. **Analyze metrics** - See what's wrong (repetition, personality violations, etc.)
3. **Get recommendations** - System suggests fixes
4. **Apply improvements** - Test fixes and compare results
5. **Iterate** - Repeat until perfect

## Quick Start

### 1. Enable Development Mode

Set environment variables:
```bash
export NODE_ENV=development
export ENABLE_TESTING=true
export ENABLE_IMPROVEMENT=true
export ENABLE_BOT_DEBUG=true
```

### 2. Start Collecting Metrics

Metrics are automatically collected when bots interact. To see them:
```bash
# Get metrics for a bot
GET /api/bots/:botId/metrics?limit=100
```

### 3. Run Test Scenarios

Create test scenarios for specific behaviors:

```typescript
// Example: Test personality compliance
const testSuite = {
    id: 'personality-tests',
    name: 'Personality Compliance Tests',
    botId: 'bot-123',
    testCases: [
        {
            id: 'mean-bot-test',
            name: 'Mean bot should be mean',
            botId: 'bot-123',
            chatInstructions: 'You are a mean, angry bot. Never apologize.',
            input: 'Hello',
            expectedBehavior: {
                shouldNotContain: ['happy', 'glad', 'sorry'],
                personalityCompliance: true,
            },
        },
        {
            id: 'friendly-bot-test',
            name: 'Friendly bot should be friendly',
            botId: 'bot-123',
            chatInstructions: 'You are a friendly, helpful bot.',
            input: 'Hello',
            expectedBehavior: {
                shouldContain: ['hello', 'hi', 'help'],
                personalityCompliance: true,
            },
        },
    ],
};

// Run via API
POST /api/bots/test/run-suite
{
  "testSuite": testSuite,
  "botId": "bot-123"
}
```

### 4. Analyze Issues

Get improvement recommendations:
```bash
GET /api/bots/improve/recommendations?botId=bot-123
```

This returns:
- Issues found (repetition, personality violations, etc.)
- Suggested fixes
- Priority levels
- Estimated impact

### 5. Run Improvement Cycle

Apply improvements and test:
```bash
POST /api/bots/improve/cycle
{
  "botId": "bot-123"
}
```

This will:
1. Get baseline metrics
2. Analyze and get recommendations
3. Apply fixes (in development)
4. Test fixes
5. Compare before/after metrics
6. Generate report

### 6. Review Results

Check the improvement report:
```json
{
  "id": "improvement-123",
  "botId": "bot-123",
  "metricsBefore": {
    "repetitionScore": 0.4,
    "personalityCompliance": 0.7
  },
  "metricsAfter": {
    "repetitionScore": 0.1,
    "personalityCompliance": 0.9
  },
  "success": true,
  "report": "..."
}
```

## Iteration Workflow

### Step 1: Identify Problem

**Option A: From Real Conversations**
- View conversations in Admin Portal
- Identify problematic responses
- Note specific issues (repetition, wrong personality, etc.)

**Option B: From Test Scenarios**
- Create test cases for specific behaviors
- Run test suite
- Review failed tests

**Option C: From Metrics**
- Check metrics dashboard
- Look for high repetition scores
- Check personality compliance scores

### Step 2: Create Test Case

Capture the problem as a test:
```typescript
const problemTest = {
    id: 'problem-1',
    name: 'Bot repeats same greeting',
    botId: 'bot-123',
    chatInstructions: 'You are a friendly bot.',
    input: 'Hello',
    expectedBehavior: {
        shouldNotContain: ['I\'m not in the mood'], // The problematic response
        personalityCompliance: true,
    },
};
```

### Step 3: Run Test

```bash
POST /api/bots/test/run-suite
{
  "testSuite": {
    "testCases": [problemTest]
  },
  "botId": "bot-123"
}
```

### Step 4: Get Recommendations

```bash
GET /api/bots/improve/recommendations?botId=bot-123
```

### Step 5: Apply & Test

```bash
POST /api/bots/improve/cycle
{
  "botId": "bot-123"
}
```

### Step 6: Verify Fix

Re-run the test:
```bash
POST /api/bots/test/run-suite
{
  "testSuite": {
    "testCases": [problemTest]
  },
  "botId": "bot-123"
}
```

### Step 7: Iterate

If test still fails:
- Review the improvement report
- Check what was changed
- Adjust test case or recommendations
- Repeat from Step 4

## Common Scenarios

### Scenario 1: Bot Repeats Responses

**Problem**: Bot keeps saying the same thing

**Test Case**:
```typescript
{
    id: 'no-repetition',
    name: 'Bot should not repeat responses',
    botId: 'bot-123',
    chatInstructions: 'You are a friendly bot.',
    input: 'Hello',
    expectedBehavior: {
        maxRepetitionScore: 0.2, // Low repetition
    },
};
```

**Fix**: System will suggest prompt changes or code fixes to prevent repetition

### Scenario 2: Personality Violation

**Problem**: Mean bot is being friendly

**Test Case**:
```typescript
{
    id: 'mean-personality',
    name: 'Mean bot must be mean',
    botId: 'bot-123',
    chatInstructions: 'You are a mean, angry bot. Never apologize.',
    input: 'Hello',
    expectedBehavior: {
        shouldNotContain: ['happy', 'glad', 'sorry'],
        personalityCompliance: true,
    },
};
```

**Fix**: System will strengthen personality enforcement

### Scenario 3: Tool Usage Issues

**Problem**: Bot doesn't call tools when it should

**Test Case**:
```typescript
{
    id: 'tool-usage',
    name: 'Bot should navigate when asked',
    botId: 'bot-123',
    chatInstructions: 'You are a helpful bot.',
    input: 'Take me to the office',
    expectedBehavior: {
        shouldCallTool: ['navigate_to'],
        shouldContain: ['follow', 'take you'],
    },
};
```

**Fix**: System will improve tool calling logic

## Continuous Improvement Loop

### Automated Cycle (Development)

Set up a cron job or scheduled task:
```bash
# Every hour, run improvement cycle
0 * * * * curl -X POST http://localhost:3000/api/bots/improve/cycle -d '{"botId":"bot-123"}'
```

### Manual Cycle

1. Monitor metrics dashboard
2. When issues detected, run improvement cycle
3. Review results
4. Deploy if successful

## Best Practices

1. **Start with Test Cases**: Always create test cases for problems you want to fix
2. **Run Tests Before/After**: Compare metrics before and after improvements
3. **Review Recommendations**: Don't blindly apply - review what will change
4. **Preserve Personality**: Never apply improvements that break personality
5. **Iterate Small**: Make small changes, test, then iterate again
6. **Track Progress**: Keep improvement reports to see what worked

## Metrics to Watch

- **Repetition Score**: Should be < 0.2
- **Personality Compliance**: Should be > 0.9
- **System Prompt Leakage**: Should be false
- **Response Time**: Should be < 3000ms
- **Conversation Quality**: Should be > 0.8

## Tools & Endpoints

### Testing
- `POST /api/bots/test/run-suite` - Run test suite
- `POST /api/bots/test/replay` - Replay conversation
- `GET /api/bots/:botId/conversations/problematic` - Find problematic conversations

### Improvement
- `GET /api/bots/improve/recommendations?botId=:botId` - Get recommendations
- `POST /api/bots/improve/cycle` - Run improvement cycle

### Metrics
- `GET /api/bots/:botId/metrics` - Get metrics
- `GET /api/bots/:botId/conversations` - Get conversations

## Next Steps

1. **Create Test Scenarios**: Start with common problems you've seen
2. **Run Initial Tests**: Establish baseline metrics
3. **Identify Issues**: Use metrics and conversations to find problems
4. **Run Improvement Cycle**: Let the system suggest fixes
5. **Verify**: Re-run tests to confirm fixes work
6. **Iterate**: Repeat until perfect
