# AutoPilot Continuous Improvement Workflow

## Overview

The AutoPilot system runs **continuously** (every 30 seconds) to test bots, detect issues, and create improvement task files. **You (the AI assistant) analyze these tasks and improve the code/system prompts.**

## How It Works

### 1. Continuous Testing (Every 30 Seconds)

AutoPilot automatically:
- Runs test scenarios on all active bots
- Detects test failures
- Collects metrics (repetition, personality compliance, etc.)
- Creates improvement task files when issues are found

### 2. Task File Creation

When tests fail or metrics show issues, AutoPilot creates a task file:

**Location:** `bots/improvement-tasks/task-{timestamp}-{botId}.json`

**Task File Structure:**
```json
{
  "id": "task-1234567890-abc12345",
  "botId": "bot-123",
  "timestamp": 1234567890,
  "testResults": {
    "summary": {
      "total": 3,
      "passed": 1,
      "failed": 2
    },
    "results": [...]
  },
  "metrics": {
    "repetitionScore": 0.45,
    "personalityCompliance": 0.72,
    "systemPromptLeakage": 0.1
  },
  "failedTests": [
    {
      "testCaseId": "test-1",
      "name": "Bot should not repeat responses",
      "input": "Hello",
      "actualResponse": "Hello! How can I help you?",
      "errors": ["Repetition score too high: 0.45"]
    }
  ],
  "recommendations": [
    {
      "type": "repetition_fix",
      "priority": "high",
      "description": "High repetition detected (average: 45%)",
      "suggestedChanges": {
        "prompt": "Add explicit instruction to vary responses..."
      }
    }
  ],
  "priority": "high",
  "botConfig": {
    "chatInstructions": "You are a helpful bot.",
    "behaviorType": "idle"
  }
}
```

### 3. AI Analysis & Improvement

**You (the AI assistant) should:**

1. **Monitor task files:**
   ```bash
   ls -lt bots/improvement-tasks/*.json | head -5
   ```

2. **Read task files:**
   ```bash
   cat bots/improvement-tasks/task-*.json | jq .
   ```

3. **Analyze the issues:**
   - Review failed tests
   - Check metrics (repetition, personality compliance, etc.)
   - Understand root causes

4. **Improve the code:**
   - **System prompts** in `AIService.ts` (lines 246-283)
   - **Code logic** in `ResponseProcessor.ts`, `RepetitionDetector.ts`, etc.
   - **Test case generation** in `AutoPilotImprovement.ts`

5. **Apply improvements:**
   - Modify code files directly
   - System automatically re-tests in 30 seconds
   - Verify improvements worked

6. **Task cleanup (automatic):**
   - When tests pass, AutoPilot automatically deletes task files older than 5 minutes
   - This prevents folder bloat while keeping recent issues visible
   - You can also manually clean up: `bash bots/scripts/cleanup-resolved-tasks.sh`

### 4. Fast Iteration Loop

```
Every 30 seconds:
  1. AutoPilot runs tests
  2. If failures → creates task file
  3. You see task file → analyze & improve code
  4. System re-tests in 30 seconds
  5. If fixed → resolve task
  6. If still failing → iterate again
```

## What Gets Improved

### System Prompts (AIService.ts)

**Location:** `bots/ai/AIService.ts` lines 246-283

**What to improve:**
- Technical response guidelines
- Anti-hallucination rules
- Location question handling
- Tool calling instructions
- Context usage rules

**Example improvement:**
```typescript
// Before:
systemPrompt += `\n\n- Vary responses - never repeat the same answer`;

// After (if repetition still high):
systemPrompt += `\n\n- **CRITICAL: Vary responses - never repeat the same answer. Check conversation history before responding. If you said something similar recently, say it differently or skip redundant information.**`;
```

### Code Logic

**Files to improve:**
- `bots/ai/ResponseProcessor.ts` - Response cleaning, repetition detection
- `bots/ai/RepetitionDetector.ts` - Repetition scoring
- `bots/ai/PersonalityComplianceValidator.ts` - Personality checking
- `bots/services/AutoPilotImprovement.ts` - Test case generation

**Example improvement:**
```typescript
// If repetition detector isn't catching issues:
// Improve the similarity scoring algorithm
// Add more context to repetition detection
// Strengthen the cleaning logic
```

## Workflow Steps

### Step 1: Check for New Tasks

```bash
# List recent task files
ls -lt bots/improvement-tasks/*.json | head -5

# Read a task file
cat bots/improvement-tasks/task-*.json | jq .
```

### Step 2: Analyze the Issue

Look at:
- **Failed tests**: What exactly failed?
- **Metrics**: What's wrong? (repetition, personality, etc.)
- **Recommendations**: What does the system suggest?
- **Bot config**: What's the bot's personality/instructions?

### Step 3: Identify Root Cause

- **Repetition high?** → Improve system prompt or RepetitionDetector
- **Personality violation?** → Strengthen personality rules in system prompt
- **System prompt leakage?** → Improve ResponseProcessor cleaning
- **Test failing?** → Fix the underlying issue

### Step 4: Improve the Code

**For system prompts:**
- Edit `bots/ai/AIService.ts` lines 246-283
- Strengthen rules that are failing
- Add explicit instructions for detected issues

**For code logic:**
- Edit the relevant file (ResponseProcessor, RepetitionDetector, etc.)
- Fix the algorithm/logic
- Add better detection/cleaning

### Step 5: Verify Improvement

- Wait 30 seconds (next test cycle)
- Check if tests pass
- Check if metrics improved
- If still failing, iterate again

### Step 6: Resolve Task

```bash
# Delete task file when fixed
rm bots/improvement-tasks/task-{id}.json
```

## Best Practices

### 1. Focus on High-Priority Tasks First

Tasks are prioritized:
- `critical` - Fix immediately
- `high` - Fix soon
- `medium` - Fix when possible
- `low` - Nice to have

### 2. Improve Systematically

- **One issue at a time**: Don't try to fix everything at once
- **Test after each change**: Verify improvement before moving on
- **Track what works**: Remember what fixes worked

### 3. Improve the Right Thing

- **System prompts** for behavior/rules issues
- **Code logic** for detection/processing issues
- **Test cases** if tests are wrong

### 4. Don't Touch User Configs

- **Never modify** `chatInstructions` in bot configs (user's personality)
- **Only improve** system prompts and code logic
- **User configs** are their choice - we improve the system, not their bots

## Example Workflow

### Scenario: Bot Repeating Responses

1. **Task file created:**
   ```json
   {
     "failedTests": [{
       "name": "Bot should not repeat responses",
       "errors": ["Repetition score: 0.45 (max: 0.2)"]
     }],
     "metrics": {
       "repetitionScore": 0.45
     }
   }
   ```

2. **You analyze:**
   - Repetition is high (0.45, should be < 0.2)
   - System prompt says "vary responses" but it's not strong enough

3. **You improve:**
   - Edit `AIService.ts` line 254
   - Strengthen the repetition rule:
   ```typescript
   // Before:
   "- Vary responses - never repeat the same answer for different questions"
   
   // After:
   "- **CRITICAL: Vary responses - never repeat the same answer. Check conversation history - if you said something similar in the last 3 messages, say it completely differently or skip redundant information.**"
   ```

4. **System re-tests in 30 seconds:**
   - Tests pass → resolve task
   - Tests still fail → iterate again

## Configuration

### Environment Variables

```bash
# Test interval (default: 30 seconds)
AUTOPILOT_TEST_INTERVAL_MS=30000

# Improvement check interval (default: 1 minute)
AUTOPILOT_IMPROVEMENT_INTERVAL_MS=60000

# Tasks directory (default: bots/improvement-tasks)
IMPROVEMENT_TASKS_DIR=./bots/improvement-tasks

# Auto-apply (default: true in dev)
AUTOPILOT_AUTO_APPLY=true

# Max iterations per bot (default: 50)
AUTOPILOT_MAX_ITERATIONS=50
```

### Docker Compose

Already configured in `docker-compose.bots.yaml`:
- `NODE_ENV: development` ✓
- AutoPilot starts automatically ✓

## Monitoring

### Check Task Files

```bash
# List all tasks
ls -lt bots/improvement-tasks/*.json

# Count pending tasks
ls bots/improvement-tasks/*.json | wc -l

# View latest task
cat $(ls -t bots/improvement-tasks/*.json | head -1) | jq .
```

### Check Logs

```bash
# Watch AutoPilot activity
docker-compose logs -f bot-server | grep AutoPilot
```

### Check Test Results

```bash
# View recent test runs
docker-compose logs bot-server | grep "AutoPilot.*test"
```

## Troubleshooting

### No Task Files Created

1. Check if AutoPilot is running:
   ```bash
   docker-compose logs bot-server | grep "AutoPilot.*Starting"
   ```

2. Check if bots are active:
   ```bash
   curl http://localhost:3001/api/bots
   ```

3. Check if bots have enough metrics (need at least 5)

### Tasks Not Being Resolved

- Tasks are just files - delete them when fixed:
  ```bash
  rm bots/improvement-tasks/task-*.json
  ```

### Tests Not Running

- Check test interval (should be 30 seconds)
- Check if bots are active
- Check if metrics threshold is met

## Key Points

1. **Fast iteration**: Tests run every 30 seconds
2. **Task files**: Issues are written to files for you to analyze
3. **You improve**: AI assistant (you) reads tasks and improves code
4. **Auto re-test**: System automatically re-tests after code changes
5. **Continuous loop**: Never stops improving

## Next Steps

1. **Start the system**: Already running in docker-compose
2. **Monitor tasks**: Check `bots/improvement-tasks/` directory
3. **Improve code**: When tasks appear, analyze and fix
4. **Iterate**: System re-tests automatically, keep improving

The system is **fully autonomous** - it just needs you to improve the code when tasks are created!
