# Billing and Cost Management

## Overview

This document explains how to implement billing for AI provider usage, including how to charge for self-hosted providers like LMStudio.

## Cost Models

### 1. LMStudio (Self-Hosted)

**Software:** Free (open source)  
**Infrastructure:** Your costs (servers, compute, GPU)  
**Pricing:** **You control the pricing model**

#### Pricing Options

**Option A: Per-Token Pricing**
```typescript
// Simple per-token pricing
const costPerToken = 0.00001; // $0.00001 per token
const cost = tokensUsed * costPerToken;
```

**Option B: Per-Request Pricing**
```typescript
// Flat rate per request
const costPerRequest = 0.001; // $0.001 per request
const cost = apiCalls * costPerRequest;
```

**Option C: Hybrid (Base + Usage)**
```typescript
// Base cost per request + per-token
const baseCost = 0.001; // $0.001 per request
const costPerToken = 0.000005; // $0.000005 per token
const cost = (apiCalls * baseCost) + (tokensUsed * costPerToken);
```

**Option D: Compute-Time Based**
```typescript
// Based on actual compute time
const computeTimeHours = latency / (1000 * 60 * 60);
const serverCostPerHour = 0.10; // $0.10/hour for GPU instance
const cost = computeTimeHours * serverCostPerHour;
```

**Option E: Tiered Pricing**
```typescript
function calculateTieredCost(tokensUsed: number): number {
    // Tier 1: First 1000 tokens free
    if (tokensUsed <= 1000) return 0;
    
    // Tier 2: 1001-10000 tokens
    if (tokensUsed <= 10000) {
        return (tokensUsed - 1000) * 0.00001;
    }
    
    // Tier 3: 10001+ tokens (volume discount)
    return (9000 * 0.00001) + ((tokensUsed - 10000) * 0.000005);
}
```

### 2. OpenAI/Anthropic (Third-Party)

**Software:** Paid (per token)  
**Infrastructure:** Included in API cost  
**Pricing:** Pass-through or markup

#### Pricing Options

**Option A: Pass-Through**
```typescript
// Charge exactly what provider charges
const cost = tokensUsed * providerCostPerToken;
```

**Option B: Markup**
```typescript
// Add markup to provider cost
const providerCost = tokensUsed * providerCostPerToken;
const markup = 1.2; // 20% markup
const cost = providerCost * markup;
```

**Option C: Flat Markup**
```typescript
// Fixed markup per request
const providerCost = tokensUsed * providerCostPerToken;
const markupPerRequest = 0.0005; // $0.0005 per request
const cost = providerCost + markupPerRequest;
```

### 3. Ultravox Voice AI (Third-Party)

**Software:** Paid (per minute)  
**Infrastructure:** Included in API cost  
**Pricing:** Per-minute (e.g., $0.05 per minute)

#### Pricing Model

**Per-Minute Pricing:**
```typescript
// Ultravox charges $0.05 per minute
const costPerMinute = 0.05; // $0.05 per minute
const durationMinutes = durationSeconds / 60;
const cost = durationMinutes * costPerMinute;

// Example: 2.5 minutes = $0.125
const cost = (150 / 60) * 0.05; // 2.5 minutes * $0.05 = $0.125
```

**Rounded Up (Common Practice):**
```typescript
// Many voice AI providers round up to the nearest minute
const durationMinutes = Math.ceil(durationSeconds / 60);
const cost = durationMinutes * costPerMinute;

// Example: 90 seconds = 2 minutes (rounded up) = $0.10
const cost = Math.ceil(90 / 60) * 0.05; // 2 * $0.05 = $0.10
```

**Minimum Charge:**
```typescript
// Some providers have a minimum charge (e.g., 1 minute minimum)
const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
const cost = durationMinutes * costPerMinute;

// Example: 30 seconds = 1 minute minimum = $0.05
const cost = Math.max(1, Math.ceil(30 / 60)) * 0.05; // 1 * $0.05 = $0.05
```

## Implementation

### Provider Configuration

Add pricing configuration to provider config in Admin API:

```typescript
interface AIProviderConfig {
    providerId: string;
    type: 'lmstudio' | 'openai' | 'anthropic' | 'ultravox' | 'gpt-voice';
    
    // Pricing configuration
    pricingModel: 'per-token' | 'per-request' | 'per-minute' | 'hybrid' | 'compute-time' | 'tiered';
    
    // Per-token pricing
    costPerToken?: number;
    
    // Per-request pricing
    costPerRequest?: number;
    
    // Per-minute pricing (for voice AI)
    costPerMinute?: number;
    roundUpMinutes?: boolean; // Round up to nearest minute (default: true)
    minimumMinutes?: number; // Minimum charge (default: 1)
    
    // Hybrid pricing
    baseCost?: number;
    
    // Compute-time pricing
    serverCostPerHour?: number;
    
    // Markup (for third-party providers)
    markup?: number;
    
    // Tiered pricing
    tiers?: Array<{
        maxTokens: number;
        costPerToken: number;
    }>;
}
```

### Cost Calculation in Bot Server

```typescript
// bots/ai/AIService.ts

private calculateCost(
    providerId: string,
    tokensUsed: number,
    latency: number,
    apiCalls: number,
    durationSeconds?: number // For voice AI (duration in seconds)
): number {
    const providerConfig = this.getProviderConfig(providerId);
    
    switch (providerConfig.pricingModel) {
        case 'per-token':
            return tokensUsed * (providerConfig.costPerToken || 0);
            
        case 'per-request':
            return apiCalls * (providerConfig.costPerRequest || 0);
            
        case 'per-minute':
            if (!durationSeconds) {
                console.warn(`[AIService] Per-minute pricing requires durationSeconds`);
                return 0;
            }
            const costPerMinute = providerConfig.costPerMinute || 0;
            const roundUp = providerConfig.roundUpMinutes !== false; // Default: true
            const minimumMinutes = providerConfig.minimumMinutes || 1; // Default: 1 minute
            
            let durationMinutes: number;
            if (roundUp) {
                durationMinutes = Math.ceil(durationSeconds / 60);
            } else {
                durationMinutes = durationSeconds / 60;
            }
            
            // Apply minimum charge
            durationMinutes = Math.max(minimumMinutes, durationMinutes);
            
            return durationMinutes * costPerMinute;
            
        case 'hybrid':
            const base = (providerConfig.baseCost || 0) * apiCalls;
            const usage = tokensUsed * (providerConfig.costPerToken || 0);
            return base + usage;
            
        case 'compute-time':
            const hours = latency / (1000 * 60 * 60);
            return hours * (providerConfig.serverCostPerHour || 0);
            
        case 'tiered':
            return this.calculateTieredCost(tokensUsed, providerConfig.tiers || []);
            
        default:
            return 0;
    }
}
```

### Usage Tracking

**For Text AI (LMStudio, OpenAI, Anthropic):**
```typescript
// Track usage with calculated cost
await this.trackUsage(botId, providerId, {
    tokensUsed: 150,
    apiCalls: 1,
    latency: 1250,
    durationSeconds: undefined, // Not applicable for text AI
    cost: this.calculateCost(providerId, 150, 1250, 1),
});
```

**For Voice AI (Ultravox, GPT Voice):**
```typescript
// Track usage with duration and calculated cost
const durationSeconds = 150; // 2.5 minutes
await this.trackUsage(botId, providerId, {
    tokensUsed: 0, // Not applicable for voice AI
    apiCalls: 1,
    latency: 1250,
    durationSeconds: durationSeconds, // Duration in seconds
    cost: this.calculateCost(providerId, 0, 1250, 1, durationSeconds),
});
```

## Billing Aggregation

### Admin API Queries

**Monthly Cost per Bot:**
```sql
SELECT 
    bot_id,
    SUM(cost) as total_cost,
    SUM(tokens_used) as total_tokens,
    SUM(api_calls) as total_calls
FROM bots_ai_usage
WHERE timestamp >= DATE_TRUNC('month', CURRENT_DATE)
    AND timestamp < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
GROUP BY bot_id;
```

**Cost by Provider:**
```sql
SELECT 
    provider_id,
    SUM(cost) as total_cost,
    SUM(tokens_used) as total_tokens,
    SUM(duration_seconds) as total_duration_seconds,
    SUM(duration_seconds) / 60.0 as total_duration_minutes,
    COUNT(*) as total_requests
FROM bots_ai_usage
WHERE timestamp >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY provider_id;
```

**Cost by User:**
```sql
SELECT 
    b.user_id,
    SUM(u.cost) as total_cost,
    SUM(u.tokens_used) as total_tokens
FROM bots_ai_usage u
JOIN bots_configuration b ON u.bot_id = b.bot_id
WHERE u.timestamp >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY b.user_id;
```

## Pricing Examples

### Example 1: Competitive with OpenAI

**Goal:** Price LMStudio similarly to OpenAI GPT-3.5-turbo

```typescript
// OpenAI GPT-3.5-turbo: ~$0.0005 per 1K tokens input, $0.0015 per 1K tokens output
// Average: ~$0.001 per 1K tokens = $0.000001 per token

const costPerToken = 0.000001; // Match OpenAI pricing
```

### Example 2: Premium Pricing

**Goal:** Position as premium service with better quality

```typescript
// Charge 2x OpenAI pricing
const openAICostPerToken = 0.000001;
const costPerToken = openAICostPerToken * 2; // $0.000002 per token
```

### Example 3: Cost-Plus Pricing

**Goal:** Cover infrastructure costs + profit margin

```typescript
// Calculate actual infrastructure cost
const serverCostPerHour = 0.10; // $0.10/hour for GPU instance
const tokensPerHour = 100000; // Estimated tokens per hour
const costPerToken = serverCostPerHour / tokensPerHour; // $0.000001 per token

// Add 50% markup for profit
const costPerToken = (serverCostPerHour / tokensPerHour) * 1.5;
```

### Example 4: Freemium Model

**Goal:** Free tier to attract users, paid for heavy usage

```typescript
function calculateFreemiumCost(tokensUsed: number, monthlyTokensUsed: number): number {
    // Free tier: First 10,000 tokens/month
    const freeTier = 10000;
    if (monthlyTokensUsed <= freeTier) {
        return 0; // Free
    }
    
    // Paid tier: $0.00001 per token after free tier
    const paidTokens = Math.max(0, monthlyTokensUsed - freeTier);
    return paidTokens * 0.00001;
}
```

### Example 5: Ultravox Voice AI

**Goal:** Charge per minute as Ultravox does ($0.05 per minute)

```typescript
// Ultravox configuration
const ultravoxConfig: AIProviderConfig = {
    providerId: 'ultravox-production',
    type: 'ultravox',
    pricingModel: 'per-minute',
    costPerMinute: 0.05, // $0.05 per minute
    roundUpMinutes: true, // Round up to nearest minute
    minimumMinutes: 1, // Minimum 1 minute charge
};

// Cost calculation
function calculateUltravoxCost(durationSeconds: number): number {
    const durationMinutes = Math.ceil(durationSeconds / 60); // Round up
    const minimumMinutes = 1; // Minimum charge
    const actualMinutes = Math.max(minimumMinutes, durationMinutes);
    return actualMinutes * 0.05; // $0.05 per minute
}

// Examples:
// 30 seconds = 1 minute (minimum) = $0.05
// 90 seconds = 2 minutes (rounded up) = $0.10
// 150 seconds = 3 minutes (rounded up) = $0.15
// 60 seconds = 1 minute = $0.05
```

## Billing Integration

### Admin API Endpoints

**Get Monthly Bill:**
```http
GET /api/bots/billing/:userId?month=2025-01
```

**Response:**
```json
{
  "userId": "user-123",
  "month": "2025-01",
  "totalCost": 15.50,
  "breakdown": {
    "lmstudio": {
      "cost": 10.00,
      "tokens": 1000000,
      "requests": 5000
    },
    "openai": {
      "cost": 5.50,
      "tokens": 550000,
      "requests": 2000
    }
  },
  "bots": [
    {
      "botId": "bot-123",
      "cost": 8.00,
      "tokens": 800000
    }
  ]
}
```

### Invoice Generation

Admin API can generate invoices from usage data:

```typescript
// Generate invoice for user
async function generateInvoice(userId: string, month: string): Promise<Invoice> {
    const usage = await getMonthlyUsage(userId, month);
    
    return {
        userId,
        month,
        items: usage.breakdown.map(provider => ({
            description: `AI Usage - ${provider.name}`,
            quantity: provider.tokens,
            unitPrice: provider.costPerToken,
            total: provider.cost,
        })),
        total: usage.totalCost,
    };
}
```

## Best Practices

1. **Transparent Pricing:**
   - Show pricing clearly in admin UI
   - Display cost estimates before usage
   - Provide cost breakdowns in billing

2. **Fair Pricing:**
   - Price competitively with alternatives
   - Consider your actual costs
   - Add reasonable markup for profit

3. **Usage Limits:**
   - Set limits to prevent abuse
   - Alert users approaching limits
   - Graceful degradation when limits reached

4. **Cost Monitoring:**
   - Track costs in real-time
   - Alert on unusual usage patterns
   - Provide cost analytics to users

5. **Billing Accuracy:**
   - Double-check cost calculations
   - Audit usage data regularly
   - Provide detailed invoices

## Summary

- **LMStudio**: You control pricing (per token, per request, hybrid, etc.)
- **OpenAI/Anthropic**: Pass-through or markup on provider costs
- **Tracking**: All usage tracked with calculated costs
- **Billing**: Admin API aggregates costs for invoicing
- **Flexibility**: Multiple pricing models supported

