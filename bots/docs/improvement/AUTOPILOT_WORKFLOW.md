# AutoPilot On-Demand Testing Workflow

## Overview

The AutoPilot system provides **on-demand testing** via API endpoints. **The AI assistant (Cursor) drives testing by calling the API directly**, analyzing results in real-time, and making code improvements immediately.**

## How It Works

### 1. On-Demand Testing (API-Driven)

The AI assistant calls test endpoints directly:
- `POST /api/test/run` - Run specific test cases
- `POST /api/test/conversation` - Simulate multi-turn conversations
- `GET /api/test/status` - Check test runner availability

**No automatic intervals** - all testing is triggered on-demand by the AI assistant.

### 2. Test Execution & Analysis

When the AI assistant calls the test API:

**Test API Response:**
```json
{
  "botId": "bot-123",
  "testSuiteId": "test-run-1234567890",
  "status": "passed",
  "summary": {
    "total": 3,
    "passed": 3,
    "failed": 0,
    "skipped": 0
  },
  "results": [
    {
      "testCaseId": "greeting",
      "status": "passed",
      "passed": true,
      "response": "Hello! How can I assist you today?",
      "responseTime": 2281,
      "metrics": {
        "repetitionScore": 0,
        "systemPromptLeakage": false,
        "personalityCompliance": 1
      }
    }
  ],
  "duration": 6979
}
```

### 3. AI-Driven Workflow

**The AI assistant (Cursor) workflow:**

1. **Call test API:**
   ```bash
   curl -X POST http://bot-server.workadventure.localhost/api/test/run \
     -H "Content-Type: application/json" \
     -d '{"botId": "bot-123"}'
   ```

2. **Analyze results directly:**
   - Review test results in the API response
   - Check metrics (repetition, personality compliance, etc.)
   - Identify issues immediately

3. **Make code improvements:**
   - **System prompts** in `AIService.ts`
   - **Code logic** in `ResponseProcessor.ts`, `RepetitionDetector.ts`, etc.
   - Fix issues based on test results

4. **Verify fixes immediately:**
   - Call test API again with same test cases
   - Compare results before/after
   - Iterate until tests pass

### 4. Fast Iteration Loop

```
1. AI calls POST /api/test/run
2. AI analyzes results
3. AI makes code changes if needed
4. AI calls POST /api/test/run again (verify fix)
5. Repeat until perfect
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

### Step 1: Run Tests On-Demand

```bash
# Run default tests
curl -X POST http://bot-server.workadventure.localhost/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"botId": "bot-123"}'

# Run custom test cases
curl -X POST http://bot-server.workadventure.localhost/api/test/run \
  -H "Content-Type: application/json" \
  -d '{
    "botId": "bot-123",
    "testCases": [
      {
        "id": "greeting",
        "input": "Hello!",
        "expectedBehavior": {
          "shouldContain": ["hello", "hi", "hey"]
        }
      }
    ]
  }'
```

### Step 2: Analyze Results

Look at the API response:
- **Failed tests**: What exactly failed?
- **Metrics**: What's wrong? (repetition, personality, etc.)
- **Response quality**: Check actual bot responses
- **Response time**: Performance issues?

### Step 3: Identify Root Cause

- **Repetition high?** → Improve system prompt or RepetitionDetector
- **Personality violation?** → Strengthen personality rules in system prompt
- **System prompt leakage?** → Improve ResponseProcessor cleaning
- **Test failing?** → Fix the underlying issue

### Step 4: Improve the Code

**For system prompts:**
- Edit `bots/ai/AIService.ts`
- Strengthen rules that are failing
- Add explicit instructions for detected issues

**For code logic:**
- Edit the relevant file (ResponseProcessor, RepetitionDetector, etc.)
- Fix the algorithm/logic
- Add better detection/cleaning

### Step 5: Verify Improvement Immediately

```bash
# Run tests again to verify fix
curl -X POST http://bot-server.workadventure.localhost/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"botId": "bot-123"}'
```

Compare results:
- Did tests pass?
- Did metrics improve?
- If still failing, iterate again

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

1. **AI calls test API:**
   ```bash
   curl -X POST http://bot-server.workadventure.localhost/api/test/run \
     -H "Content-Type: application/json" \
     -d '{"botId": "bot-123"}'
   ```

2. **API response shows issue:**
   ```json
   {
     "results": [{
       "testCaseId": "greeting",
       "metrics": {
         "repetitionScore": 0.45
       }
     }]
   }
   ```

3. **AI analyzes:**
   - Repetition is high (0.45, should be < 0.2)
   - System prompt says "vary responses" but it's not strong enough

4. **AI improves code:**
   - Edit `AIService.ts`
   - Strengthen the repetition rule:
   ```typescript
   // Before:
   "- Vary responses - never repeat the same answer for different questions"
   
   // After:
   "- **CRITICAL: Vary responses - never repeat the same answer. Check conversation history - if you said something similar in the last 3 messages, say it completely differently or skip redundant information.**"
   ```

5. **AI verifies fix immediately:**
   ```bash
   curl -X POST http://bot-server.workadventure.localhost/api/test/run \
     -H "Content-Type: application/json" \
     -d '{"botId": "bot-123"}'
   ```
   - Tests pass → fix verified
   - Tests still fail → iterate again

## API Endpoints

### Test Status

```bash
GET /api/test/status
```

Returns:
```json
{
  "testRunnerAvailable": true,
  "autoPilotAvailable": true,
  "autoPilotRunning": true,
  "environment": "development",
  "capabilities": {
    "runTests": true,
    "runConversation": true,
    "replayConversation": true
  }
}
```

### Run Tests

```bash
POST /api/test/run
Content-Type: application/json

{
  "botId": "bot-123",
  "testCases": [  // Optional - uses defaults if not provided
    {
      "id": "greeting",
      "input": "Hello!",
      "expectedBehavior": {
        "shouldContain": ["hello", "hi", "hey"]
      }
    }
  ]
}
```

### Simulate Conversation

```bash
POST /api/test/conversation
Content-Type: application/json

{
  "botId": "bot-123",
  "messages": ["Hello!", "I'm hungry", "Do you remember?"],
  "userName": "Test User"
}
```

## Monitoring

### Check Test Status

```bash
curl http://bot-server.workadventure.localhost/api/test/status
```

### Check Logs

```bash
# Watch bot server logs
docker logs -f workadventure-universe-bot-server-1 | grep -i "test\|autopilot"
```

## Troubleshooting

### Test API Not Available

1. Check if bot server is running:
   ```bash
   docker ps | grep bot-server
   ```

2. Check if in development mode:
   ```bash
   curl http://bot-server.workadventure.localhost/api/test/status
   ```

3. Check logs:
   ```bash
   docker logs workadventure-universe-bot-server-1 | grep -i "autopilot"
   ```

### Tests Failing

- Review test results in API response
- Check bot configuration
- Verify bot is active and responding

## Key Points

1. **On-demand testing**: Tests run only when AI assistant calls the API
2. **Immediate feedback**: Results returned instantly in API response
3. **AI-driven**: The AI assistant (Cursor) controls when and what to test
4. **Fast iteration**: Test → Analyze → Fix → Verify in seconds
5. **No noise**: No automatic intervals creating unnecessary test runs

## Next Steps

1. **System is ready**: AutoPilot is running and ready for API calls
2. **AI calls API**: The AI assistant calls test endpoints when needed
3. **Analyze results**: Review test results directly in API response
4. **Improve code**: Make fixes based on test results
5. **Verify immediately**: Call test API again to confirm fixes

The system is **efficient and intelligent** - tests run only when needed, and results are analyzed immediately!
