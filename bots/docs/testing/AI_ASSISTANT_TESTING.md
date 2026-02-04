# AI Assistant Testing Guide

## How to Run Tests Programmatically (Same Way Bots Do)

The AI assistant can run tests the same way AutoPilot and the bot server do - by initializing BotManager and using its test runner.

### Pattern

```typescript
import { BotManager } from './server/BotManager';
import { AdminApiService } from './server/AdminApiService';
import { BotRegistry } from './BotRegistry';
import type { TestSuite } from './testing/types';

// 1. Initialize services (same as server/index.ts)
const adminApiService = new AdminApiService(ADMIN_API_URL, ADMIN_API_TOKEN);
const botRegistry = new BotRegistry('test-server', {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB_NUMBER || '1', 10),
});

// 2. Create and initialize BotManager
const botManager = new BotManager(adminApiService, botRegistry);
await botManager.initialize();

// 3. Get test runner
const testRunner = botManager.getTestRunner();
if (!testRunner) {
    throw new Error('Test runner not available (only in development mode)');
}

// 4. Create test suite
const testSuite: TestSuite = {
    id: `test-${Date.now()}`,
    name: 'Test Suite Name',
    testCases: [
        { 
            id: 'turn-1', 
            input: 'User message here',
            metadata: { preserveContext: true } // For multi-turn conversations
        },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
};

// 5. Run tests
const results = await testRunner.runTestSuite(testSuite, botId);

// 6. Analyze results
for (const result of results.results) {
    // Check for emotion block leakage
    const hasLeakage = result.response?.includes('[EMOTION_UPDATE]');
    
    // Check emotions
    if (result.emotions) {
        console.log(`Sentiment: ${result.emotions.personSentiment}`);
    }
    
    // Check metrics
    if (result.metrics?.repetitionScore > 0.8) {
        console.log('High repetition detected');
    }
}
```

### Quick Test Script

```bash
# Run with tsx
cd bots
tsx -e "$(cat << 'EOF'
import { BotManager } from './server/BotManager';
import { AdminApiService } from './server/AdminApiService';
import { BotRegistry } from './BotRegistry';

const botManager = new BotManager(
    new AdminApiService(process.env.ADMIN_API_URL || '', process.env.ADMIN_API_TOKEN || ''),
    new BotRegistry('test', { host: 'localhost', port: 6379, db: 1 })
);
await botManager.initialize();
const testRunner = botManager.getTestRunner();
// ... use testRunner
EOF
)"
```

### Key Points

1. **Same initialization as server**: Use the exact same pattern as `bots/server/index.ts`
2. **Test runner only in dev**: `getTestRunner()` returns `null` in production
3. **Preserve context**: Use `metadata: { preserveContext: true }` for multi-turn conversations
4. **Results include emotions**: Check `result.emotions` for AI-detected sentiment
5. **Check for leakage**: Always verify `[EMOTION_UPDATE]` blocks are removed from responses
