# Getting Started: AI Integration Implementation

## Current Status

✅ **Phase 1: Planning & Design** - Complete
- Architecture documented
- Requirements defined
- Security considerations addressed

🚧 **Phase 2: Admin API Implementation** - **START HERE**

## Implementation Order

### Phase 2: Admin API (Current Priority)

**Goal:** Set up Admin API to store AI provider configurations and track usage.

**What You Need to Do:**

1. **Database Schema**
   ```sql
   -- Create AI providers table
   CREATE TABLE bots_ai_providers (
       provider_id VARCHAR(50) PRIMARY KEY,
       name VARCHAR(255) NOT NULL,
       type VARCHAR(50) NOT NULL CHECK (type IN ('lmstudio', 'openai', 'anthropic', 'ultravox', 'gpt-voice')),
       enabled BOOLEAN DEFAULT true,
       endpoint VARCHAR(500),
       api_key_encrypted TEXT,  -- Encrypted API key
       model VARCHAR(255),
       temperature DECIMAL(3,2) DEFAULT 0.7,
       max_tokens INTEGER DEFAULT 500,
       supports_streaming BOOLEAN DEFAULT true,
       settings JSONB,
       created_at TIMESTAMP DEFAULT NOW(),
       updated_at TIMESTAMP DEFAULT NOW()
   );

   -- Create usage tracking table
   CREATE TABLE bots_ai_usage (
       id SERIAL PRIMARY KEY,
       bot_id VARCHAR(255) NOT NULL,
       provider_id VARCHAR(50) NOT NULL,
       tokens_used INTEGER DEFAULT 0,
       api_calls INTEGER DEFAULT 1,
       duration_seconds INTEGER,  -- For voice AI
       cost DECIMAL(10,4),
       latency INTEGER,
       error BOOLEAN DEFAULT false,
       timestamp TIMESTAMP DEFAULT NOW(),
       
       FOREIGN KEY (provider_id) REFERENCES bots_ai_providers(provider_id),
       INDEX idx_bot_id (bot_id),
       INDEX idx_provider_id (provider_id),
       INDEX idx_timestamp (timestamp)
   );
   ```

2. **Endpoints to Implement**
   - `GET /api/bots/ai-providers/:providerId/credentials` - Get provider credentials
   - `GET /api/bots/ai-providers?enabled=true` - List providers
   - `POST /api/bots/ai-usage` - Track usage

3. **Service Token Setup**
   - Create `BOT_SERVICE_TOKEN` with scoped permissions
   - Permissions needed: `bots:ai-providers:read`, `bots:ai-usage:write`

4. **Encryption**
   - Encrypt API keys at rest
   - Decrypt when returning to bot server

**See:** `ADMIN_API_REQUIREMENTS.md` for detailed endpoint specs

---

### Phase 3: Bot Server Core

**Goal:** Create AI service infrastructure in bot server.

**What You Need to Do:**

1. **Create Directory Structure**
   ```
   bots/
   ├── ai/
   │   ├── AIService.ts
   │   ├── AIProvider.ts
   │   ├── AIProviderRegistry.ts
   │   └── providers/
   │       └── LMStudioProvider.ts
   ```

2. **Implement Core Classes**
   - `AIService` - Main service for AI operations
   - `AIProvider` interface - Contract for all providers
   - `AIProviderRegistry` - Manages provider instances
   - `LMStudioProvider` - First provider implementation

3. **Integrate with BotManager**
   - Initialize AIService in BotManager
   - Expose to behaviors

**See:** `BOT_SERVER_REQUIREMENTS.md` for detailed implementation

---

### Phase 4: LMStudio Provider

**Goal:** Implement LMStudio provider for local LLM.

**What You Need to Do:**

1. **Create `LMStudioProvider.ts`**
   - Implement `AIProvider` interface
   - Handle OpenAI-compatible API
   - Support streaming
   - Error handling and retries

2. **Test**
   - Connect to local LMStudio instance
   - Test streaming responses
   - Verify error handling

---

### Phase 5: Behavior Integration

**Goal:** Connect AI to bot behaviors.

**What You Need to Do:**

1. **Update `SocialBehavior.onChatMessage()`**
   - Call AIService
   - Handle streaming
   - Store in conversation memory
   - Track usage

2. **Update `PatrolBehavior.onChatMessage()`**
   - Same as SocialBehavior

3. **Update `IdleBehavior.onChatMessage()`**
   - Same as SocialBehavior

---

### Phase 6: Usage Tracking

**Goal:** Track AI usage for billing/analytics.

**What You Need to Do:**

1. **Implement tracking in AIService**
   - Track tokens, API calls, latency
   - Calculate costs
   - Send to Admin API

2. **Verify**
   - Check Admin API receives data
   - Verify cost calculations

---

## Quick Start Checklist

### Step 1: Admin API Setup
- [ ] Create database tables
- [ ] Implement credential endpoint
- [ ] Implement list providers endpoint
- [ ] Implement usage tracking endpoint
- [ ] Set up service token
- [ ] Test endpoints

### Step 2: Bot Server Setup
- [ ] Create `bots/ai/` directory
- [ ] Create `AIService.ts`
- [ ] Create `AIProvider.ts` interface
- [ ] Create `AIProviderRegistry.ts`
- [ ] Integrate with BotManager
- [ ] Add environment variables

### Step 3: LMStudio Provider
- [ ] Create `LMStudioProvider.ts`
- [ ] Implement streaming
- [ ] Test with real LMStudio
- [ ] Add error handling

### Step 4: Behavior Integration
- [ ] Update SocialBehavior
- [ ] Update PatrolBehavior
- [ ] Update IdleBehavior
- [ ] Test end-to-end

### Step 5: Usage Tracking
- [ ] Implement tracking
- [ ] Test with Admin API
- [ ] Verify data accuracy

---

## Environment Variables Needed

**Bot Server:**
```bash
ADMIN_API_URL=http://admin-api.workadventure.localhost
BOT_SERVICE_TOKEN=your-service-token-here
AI_MODE=direct  # or 'proxy' for production
```

**Admin API:**
```bash
ENCRYPTION_KEY=your-32-byte-encryption-key
```

---

## Testing Plan

1. **Unit Tests**
   - AIService credential fetching
   - LMStudioProvider streaming
   - Error handling

2. **Integration Tests**
   - End-to-end: Bot receives message → AI generates response → Bot sends response
   - Admin API integration
   - Multiple concurrent streams

3. **Manual Testing**
   - Spawn a social bot
   - Send it a message
   - Verify AI response
   - Check usage tracking

---

## What NOT to Do

❌ **Don't start Phase 3 until Phase 2 is complete**
❌ **Don't implement multiple providers until LMStudio works**
❌ **Don't add bot-to-bot communication (that's future work)**
❌ **Don't skip testing**

---

## Getting Help

- **Architecture Questions:** See `ARCHITECTURE.md`
- **Admin API Specs:** See `ADMIN_API_REQUIREMENTS.md`
- **Bot Server Specs:** See `BOT_SERVER_REQUIREMENTS.md`
- **Provider Details:** See `PROVIDERS.md`
- **Future Ideas:** See `FUTURE_PLANS.md` (but don't implement yet!)

---

## Next Action

**Start with Phase 2: Admin API Implementation**

1. Review `ADMIN_API_REQUIREMENTS.md`
2. Create database tables
3. Implement the three endpoints
4. Set up service token
5. Test endpoints with Postman/curl

Once Phase 2 is complete, move to Phase 3.

