# Admin API Requirements for AI Infrastructure

This document outlines what needs to be implemented in the Admin API to support AI provider functionality.

## Required Endpoints

### 1. Get AI Provider Credentials

**Endpoint:** `GET /api/bots/ai-providers/:providerId/credentials`

**Purpose:** Bot server fetches provider credentials to make AI calls.

**Authentication:** `Bearer BOT_SERVICE_TOKEN` (service token, not admin token)

**Request:**
```http
GET /api/bots/ai-providers/lmstudio/credentials
Authorization: Bearer bot-service-readonly-token
```

**Response:**
```json
{
  "providerId": "lmstudio",
  "name": "LMStudio",
  "type": "lmstudio",
  "enabled": true,
  "endpoint": "http://localhost:1234",
  "apiKey": null,  // Not needed for LMStudio
  "model": "local-model",
  "temperature": 0.7,
  "maxTokens": 500,
  "supportsStreaming": true,
  "settings": {
    "timeout": 30000
  }
}
```

**Response Codes:**
- `200 OK` - Credentials returned
- `401 Unauthorized` - Invalid service token
- `403 Forbidden` - Service token doesn't have permission
- `404 Not Found` - Provider not found
- `400 Bad Request` - Provider not enabled

**Security:**
- Only return credentials if provider is enabled
- Service token must have `bots:ai-providers:read` permission
- Credentials should be decrypted before returning (stored encrypted in DB)

### 2. List Available Providers

**Endpoint:** `GET /api/bots/ai-providers?enabled=true`

**Purpose:** Bot editor UI needs to show available providers in dropdown.

**Authentication:** `Bearer BOT_SERVICE_TOKEN` or user token

**Request:**
```http
GET /api/bots/ai-providers?enabled=true
Authorization: Bearer bot-service-readonly-token
```

**Response:**
```json
[
  {
    "providerId": "lmstudio",
    "name": "LMStudio",
    "type": "lmstudio",
    "enabled": true,
    "supportsStreaming": true
  },
  {
    "providerId": "openai",
    "name": "OpenAI GPT-4",
    "type": "openai",
    "enabled": true,
    "supportsStreaming": true
  }
]
```

**Query Parameters:**
- `enabled` (optional) - Filter by enabled status
- `type` (optional) - Filter by provider type

**Response Codes:**
- `200 OK` - List of providers
- `401 Unauthorized` - Invalid token

**Note:** This endpoint should NOT return credentials, only metadata.

### 3. Track AI Usage

**Endpoint:** `POST /api/bots/ai-usage`

**Purpose:** Bot server tracks AI usage (tokens, API calls, costs) for analytics and billing.

**Authentication:** `Bearer BOT_SERVICE_TOKEN`

**Request:**
```http
POST /api/bots/ai-usage
Authorization: Bearer bot-service-readonly-token
Content-Type: application/json

{
  "botId": "bot-123",
  "providerId": "lmstudio",
  "tokensUsed": 150,
  "apiCalls": 1,
  "latency": 1250,
  "error": false,
  "timestamp": "2025-01-09T12:00:00Z"
}
```

**Response:**
```json
{
  "status": "tracked",
  "usageId": "usage-456"
}
```

**Response Codes:**
- `200 OK` - Usage tracked
- `400 Bad Request` - Invalid data
- `401 Unauthorized` - Invalid service token

**Note:** This should be fire-and-forget. Don't block bot operation if tracking fails.

## Database Schema

### Table: `bots_ai_providers`

```sql
CREATE TABLE bots_ai_providers (
    provider_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'lmstudio', 'openai', 'anthropic', etc.
    enabled BOOLEAN DEFAULT false,
    endpoint TEXT,
    api_key_encrypted TEXT, -- Encrypted API key
    model VARCHAR(255),
    temperature DECIMAL(3,2) DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 500,
    supports_streaming BOOLEAN DEFAULT true,
    settings JSONB, -- Provider-specific settings
    tested BOOLEAN DEFAULT false,
    tested_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_enabled (enabled),
    INDEX idx_type (type)
);
```

### Table: `bots_ai_usage`

```sql
CREATE TABLE bots_ai_usage (
    id SERIAL PRIMARY KEY,
    bot_id VARCHAR(255) NOT NULL,
    provider_id VARCHAR(50) NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    api_calls INTEGER DEFAULT 1,
    cost DECIMAL(10,4), -- Cost in USD or credits
    latency INTEGER, -- Milliseconds
    error BOOLEAN DEFAULT false,
    timestamp TIMESTAMP DEFAULT NOW(),
    
    FOREIGN KEY (provider_id) REFERENCES bots_ai_providers(provider_id),
    INDEX idx_bot_id (bot_id),
    INDEX idx_provider_id (provider_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_bot_provider_timestamp (bot_id, provider_id, timestamp)
);
```

## Service Token Permissions

The `BOT_SERVICE_TOKEN` should have these scoped permissions:

```json
{
  "permissions": [
    "bots:ai-providers:read",      // Read provider configs
    "bots:ai-providers:credentials", // Get credentials
    "bots:ai-usage:write",          // Track usage
    "bots:configuration:read"       // Read bot configs (for chat instructions)
  ]
}
```

**NOT allowed:**
- ❌ `bots:ai-providers:write` - Can't modify providers
- ❌ `bots:configuration:write` - Can't modify bot configs
- ❌ `users:*` - No user data access
- ❌ `admin:*` - No admin functions

## Encryption

Provider credentials (especially API keys) should be encrypted at rest:

```typescript
// Example encryption approach
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32-byte key
const ALGORITHM = 'aes-256-gcm';

function encryptApiKey(apiKey: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptApiKey(encrypted: string): string {
    const [ivHex, authTagHex, encryptedData] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}
```

## Admin UI Requirements

Admins need to be able to:

1. **Create/Edit Providers:**
   - Provider ID, name, type
   - Endpoint URL
   - API key (encrypted on save)
   - Model selection
   - Temperature, max tokens
   - Enable/disable toggle
   - Test connection button

2. **View Usage:**
   - Usage by provider
   - Usage by bot
   - Cost tracking
   - Token usage graphs
   - Error rates

3. **Manage Credentials:**
   - Rotate API keys
   - View last used timestamp
   - See which bots are using which providers

## Testing Requirements

Before enabling a provider for production:

1. **Connection Test:**
   - Test endpoint connectivity
   - Verify API key works
   - Check model availability

2. **Response Test:**
   - Generate test response
   - Verify streaming works
   - Check response quality

3. **Performance Test:**
   - Measure latency
   - Check token usage
   - Verify error handling

## Migration Plan

1. **Phase 1: Database Setup**
   - Create tables
   - Set up encryption
   - Create service token

2. **Phase 2: Basic Endpoints**
   - Implement credential endpoint
   - Implement list endpoint
   - Implement usage tracking

3. **Phase 3: Admin UI**
   - Provider management UI
   - Usage dashboard
   - Testing tools

4. **Phase 4: Integration**
   - Bot server integration
   - Testing with real bots
   - Monitoring and alerts

