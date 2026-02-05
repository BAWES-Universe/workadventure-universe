# How to Use AutoPilot Improvement System

## Overview

AutoPilot runs tests every 30 seconds and creates task files when issues are found. **Task files are gitignored** - they won't bloat your repo.

## Quick Commands

### Check for tasks
```bash
./bots/scripts/process-tasks.sh
```

This shows:
- How many tasks exist
- Issues grouped by type
- Recommended fixes
- Priority breakdown

### View a specific task
```bash
cat bots/improvement-tasks/task-*.json | jq .
```

### Clean up resolved tasks
```bash
rm bots/improvement-tasks/task-{id}.json
```

## Workflow

1. **AutoPilot runs tests** (every 30 seconds)
2. **Task files created** in `bots/improvement-tasks/` (gitignored)
3. **You run:** `./bots/scripts/process-tasks.sh`
4. **I (AI) analyze** and fix the code
5. **System re-tests** automatically
6. **Delete task files** when fixed

## Common Issues & Fixes

### Reasoning Tags in Responses
**Symptom:** `<think>` or `<think>` tags in bot responses

**Fix:** `bots/ai/ResponseProcessor.ts` - `cleanSystemPromptLeakage()`
- Already has regex to remove these
- If still appearing, strengthen the regex

### Greeting Test Failures
**Symptom:** Tests expect "hello", "hey", "greeting" but bot doesn't say them

**Fix Options:**
1. **If bot is mean/angry:** Update test expectations (mean bots shouldn't greet)
2. **If bot should greet:** Strengthen system prompt in `AIService.ts`

### Test Expectations Too Strict
**Symptom:** Bot responds correctly but test expects exact words

**Fix:** Update test case generation in `AutoPilotImprovement.ts` - `generateTestCases()`

## Important Notes

- ✅ **Task files are gitignored** - won't bloat repo
- ✅ **No auto-commits** - I only commit when you ask
- ✅ **Process tasks systematically** - use `process-tasks.sh`
- ✅ **Clean up when done** - delete task files after fixing

## What Gets Fixed

- **System prompts** (`AIService.ts`) - Behavior rules
- **Response processing** (`ResponseProcessor.ts`) - Cleaning logic
- **Test cases** (`AutoPilotImprovement.ts`) - Test expectations
- **Code logic** - Any detection/processing issues

## What Doesn't Get Fixed

- ❌ **User bot configs** - Never modify `chatInstructions` (user's choice)
- ❌ **User personalities** - We improve the system, not their bots
