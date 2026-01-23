# Self-Improvement System

This document explains how the self-improvement system works, how to use improvement recommendations, and how to review improvement cycles.

## Overview

The self-improvement system automatically analyzes bot metrics, identifies issues, and generates improvement recommendations. It can run improvement cycles, test fixes, and compare metrics before/after.

**⚠️ IMPORTANT: This system ONLY runs in development mode. It is completely disabled in production to keep the production environment lightweight.**

## How It Works

### 1. Metrics Analysis

**AutoImprovement** analyzes metrics to identify:
- High repetition scores
- Low personality compliance
- System prompt leakage
- Performance issues (slow response times)

### 2. Recommendation Generation

For each issue, **AutoImprovement** generates:
- **Type**: repetition_fix, prompt_optimization, personality_compliance, performance, quality
- **Priority**: low, medium, high, critical
- **Description**: What the issue is
- **Suggested Changes**: Code, prompt, or config changes
- **Estimated Impact**: Expected improvement percentage
- **Personality Preserved**: Whether personality rules are maintained

### 3. Improvement Cycle

**SelfImprovementLoop** runs improvement cycles:
1. Get baseline metrics
2. Analyze and get recommendations
3. Apply recommendations (in development)
4. Test fixes (if test runner available)
5. Compare metrics before/after
6. Generate improvement report

## Usage

### Get Improvement Recommendations

```typescript
const autoImprovement = botManager.getAutoImprovement();
const recommendations = await autoImprovement.analyzeAndRecommend('bot-123');
```

### Via API

```bash
GET /api/bots/improve/recommendations?botId=bot-123
```

### Run Improvement Cycle

```typescript
const improvementLoop = botManager.getSelfImprovementLoop();
const cycle = await improvementLoop.runImprovementCycle('bot-123');
```

### Via API

```bash
POST /api/bots/improve/cycle
{
  "botId": "bot-123"
}
```

## Improvement Report

```typescript
{
    id: 'improvement-123',
    botId: 'bot-123',
    startedAt: 1704067200000,
    completedAt: 1704067300000,
    recommendations: [...],
    appliedRecommendations: ['repetition_fix', 'personality_compliance'],
    metricsBefore: {
        repetitionScore: 0.4,
        personalityCompliance: 0.7,
    },
    metricsAfter: {
        repetitionScore: 0.1,
        personalityCompliance: 0.9,
    },
    success: true,
    report: '...',
}
```

## Personality Preservation

**Critical Rule**: All improvements must preserve personality rules. The system validates that:
- Personality keywords are not removed
- Suggested changes don't break personality instructions
- Improvements maintain chat instruction compliance

## Best Practices

1. **Review Recommendations**: Always review recommendations before applying
2. **Test Before Deploy**: Run tests to validate improvements
3. **Monitor Metrics**: Track metrics after applying improvements
4. **Preserve Personality**: Never apply improvements that break personality rules
5. **Iterate**: Run improvement cycles regularly to continuously improve

## Development vs Production

- **Development**: Full self-improvement system with on-demand testing via API
  - AutoPilot ready for API calls
  - Test runner available via `/api/test/*` endpoints
  - AI assistant drives testing workflow
  - Metrics collection and conversation storage
- **Production**: **NO self-improvement system** - completely disabled to keep production lightweight
  - No AutoPilot
  - No AutoImprovement
  - No SelfImprovementLoop
  - No test runner
  - Test API endpoints return 403 Forbidden
  - Only metrics collection and conversation storage for admin viewing

## On-Demand Testing

The testing system is now **on-demand** - tests are executed only when the AI assistant calls the API:

- `POST /api/test/run` - Run test cases
- `POST /api/test/conversation` - Simulate conversations
- `GET /api/test/status` - Check availability

See [On-Demand Testing Guide](../testing/ON_DEMAND_TESTING.md) for details.
