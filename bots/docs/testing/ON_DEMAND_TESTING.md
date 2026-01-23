# On-Demand Testing System

## Overview

The bot testing system is now **on-demand** - tests are executed only when requested via API calls. This provides:

- **Efficiency**: No wasted resources on automatic test cycles
- **Intelligence**: Tests run when needed, not on a timer
- **Immediate feedback**: Results returned instantly
- **AI-driven**: The AI assistant (Cursor) controls testing workflow

## API Endpoints

### 1. Test Status

Check if the test runner is available and ready.

```bash
GET /api/test/status
```

**Response:**
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

### 2. Run Tests

Execute test cases on a specific bot.

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
        "shouldContain": ["hello", "hi", "hey"],
        "shouldNotContain": ["[", "]", "<think>"]
      }
    }
  ]
}
```

**Response:**
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
      "toolsCalled": [],
      "metrics": {
        "repetitionScore": 0,
        "systemPromptLeakage": false,
        "personalityCompliance": 1
      },
      "timestamp": 1769188979766
    }
  ],
  "duration": 6979
}
```

### 3. Simulate Conversation

Run a multi-turn conversation test with context preservation.

```bash
POST /api/test/conversation
Content-Type: application/json

{
  "botId": "bot-123",
  "messages": [
    "Hello!",
    "I'm hungry",
    "Do you remember what I said?"
  ],
  "userName": "Test User"
}
```

**Response:**
```json
{
  "botId": "bot-123",
  "testSuiteId": "conversation-1234567890",
  "status": "passed",
  "summary": {
    "total": 3,
    "passed": 3,
    "failed": 0
  },
  "conversationFlow": [
    {
      "turn": "turn-1",
      "userMessage": "Hello!",
      "botResponse": "Hi there! How can I assist you today?",
      "passed": true,
      "responseTime": 2131
    },
    {
      "turn": "turn-2",
      "userMessage": "I'm hungry",
      "botResponse": "You're hungry. Let's find something to eat.",
      "passed": true,
      "responseTime": 2468
    },
    {
      "turn": "turn-3",
      "userMessage": "Do you remember what I said?",
      "botResponse": "Yes, you mentioned you're hungry.",
      "passed": true,
      "responseTime": 1886
    }
  ],
  "duration": 6485
}
```

## Usage Examples

### Basic Test Run

```bash
curl -X POST http://bot-server.workadventure.localhost/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"botId": "75f5ac5e-ea6b-482f-902b-714806b20424"}'
```

### Custom Test Cases

```bash
curl -X POST http://bot-server.workadventure.localhost/api/test/run \
  -H "Content-Type: application/json" \
  -d '{
    "botId": "75f5ac5e-ea6b-482f-902b-714806b20424",
    "testCases": [
      {
        "id": "greeting",
        "input": "Hello!",
        "expectedBehavior": {
          "shouldContain": ["hello", "hi", "hey"]
        }
      },
      {
        "id": "location",
        "input": "Where are we?",
        "expectedBehavior": {
          "shouldContain": ["universe", "world", "room"]
        }
      }
    ]
  }'
```

### Conversation Test

```bash
curl -X POST http://bot-server.workadventure.localhost/api/test/conversation \
  -H "Content-Type: application/json" \
  -d '{
    "botId": "75f5ac5e-ea6b-482f-902b-714806b20424",
    "messages": ["Hello!", "I am hungry", "Do you remember?"],
    "userName": "Test User"
  }'
```

## AI-Driven Workflow

The AI assistant (Cursor) uses these endpoints to:

1. **Test before changes**: Run tests to establish baseline
2. **Make improvements**: Update code/system prompts
3. **Verify fixes**: Run tests again to confirm improvements
4. **Iterate**: Continue until all tests pass

### Example Workflow

```bash
# 1. Run initial tests
curl -X POST http://bot-server.workadventure.localhost/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"botId": "bot-123"}' > before.json

# 2. AI makes code changes...

# 3. Run tests again to verify
curl -X POST http://bot-server.workadventure.localhost/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"botId": "bot-123"}' > after.json

# 4. Compare results
diff before.json after.json
```

## Default Test Cases

If no `testCases` are provided, the system runs these defaults:

1. **Greeting Test**
   - Input: "Hello!"
   - Expected: Contains greeting words (hello, hi, hey, greetings)

2. **Location Test**
   - Input: "Where are we?"
   - Expected: Contains location words (universe, world, room, area)

3. **Memory Test**
   - Input: "I'm hungry"
   - Expected: No system prompt leakage (no brackets, tags, etc.)

## Test Result Metrics

Each test result includes:

- **repetitionScore**: 0.0-1.0 (lower is better)
- **systemPromptLeakage**: boolean (false is good)
- **personalityCompliance**: 0.0-1.0 (higher is better)
- **responseTime**: milliseconds
- **toolsCalled**: Array of tool names used

## Benefits

### Efficiency
- No wasted CPU cycles on automatic test runs
- Tests only run when needed
- No background noise from test player 999999

### Intelligence
- AI decides what to test and when
- Context-aware test selection
- Focused testing on specific issues

### Speed
- Immediate results (no waiting for next cycle)
- Fast iteration loop
- Real-time feedback

### Visibility
- Test results visible in conversation
- No need to check task files
- Direct analysis of results

## Migration from Interval-Based Testing

The old system ran tests every 30 seconds automatically. The new system:

- ✅ Removed automatic intervals
- ✅ Added on-demand API endpoints
- ✅ AI assistant drives testing
- ✅ Same test execution logic
- ✅ Same test result format

**No breaking changes** - the test runner still works the same way, just triggered differently.

## Production vs Development

- **Development**: Full test API available
- **Production**: Test endpoints disabled (403 Forbidden)

The test system is **development-only** to keep production lightweight.
