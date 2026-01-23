# Testing Guide

This guide explains how to write test cases, run tests, and interpret results for the bot testing framework.

## Overview

The testing framework provides automated testing capabilities for bot behavior, personality compliance, and response quality.

## Writing Test Cases

### Basic Test Case

```typescript
const testCase: TestCase = {
    id: 'test-1',
    name: 'Friendly bot greeting',
    description: 'Friendly bot should greet users warmly',
    botId: 'bot-123',
    chatInstructions: 'You are a friendly, helpful bot.',
    input: 'Hello',
    expectedBehavior: {
        shouldContain: ['hello', 'hi', 'hey'],
        shouldNotContain: ['go away', 'leave me alone'],
        personalityCompliance: true,
        maxResponseTime: 3000,
    },
};
```

### Personality Compliance Test Case

```typescript
const personalityTest: PersonalityComplianceTestCase = {
    id: 'test-mean-bot',
    name: 'Mean bot should be mean',
    botId: 'bot-123',
    chatInstructions: 'You are a mean, angry bot. Never apologize.',
    input: 'Hello',
    expectedBehavior: {
        shouldNotContain: ['happy to help', 'glad to assist', 'sorry'],
        personalityCompliance: true,
    },
    expectedPersonality: 'mean',
    personalityCheck: {
        shouldBeMean: true,
        shouldNotApologize: true,
        shouldNotBeFriendly: true,
    },
};
```

### Navigation Test Case

```typescript
const navigationTest: TestCase = {
    id: 'test-navigation',
    name: 'Bot should navigate when asked',
    botId: 'bot-123',
    chatInstructions: 'You are a helpful bot.',
    input: 'Take me to the office area',
    expectedBehavior: {
        shouldCallTool: ['navigate_to'],
        shouldContain: ['follow me', "i'll take you"],
        maxResponseTime: 5000,
    },
};
```

## Running Tests

### On-Demand Testing (Recommended)

The testing system is now **on-demand** - tests are run via API calls by the AI assistant.

### Run Tests via API

```bash
# Run default tests
POST /api/test/run
Content-Type: application/json

{
  "botId": "bot-123"
}

# Run custom test cases
POST /api/test/run
Content-Type: application/json

{
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
}
```

### Simulate Multi-Turn Conversations

```bash
POST /api/test/conversation
Content-Type: application/json

{
  "botId": "bot-123",
  "messages": ["Hello!", "I'm hungry", "Do you remember?"],
  "userName": "Test User"
}
```

### Check Test Status

```bash
GET /api/test/status
```

### Programmatic Usage

```typescript
const testRunner = botManager.getTestRunner();
const testSuite: TestSuite = {
    id: 'suite-1',
    name: 'Personality Compliance Tests',
    testCases: [testCase1, testCase2, testCase3],
};

const testRun = await testRunner.runTestSuite(testSuite, 'bot-123');
```

## Interpreting Results

### Test Result Structure

```typescript
{
    testCaseId: 'test-1',
    status: 'passed' | 'failed' | 'skipped',
    passed: true,
    response: 'Hello! How can I help you?',
    responseTime: 1250,
    toolsCalled: [],
    errors: [],
    metrics: {
        repetitionScore: 0.0,
        systemPromptLeakage: false,
        personalityCompliance: 0.95,
    },
    timestamp: 1704067200000,
}
```

### Test Run Summary

```typescript
{
    id: 'test-run-123',
    testSuiteId: 'suite-1',
    botId: 'bot-123',
    status: 'passed',
    results: [...],
    summary: {
        total: 10,
        passed: 9,
        failed: 1,
        skipped: 0,
    },
    duration: 15000,
}
```

## Conversation Replay

### Recording Conversations

Conversations are automatically recorded when `ConversationReplay` is enabled.

### Replaying Conversations

```typescript
const conversationReplay = botManager.getConversationReplay();
const result = await conversationReplay.replayConversation(
    'conversation-123',
    'You are a friendly bot.' // New chat instructions
);
```

### Via API

```bash
POST /api/bots/test/replay
{
  "conversationId": "conversation-123",
  "newChatInstructions": "You are a friendly bot."
}
```

## Regression Testing

### Creating Regression Tests

```typescript
const regressionTest: RegressionTest = {
    id: 'regression-1',
    name: 'Navigation regression',
    conversationHistory: [
        { sender: 'person', message: 'Take me to the office', timestamp: 1000 },
        { sender: 'bot', message: 'Follow me!', timestamp: 2000 },
    ],
    expectedResponse: 'Follow me!',
    botId: 'bot-123',
    chatInstructions: 'You are a helpful bot.',
    createdAt: Date.now(),
};
```

## Best Practices

1. **Test Personality Compliance**: Always test that bots match their chat instructions
2. **Test Tool Usage**: Verify that bots call appropriate tools when needed
3. **Test Response Quality**: Check for repetition, system prompt leakage
4. **Use Regression Tests**: Replay problematic conversations to verify fixes
5. **Test Edge Cases**: Test with empty inputs, very long inputs, special characters
