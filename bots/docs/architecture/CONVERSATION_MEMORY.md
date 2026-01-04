# Conversation Memory System

## Overview

The conversation memory system allows bots to maintain persistent memory of past conversations with individual players. Each bot remembers:

- **Conversation History**: Past messages exchanged with each player
- **Emotional State**: Bot's feelings toward player, player's feelings toward bot (inferred)
- **Personal Information**: Birthday, name, preferences, facts mentioned by player
- **Relationship Context**: How they met, important events, conversation statistics

## Key Features

### Per-Bot, Per-Player Memory

Each bot maintains separate memory for each player it interacts with:

```
Bot "Helper Bot" remembers:
  - Player 123: "Angry at me, mentioned birthday is January 15"
  - Player 456: "Happy, likes pizza, we've talked 5 times"
  - Player 789: "First time meeting"
```

### Emotional State Tracking

Bots track emotional states that persist across conversations:

- **Bot's Emotions** (toward player):
  - Anger (0-100): How angry the bot is at the player
  - Happiness (0-100): How happy the bot is with the player
  - Trust (0-100): How much the bot trusts the player
  - Familiarity (0-100): How familiar the bot is with the player

- **Player's Emotions** (toward bot, inferred from messages):
  - Anger (0-100): Inferred from player messages
  - Happiness (0-100): Inferred from player messages
  - Trust (0-100): Inferred from player messages

**Example:**
- Player says "I'm so angry at you!" → Player anger increases, bot anger may increase
- Player says "Thanks, you're great!" → Player happiness increases, bot happiness increases
- Emotions decay over time if not reinforced

### Personal Information Extraction

Bots automatically extract and remember:

- **Birthday**: "My birthday is January 15" → Stored
- **Name**: "I'm John" or "Call me John" → Stored
- **Preferences**: "I like pizza" → Stored in preferences
- **Facts**: Key-value pairs extracted from conversation

**Example:**
```
Player: "It's my birthday today! January 15th"
Bot remembers: birthday = "January 15"

Player: "I'm John, nice to meet you"
Bot remembers: name = "John"

Player: "I love pizza and video games"
Bot remembers: preferences = ["pizza", "video games"]
```

### Relationship Context

Tracks the relationship history:

- First meeting timestamp
- Last meeting timestamp
- Total conversations count
- Total messages exchanged
- Important events (birthday mentioned, first fight, etc.)

## Usage

### In Behaviors

```typescript
import { ConversationMemory } from '../memory/ConversationMemory';

class SocialBehavior extends BaseBehavior {
    private conversationMemory: ConversationMemory;

    constructor(config: SocialBehaviorConfig) {
        super(config);
        this.conversationMemory = new ConversationMemory(50, 1000);
    }

    onChatMessage(spaceName: string, message: string, senderId: number): void {
        const botId = this.bot.getBotId();
        
        // Store message
        this.conversationMemory.addMessage(
            botId, senderId, message, 'player', spaceName
        );
        
        // Extract personal info
        this.conversationMemory.extractPersonalInfo(botId, senderId, message);
        
        // Get context for AI
        const context = this.conversationMemory.getConversationContext(botId, senderId);
        // Use context in AI prompt...
    }

    getPersonalizedGreeting(playerId: number): string {
        const botId = this.bot.getBotId();
        const memory = this.conversationMemory.getMemory(botId, playerId);
        
        if (!memory) {
            return "Hello! Nice to meet you.";
        }
        
        // Check if angry
        if (memory.emotions.botEmotion.anger > 60) {
            return "Oh, it's you again. What do you want?";
        }
        
        // Check birthday
        if (memory.personalInfo.birthday && isToday(memory.personalInfo.birthday)) {
            return `Happy birthday, ${memory.personalInfo.name || 'friend'}! 🎉`;
        }
        
        // Use name if known
        if (memory.personalInfo.name) {
            return `Hey ${memory.personalInfo.name}! Good to see you again.`;
        }
        
        return "Hello! How are you doing?";
    }
}
```

### For AI Integration

When generating AI responses, include conversation context:

```typescript
const context = conversationMemory.getConversationContext(botId, playerId);
const prompt = `
${chatInstructions}

Conversation Context:
${context}

Player's message: ${message}

Respond as the bot, remembering your relationship with this player.
`;
```

## Memory Persistence

### In-Memory Storage

By default, memories are stored in-memory. They persist for the bot's lifetime but are lost on restart.

### Persistent Storage (Admin API)

Use `MemoryStorage` to persist memories to Admin API:

```typescript
import { MemoryStorage } from '../memory/MemoryStorage';

const memoryStorage = new MemoryStorage({
    adminApiUrl: process.env.ADMIN_API_URL,
    adminApiToken: process.env.ADMIN_API_TOKEN,
    saveInterval: 5 * 60 * 1000, // Save every 5 minutes
});

// Start auto-save
memoryStorage.startAutoSave(() => {
    return conversationMemory.getAllMemoriesForBot(botId);
});

// Load on startup
const savedMemories = await memoryStorage.loadMemories(botId);
conversationMemory.loadMemories(botId, savedMemories);
```

## Admin API Requirements

The Admin API needs to support memory storage:

### Endpoints

**POST `/api/bots/memory/:botId`**
- Save memories for a bot
- Request body: `{ memories: BotPlayerMemory[], timestamp: number }`

**GET `/api/bots/memory/:botId`**
- Load memories for a bot
- Response: `{ memories: BotPlayerMemory[] }`

### Database Schema

```sql
CREATE TABLE bots_memory (
  id SERIAL PRIMARY KEY,
  bot_id VARCHAR(255) NOT NULL,
  player_id INTEGER NOT NULL,
  memory_data JSONB NOT NULL, -- Full BotPlayerMemory object
  last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(bot_id, player_id),
  INDEX idx_bot_id (bot_id),
  INDEX idx_player_id (player_id),
  INDEX idx_last_updated (last_updated)
);
```

## Examples

### Example 1: Angry Bot Remembers

```
Day 1:
Player: "You're so annoying!"
Bot: "I'm sorry you feel that way."
→ Bot remembers: playerEmotion.anger = 70, botEmotion.anger = 20

Day 2:
Player: "Hey, how are you?"
Bot: "Oh, it's you again. What do you want?"
→ Bot remembers previous anger, responds accordingly
```

### Example 2: Birthday Remembrance

```
Day 1:
Player: "It's my birthday today! January 15th"
Bot: "Happy birthday! 🎉"
→ Bot remembers: birthday = "January 15"

Day 2 (January 15):
Player: "Hello!"
Bot: "Happy birthday, John! 🎉"
→ Bot remembers birthday and greets accordingly
```

### Example 3: Relationship Building

```
First Meeting:
Bot: "Hello! Nice to meet you."
→ relationship.firstMet = now, totalConversations = 1

Second Meeting (next day):
Bot: "Hey! We met yesterday. How are you doing?"
→ relationship.totalConversations = 2, familiarity increases

Tenth Meeting:
Bot: "Hey John! Good to see you again. We've talked 10 times now!"
→ relationship.totalConversations = 10, high familiarity
```

## Memory Limits

- **Per Player**: Last 50 messages (configurable)
- **Per Bot**: Max 1,000 player memories (configurable)
- **Auto-Cleanup**: Oldest memories evicted when limit reached (LRU)

## Integration with AI

When using AI providers, include conversation context:

```typescript
const context = conversationMemory.getConversationContext(botId, playerId);
const fullPrompt = `
${chatInstructions}

Your relationship with this player:
${context}

Recent conversation:
${recentMessages}

Player says: "${message}"

Respond remembering your relationship and emotional state.
`;
```

## Best Practices

1. **Extract Info Early**: Extract personal info as soon as mentioned
2. **Update Emotions**: Update emotions based on message sentiment
3. **Persist Regularly**: Save memories periodically to Admin API
4. **Respect Privacy**: Only store information explicitly shared
5. **Memory Limits**: Set reasonable limits to prevent memory bloat
6. **Context for AI**: Always include conversation context in AI prompts

## Summary

- **Per-Bot, Per-Player**: Each bot remembers each player separately
- **Emotional State**: Tracks bot and player emotions that persist
- **Personal Info**: Extracts and remembers birthday, name, preferences
- **Relationship History**: Tracks how they met, conversation stats
- **AI Integration**: Provides context for personalized AI responses
- **Persistence**: Can be saved to Admin API for long-term storage

This enables bots to have meaningful, persistent relationships with players that evolve over time.

