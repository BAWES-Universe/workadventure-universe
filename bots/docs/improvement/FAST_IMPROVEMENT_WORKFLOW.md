# Fast Continuous Improvement Workflow

## Overview

The new improvement system provides **fast, effective continuous improvement** with a clear feedback loop. Task files are the source of truth, and the system automatically tracks status and verifies fixes.

## How It Works

### 1. Automatic Testing (Every 30 Seconds)

AutoPilot runs tests on all bots:
- Generates test cases based on bot configuration
- Runs tests and collects metrics
- Detects failures immediately

### 2. Task Creation

When tests fail:
- Creates task file with `status: "pending"`
- Includes test results, metrics, failed tests, recommendations
- Task file location: `bots/improvement-tasks/task-{timestamp}-{botId}.json`

### 3. Smart Task Management

**Before creating new task:**
- Checks if unresolved task exists for this bot
- If `status: "in_progress"` → re-tests to verify fix
- If `status: "pending"` → skips duplicate
- If no task → creates new one

### 4. AI Processing

When you ask me to "check tasks" or "improve":
1. I list all `status: "pending"` tasks
2. Analyze each issue
3. Fix the code
4. Update task: `status: "in_progress"`, add `fixDescription`
5. Commit the fix

### 5. Automatic Verification

Next test cycle (30 seconds later):
- If tests pass → marks task as `status: "resolved"`
- If still failing → marks as `status: "failed"`, creates new task

### 6. Cleanup

- Resolved/failed tasks auto-deleted after 5 minutes
- All resolved/failed tasks >10 minutes old deleted (prevents bloat)
- Pending/in_progress tasks kept (being worked on)

## Task Status Flow

```
pending → in_progress → resolved (deleted after 5 min)
         ↓
       failed (deleted after 5 min)
```

## Key Improvements

### ✅ Fixed Test Metrics

**Before:** Metrics were hardcoded to 0
```typescript
const metrics = {
    repetitionScore: 0, // Would be calculated
    personalityCompliance: 0, // Would be calculated
};
```

**After:** Actual metrics from ResponseProcessor
```typescript
const processed = this.responseProcessor.processResponse(...);
const metrics = {
    repetitionScore: processed.metrics.repetitionScore,
    personalityCompliance: processed.metrics.personalityCompliance,
    systemPromptLeakage: processed.metrics.systemPromptLeakage,
};
```

### ✅ Task Status Tracking

Tasks now have clear status:
- `pending` - Needs to be fixed
- `in_progress` - AI is working on it
- `resolved` - Fixed and verified
- `failed` - Fix didn't work, needs new approach

### ✅ No Duplicate Tasks

System checks for existing unresolved tasks before creating new ones.

### ✅ Automatic Verification

When AI marks task as `in_progress`, next test cycle automatically verifies if fix worked.

### ✅ Removed Improvements Table

The `bots_improvements` table was just noise - logging failures but not tracking actual fixes. Task files are now the source of truth.

## Example Workflow

1. **11:00:00** - AutoPilot runs tests → bot fails greeting test
   - Creates: `task-1234567890-bot123.json` with `status: "pending"`

2. **11:00:15** - You ask: "check tasks"
   - I read task file
   - Analyze: "Bot not greeting properly"
   - Fix: Update system prompt in `AIService.ts`
   - Update task: `status: "in_progress"`, `fixDescription: "Updated greeting prompt"`
   - Commit fix

3. **11:00:30** - AutoPilot runs tests again
   - Tests pass! ✅
   - Updates task: `status: "resolved"`, `resolvedAt: 1234567920`

4. **11:05:30** - AutoPilot cleanup
   - Deletes resolved task (5 minutes old)

## Commands

### Check for tasks
```bash
./bots/scripts/process-tasks.sh
```

### View pending tasks
```bash
cat bots/improvement-tasks/task-*.json | jq 'select(.status == "pending")'
```

### View in-progress tasks
```bash
cat bots/improvement-tasks/task-*.json | jq 'select(.status == "in_progress")'
```

## What Gets Improved

- **System prompts** (`AIService.ts`) - Behavior rules, anti-repetition, tool calling
- **Response processing** (`ResponseProcessor.ts`) - Cleaning logic, repetition detection
- **Test cases** (`AutoPilotImprovement.ts`) - Test expectations, case generation
- **Code logic** - Any bot behavior issues

## Benefits

1. **Fast iteration**: 30-second cycles, immediate fixes
2. **Real metrics**: Actual repetition/compliance scores, not zeros
3. **Clear tracking**: Task files show what's pending/in-progress/resolved
4. **No noise**: Removed improvements table, only useful data
5. **Automatic**: System verifies fixes without manual intervention
