# AutoPilot Quick Reference

## What It Does

- **Runs tests every 30 seconds** on all active bots
- **Creates task files** when issues are found
- **You (AI) improve code** based on task files
- **System re-tests automatically** after improvements

## Task Files

**Location:** `bots/improvement-tasks/task-{timestamp}-{botId}.json`

**Check for new tasks:**
```bash
ls -lt bots/improvement-tasks/*.json | head -5
```

**View a task:**
```bash
cat bots/improvement-tasks/task-*.json | jq .
```

**Resolve task (when fixed):**
```bash
rm bots/improvement-tasks/task-{id}.json
```

## What to Improve

### System Prompts
**File:** `bots/ai/AIService.ts` (lines 246-283)

Improve:
- Technical response guidelines
- Anti-hallucination rules  
- Location question handling
- Tool calling instructions

### Code Logic
**Files:**
- `bots/ai/ResponseProcessor.ts` - Response cleaning
- `bots/ai/RepetitionDetector.ts` - Repetition detection
- `bots/ai/PersonalityComplianceValidator.ts` - Personality checking

## Workflow

1. **Check tasks:** `ls bots/improvement-tasks/*.json`
2. **Read task:** `cat task-*.json | jq .`
3. **Analyze:** What failed? Why?
4. **Improve:** Edit code/system prompts
5. **Wait 30s:** System re-tests automatically
6. **Verify:** Check if fixed
7. **Resolve:** `rm task-*.json` when done

## Common Issues

### High Repetition
- **Fix:** Strengthen repetition rule in `AIService.ts` line 254
- **Improve:** Add conversation history checking

### Personality Violations
- **Fix:** Strengthen personality rules in `AIService.ts` line 248
- **Improve:** Add explicit personality enforcement

### System Prompt Leakage
- **Fix:** Improve `ResponseProcessor.cleanSystemPromptLeakage()`
- **Improve:** Add more cleaning patterns

## Configuration

**Test interval:** 30 seconds (fast iteration)
**Tasks directory:** `bots/improvement-tasks/`
**Auto-apply:** Enabled in development

## Key Rules

1. ✅ **Improve system prompts** - Safe, immediate effect
2. ✅ **Improve code logic** - Fix detection/processing
3. ❌ **Never touch user configs** - Don't modify `chatInstructions`
4. ✅ **One issue at a time** - Focus, verify, iterate
