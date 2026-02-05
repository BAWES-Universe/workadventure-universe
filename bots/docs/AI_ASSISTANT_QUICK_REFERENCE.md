# AI Assistant Quick Reference - Testing & Self-Improvement

**⚠️ CRITICAL: This is the ONLY way to test and self-improve. Do NOT create new scripts or use programmatic access.**

## Testing Conversations

### Standard Pattern (USE THIS)

```bash
curl -s -X POST http://bot-server.workadventure.localhost/api/test/conversation \
  -H "Content-Type: application/json" \
  -d '{
    "botId": "75f5ac5e-ea6b-482f-902b-714806b20424",
    "messages": [
      "Message 1",
      "Message 2",
      "Message 3"
    ],
    "userName": "Test User"
  }' | jq '.conversationFlow[] | {turn, response: .botResponse}'
```

### Check for Issues

```bash
# Check for emotion block leakage
curl -s -X POST http://bot-server.workadventure.localhost/api/test/conversation \
  -H "Content-Type: application/json" \
  -d '{"botId": "BOT_ID", "messages": ["test"]}' | \
  jq '.conversationFlow[] | {turn, hasLeakage: (.botResponse | contains("[EMOTION_UPDATE]"))}'

# Check repetition scores (if available in results)
curl -s -X POST http://bot-server.workadventure.localhost/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"botId": "BOT_ID"}' | \
  jq '.results[] | {testCaseId, repetitionScore: .metrics.repetitionScore}'
```

## Self-Improvement Workflow

### 1. Test Current State

```bash
curl -s -X POST http://bot-server.workadventure.localhost/api/test/conversation \
  -H "Content-Type: application/json" \
  -d '{
    "botId": "BOT_ID",
    "messages": ["problematic message 1", "problematic message 2"],
    "userName": "Test User"
  }' > before.json
```

### 2. Analyze Results

Look for:
- `[EMOTION_UPDATE]` blocks in responses (leakage)
- High repetition (similar responses)
- System prompt leakage
- Personality compliance issues
- Wrong emotion detection

### 3. Fix the Code

**Files to edit:**
- `bots/ai/AIService.ts` - System prompts (lines 246-283)
- `bots/ai/ResponseProcessor.ts` - Response cleaning
- `bots/memory/ConversationMemory.ts` - Emotion logic
- `bots/behaviors/*.ts` - Behavior logic

**DO NOT:**
- Create new test scripts
- Use programmatic BotManager access
- Create new testing frameworks
- Modify user bot configs (chatInstructions)

### 4. Verify Fix

```bash
curl -s -X POST http://bot-server.workadventure.localhost/api/test/conversation \
  -H "Content-Type: application/json" \
  -d '{
    "botId": "BOT_ID",
    "messages": ["same test messages"],
    "userName": "Test User"
  }' > after.json

# Compare
diff before.json after.json
```

## API Endpoints (ONLY USE THESE)

### Test Conversation
```bash
POST /api/test/conversation
{
  "botId": "bot-id",
  "messages": ["msg1", "msg2"],
  "userName": "Test User"
}
```

### Run Test Suite
```bash
POST /api/test/run
{
  "botId": "bot-id",
  "testCases": [  // Optional - uses defaults
    {
      "id": "test-1",
      "input": "Hello!",
      "expectedBehavior": {
        "shouldContain": ["hello"],
        "shouldNotContain": ["[EMOTION_UPDATE]"]
      }
    }
  ]
}
```

### Check Status
```bash
GET /api/test/status
```

## Common Bot ID

Default bot ID for testing: `75f5ac5e-ea6b-482f-902b-714806b20424`

## Response Structure

### Conversation Test Response
```json
{
  "botId": "...",
  "status": "passed",
  "summary": {"total": 4, "passed": 4, "failed": 0},
  "conversationFlow": [
    {
      "turn": "turn-1",
      "userMessage": "...",
      "botResponse": "...",  // Check this for leakage
      "passed": true,
      "responseTime": 1234,
      "emotions": {...}  // AI-detected emotions
    }
  ]
}
```

### Test Run Response
```json
{
  "botId": "...",
  "status": "passed",
  "summary": {"total": 3, "passed": 3, "failed": 0},
  "results": [
    {
      "testCaseId": "greeting",
      "response": "...",
      "metrics": {
        "repetitionScore": 0.0,
        "systemPromptLeakage": false,
        "personalityCompliance": 1.0
      },
      "emotions": {...}
    }
  ]
}
```

## What to Check

1. **Emotion Block Leakage**: `botResponse` should NOT contain `[EMOTION_UPDATE]`
2. **Repetition**: `repetitionScore` should be < 0.2 (lower is better)
3. **System Prompt Leakage**: `systemPromptLeakage` should be `false`
4. **Emotions**: `emotions` field should be populated with sentiment data
5. **Response Quality**: Bot should respond appropriately to messages

## Remember

- ✅ Use curl with `/api/test/conversation` endpoint
- ✅ Use the same bot ID pattern
- ✅ Analyze results from API response
- ✅ Fix code based on results
- ✅ Test again to verify
- ❌ Don't create new scripts
- ❌ Don't use programmatic access
- ❌ Don't create new testing methods
- ❌ Don't modify user bot configs

## Full Documentation

- Testing: `bots/docs/testing/ON_DEMAND_TESTING.md`
- Self-Improvement: `bots/docs/improvement/AUTOPILOT_WORKFLOW.md`
