# Security Considerations

## Overview

This document outlines security considerations for the bot system, particularly regarding sensitive data storage and access control.

## WAM File Security

### Public Access

**Important**: WAM files are publicly accessible via HTTP GET requests. Anyone with the URL can access them.

**Implications:**
- ❌ **NEVER** store sensitive data in WAM files
- ❌ **NEVER** store API keys, tokens, or credentials
- ❌ **NEVER** store private endpoints or URLs
- ✅ Only store public, non-sensitive configuration

### What's Safe in WAM Files

```json
{
  "bots": {
    "bot-1": {
      "botId": "bot-1",
      "name": "Helper Bot",
      "position": { "x": 100, "y": 100 },
      "behaviorType": "social",
      "behaviorConfig": {
        "conversationRadius": 300,
        "wanderRadius": 500,
        "wanderCenter": { "x": 500, "y": 500 },
        "assignedSpace": {
          "center": { "x": 500, "y": 500 },
          "radius": 200
        }
      },
      "aiProvider": "lmstudio",  // Just the provider name
      "aiConfigRef": "bot-1-ai-config"  // Reference ID only
    }
  }
}
```

### What Must Be in Admin API (Private)

```json
{
  "botId": "bot-1",
  "aiConfig": {
    "apiKey": "sk-...",           // SECRET
    "endpoint": "http://...",      // SECRET
    "token": "...",                // SECRET
    "model": "llama-2-7b",
    "temperature": 0.7
  },
  "chatInstructions": "You are an alien from Mars...",  // SECRET
  "movementInstructions": "Your job is to welcome visitors..."  // SECRET
}
```

## Secure Architecture

### Data Separation

**Public Data (WAM Files):**
- Bot ID, name, position
- Behavior type and public config
- Assigned space coordinates
- Character textures
- AI provider name (reference only)

**Private Data (Admin API):**
- AI provider credentials (API keys, tokens, endpoints)
- Chat instructions (system prompts)
- Movement instructions (behavioral rules)
- Private configuration
- User associations

### Runtime Flow

```
1. Map loads → WAM file read (public data)
   ↓
2. BotManager spawns bots from WAM data
   ↓
3. For each bot, fetch sensitive config from Admin API
   ↓
4. Combine public (WAM) + private (Admin API) config
   ↓
5. Initialize BotClient with complete config
   ↓
6. Sensitive data never stored in WAM
```

### Bot Editor Flow

```
1. User opens Bot Editor sidebar
   ↓
2. Load public config from WAM file
   ↓
3. Fetch sensitive config from Admin API (authenticated)
   ↓
4. Display combined config in editor
   ↓
5. User edits configuration
   ↓
6. Save public config to WAM file
   ↓
7. Save sensitive config to Admin API (authenticated)
```

## Sensitive Data Types

### 1. AI Provider Credentials

**Examples:**
- LMStudio API keys
- Ultravox API keys
- GPT Voice API keys
- Custom endpoints
- Authentication tokens

**Storage:** Admin API only

**Access:** Via authenticated Admin API calls

### 2. Chat Instructions

**Purpose:** System prompts that define bot personality and conversation behavior

**Examples:**
- "You are an alien from Mars. You are friendly and want to be friends with humans..."
- "You are a helpful assistant. Always be polite and professional..."
- "You are a medieval knight. Speak in old English and be chivalrous..."

**Storage:** Admin API only

**Access:** Fetched at bot initialization, used by AI provider

**Why Sensitive:**
- May contain proprietary instructions
- Reveals bot behavior patterns
- Could be used to manipulate bots

### 3. Movement Instructions

**Purpose:** Behavioral rules for who to approach and when

**Examples:**
- "Your job is to welcome visitors. Only welcome visitors entering the lobby..."
- "Do not welcome a visitor if you already seen them today, unless asked to..."
- "You can talk to coworkers but not too much. Once per 2-3 days is enough..."

**Storage:** Admin API only

**Access:** Fetched at bot initialization, used by behavior system

**Why Sensitive:**
- Reveals business logic
- May contain proprietary rules
- Could be used to predict bot behavior

## Access Control

### Bot Editor Access

**Requirements:**
- User must be authenticated
- User must have edit permissions for the map
- User must own the bot OR have admin privileges

**Implementation:**
```typescript
// In Bot Editor
async loadBotConfig(botId: string) {
  // Load public config from WAM
  const publicConfig = await loadFromWAM(botId);
  
  // Fetch sensitive config from Admin API (requires auth)
  const sensitiveConfig = await adminApi.getBotConfiguration(botId, {
    includeSensitive: true,
    userId: currentUser.id
  });
  
  // Combine and display
  return { ...publicConfig, ...sensitiveConfig };
}

async saveBotConfig(botId: string, config: BotConfig) {
  // Separate public and sensitive
  const { aiConfig, chatInstructions, movementInstructions, ...publicConfig } = config;
  
  // Save public to WAM
  await saveToWAM(botId, publicConfig);
  
  // Save sensitive to Admin API (authenticated)
  await adminApi.saveBotConfiguration({
    botId,
    aiConfig,
    chatInstructions,
    movementInstructions,
    ...publicConfig
  });
}
```

### Runtime Access

**Requirements:**
- Bot server must have Admin API token
- Token must have read permissions for bot configs
- No user authentication required (server-to-server)

**Implementation:**
```typescript
// Bot server initialization
async initializeBot(botId: string, wamConfig: WAMBotData) {
  // Fetch sensitive config from Admin API
  const sensitiveConfig = await adminApiService.getBotConfiguration(botId);
  
  // Combine configs
  const fullConfig = {
    ...wamConfig,
    aiConfig: sensitiveConfig.aiConfig,
    chatInstructions: sensitiveConfig.chatInstructions,
    movementInstructions: sensitiveConfig.movementInstructions
  };
  
  // Initialize bot
  const bot = new BotClient(fullConfig);
  return bot;
}
```

## Security Best Practices

### 1. Never Log Sensitive Data

```typescript
// ❌ BAD
console.log('Bot config:', config); // May log API keys

// ✅ GOOD
console.log('Bot config:', {
  ...config,
  aiConfig: config.aiConfig ? '[REDACTED]' : undefined
});
```

### 2. Validate Input

```typescript
// Validate chat instructions
if (chatInstructions.length > 10000) {
  throw new Error('Chat instructions too long');
}

// Sanitize movement instructions
const sanitized = sanitizeInstructions(movementInstructions);
```

### 3. Encrypt at Rest (Optional)

For extra security, consider encrypting sensitive data in the database:

```sql
-- Encrypted column
ai_config_encrypted BYTEA,
chat_instructions_encrypted BYTEA,
movement_instructions_encrypted BYTEA
```

### 4. Rate Limiting

Limit access to sensitive endpoints:

```typescript
// Rate limit sensitive config access
const sensitiveConfigLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100 // 100 requests per minute
});
```

### 5. Audit Logging

Log access to sensitive data:

```typescript
// Log sensitive config access
auditLog.log({
  action: 'access_sensitive_config',
  botId: botId,
  userId: userId,
  timestamp: new Date()
});
```

## Data Flow Security

### Creation Flow

```
1. User creates bot in editor (authenticated)
   ↓
2. Public config saved to WAM (public)
   ↓
3. Sensitive config saved to Admin API (authenticated)
   ↓
4. Both configs linked by botId
```

### Loading Flow

```
1. Map loads → WAM file read (public)
   ↓
2. Bot server fetches sensitive config (server token)
   ↓
3. Configs combined in memory
   ↓
4. Bot initialized with complete config
```

### Editing Flow

```
1. User opens editor (authenticated)
   ↓
2. Public config loaded from WAM
   ↓
3. Sensitive config fetched from Admin API (authenticated)
   ↓
4. User edits (all config visible in UI)
   ↓
5. Public saved to WAM, sensitive saved to Admin API
```

## Compliance Considerations

### GDPR/Privacy

- Chat instructions may contain personal data references
- Movement instructions may reveal user behavior patterns
- Store only necessary data
- Implement data retention policies

### Data Retention

- Sensitive config: Retain while bot exists
- Usage metrics: 90 days recommended
- Audit logs: 1 year recommended

## Summary

**Key Principles:**
1. **WAM files = Public**: Only non-sensitive data
2. **Admin API = Private**: All sensitive data
3. **Editor = Combined View**: Users see everything, but storage is separated
4. **Runtime = Secure Fetch**: Sensitive data fetched securely at initialization
5. **Never Expose**: Sensitive data never in public files

This architecture ensures that sensitive bot configuration (AI credentials, chat instructions, movement instructions) is never exposed in publicly accessible WAM files while still allowing users to manage everything from the bot editor UI.

