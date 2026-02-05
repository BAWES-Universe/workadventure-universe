# AI Workflow & Continuous Improvement System

This document describes the AI workflow system, metrics collection, testing framework, self-improvement system, and context management.

## Overview

The AI workflow system provides a comprehensive framework for managing bot AI behavior, tracking performance, testing improvements, and continuously improving bot responses.

## Architecture

### Metrics Collection

**BotMetricsCollector** (`bots/metrics/BotMetricsCollector.ts`)

- Collects response time, token usage, repetition score, system prompt leakage
- Tracks personality compliance score
- Stores metrics with timestamps for time-series analysis
- Non-blocking metric collection with buffered writes

**API Endpoints:**
- `GET /api/bots/:botId/metrics/current` - Get current metrics from buffer
- `GET /api/bots/:botId/metrics` - Query metrics with time range
- `POST /api/bots/metrics` - Record metrics (internal)

### Testing Framework

**BotTestRunner** (`bots/testing/BotTestRunner.ts`)

- Runs test suites programmatically
- Supports conversation replay testing
- Compares responses between versions
- Generates test reports

**ConversationReplay** (`bots/testing/ConversationReplay.ts`)

- Records real conversations for replay
- Replays conversations with different prompt versions
- Compares original vs new responses
- Identifies problematic conversations automatically

**API Endpoints:**
- `POST /api/bots/test/run-suite` - Run test suite
- `GET /api/bots/test/results/:testId` - Get test results
- `POST /api/bots/test/replay` - Replay conversation
- `GET /api/bots/:botId/conversations/problematic` - Get flagged conversations

### Conversation Monitoring

**ConversationMonitor** (`bots/monitoring/ConversationMonitor.ts`)

- Real-time conversation monitoring
- Detects repetition, system prompt leakage, user frustration
- Detects personality violations
- Flags conversations with issues
- Triggers alerts for critical issues

### Context Management

**ContextManager** (`bots/ai/ContextManager.ts`)

- Manages context window limits
- Automatically summarizes old conversation history when approaching limits
- Maintains summary + recent messages in context
- Supports recursive summarization for very long conversations

**ContextSummarizer** (`bots/ai/ContextSummarizer.ts`)

- Summarizes conversation history using AI
- Extracts key information (emotions, facts, important events)
- Preserves emotional context in summaries
- Generates hierarchical summaries

**MultiPromptAIService** (`bots/ai/MultiPromptAIService.ts`)

- Supports multi-prompt workflows:
  1. Analysis prompt: Analyze conversation context, detect issues
  2. Summarization prompt: Summarize if needed
  3. Main response prompt: Generate actual response
- Chains prompts intelligently
- Tracks token usage across all prompts

### Self-Improvement System

**AutoImprovement** (`bots/improvement/AutoImprovement.ts`)

- Analyzes metrics to identify issues
- Generates code fixes automatically
- Proposes prompt improvements
- Never breaks personality rules
- Predicts impact of changes
- Validates that improvements maintain personality adherence

**SelfImprovementLoop** (`bots/improvement/SelfImprovementLoop.ts`)

- Runs improvement cycles automatically
- Tests fixes before applying
- Compares metrics before/after
- Generates improvement reports

**API Endpoints:**
- `GET /api/bots/improve/recommendations` - Get improvement recommendations
- `POST /api/bots/improve/cycle` - Run improvement cycle
- `GET /api/bots/improve/history` - Get improvement history

### Response Processing

**ResponseProcessor** (`bots/ai/ResponseProcessor.ts`)

- Cleans system prompt leakage
- Detects and prevents repetition
- Validates personality compliance
- Validates response quality
- Post-processes responses before sending

**RepetitionDetector** (`bots/ai/RepetitionDetector.ts`)

- Compares new response to recent history
- Calculates similarity score
- Blocks or modifies repetitive responses

**PersonalityComplianceValidator** (`bots/ai/PersonalityComplianceValidator.ts`)

- Analyzes response against chat instructions
- Detects personality violations
- Scores compliance (0-1)
- Tracks compliance metrics over time

## Usage

### Metrics Collection

```typescript
const metricsCollector = botManager.getMetricsCollector();
metricsCollector.recordResponseTime(botId, responseTime);
metricsCollector.recordTokenUsage(botId, promptTokens, completionTokens);
metricsCollector.recordRepetitionScore(botId, score);
metricsCollector.recordPersonalityCompliance(botId, score);
```

### Testing

```typescript
const testRunner = botManager.getTestRunner();
const testRun = await testRunner.runTestSuite(testSuite, botId);
```

### Monitoring

```typescript
const monitor = botManager.getConversationMonitor();
const issues = monitor.monitorResponse(botId, playerId, response, chatInstructions);
```

### Context Management

```typescript
const contextManager = new ContextManager(aiService);
const managedContext = await contextManager.manageContext(
    botId,
    playerId,
    messages,
    maxTokens
);
```

### Self-Improvement

```typescript
const autoImprovement = botManager.getAutoImprovement();
const recommendations = await autoImprovement.analyzeAndRecommend(botId);

const improvementLoop = botManager.getSelfImprovementLoop();
const cycle = await improvementLoop.runImprovementCycle(botId);
```

## Production vs Development

### Production (Lightweight)

- Metrics collection (non-blocking)
- Conversation storage for admin viewing
- Manual cleanup endpoints
- Emotion persistence
- Response processing

### Development (Full System)

- All production features
- Automated testing framework
- Self-improvement loops
- Context summarization
- Multi-prompt workflows
- Conversation replay
- Auto-improvement engine
- Analytics aggregation

## Success Metrics

- **Response Quality**: Repetition score < 0.1, system prompt leakage = 0
- **Personality Compliance**: Compliance score > 0.9
- **Performance**: Response time < 3s (p95), context window usage < 80%
- **Improvement Rate**: Automated improvements deployed weekly
