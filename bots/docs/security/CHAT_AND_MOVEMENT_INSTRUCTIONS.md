# Chat & Movement Instructions

## Overview

Bots can be configured with detailed instructions that control their conversational behavior and movement decisions. These instructions are stored securely in the Admin API (not in publicly accessible WAM files).

## Chat Instructions

### Purpose

Chat instructions define the bot's personality, conversation style, and what it should say. These are used as system prompts for the AI provider (LMStudio, Ultravox, GPT Voice).

### Examples

**Alien Bot:**
```
You are an alien coming from Mars. You are a nice alien and want to be our friend. 
Please make up as much details as possible based on pop culture, and don't hesitate 
to start by presenting yourself. Don't hesitate to repeat you don't want to invade 
the earth.
```

**Reception Bot:**
```
You are a friendly receptionist at a tech company. Always greet visitors warmly 
and offer to help them find their way. Be professional but approachable. If 
someone asks about the company, mention we're working on exciting AI projects.
```

**Medieval Knight Bot:**
```
You are a medieval knight from the 14th century. Speak in old English style, 
be chivalrous and honorable. Reference knights, castles, and medieval life. 
Always be polite and offer to help with quests.
```

### How It Works

1. **Storage**: Chat instructions stored in Admin API (secure)
2. **Usage**: Passed to AI provider as system prompt
3. **Context**: Combined with conversation history for AI responses
4. **Editing**: Can be edited in Bot Editor sidebar (authenticated users only)

### Implementation

```typescript
// In AI Provider
async generateResponse(
  chatInstructions: string,
  conversationHistory: Message[],
  userMessage: string
): Promise<string> {
  const systemPrompt = chatInstructions || "You are a helpful assistant.";
  
  const response = await this.aiClient.chat({
    system: systemPrompt,
    messages: [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ]
  });
  
  return response;
}
```

## Movement Instructions

### Purpose

Movement instructions define behavioral rules for who the bot should approach, when, and under what conditions. These are interpreted by the behavior system to make movement decisions.

### Examples

**Reception Bot:**
```
Your job is to welcome visitors entering the lobby. Only welcome visitors 
entering the lobby. Do not welcome a visitor if you already seen them today, 
unless asked to. You can talk to your coworkers but not do that too much. 
Once per 2 or 3 days is enough.
```

**Social Butterfly Bot:**
```
You are a social bot. Actively seek conversations with players you haven't 
talked to recently. Avoid players who are busy or in conversations. Don't 
interrupt ongoing conversations. Take breaks between conversations.
```

**Helper Bot:**
```
Stay near the help desk. Only approach players who look lost or confused. 
If a player asks for help, move closer to assist them. Don't follow players 
around unnecessarily.
```

### How It Works

1. **Storage**: Movement instructions stored in Admin API (secure)
2. **Parsing**: Behavior system parses instructions into rules
3. **Execution**: Rules applied during bot update loop
4. **Context**: Combined with player status, conversation history, etc.

### Implementation

```typescript
// In Behavior System
class InstructionParser {
  parseMovementInstructions(instructions: string): MovementRules {
    // Parse natural language into structured rules
    return {
      targetPlayers: this.extractTargets(instructions),
      conditions: this.extractConditions(instructions),
      restrictions: this.extractRestrictions(instructions),
      frequency: this.extractFrequency(instructions)
    };
  }
  
  private extractTargets(instructions: string): string[] {
    // Extract who to approach (e.g., "visitors", "coworkers")
    // Returns: ["visitors", "coworkers"]
  }
  
  private extractConditions(instructions: string): Condition[] {
    // Extract conditions (e.g., "entering lobby", "look lost")
    // Returns: [{ type: "location", value: "lobby" }, ...]
  }
  
  private extractRestrictions(instructions: string): Restriction[] {
    // Extract restrictions (e.g., "already seen today", "unless asked")
    // Returns: [{ type: "cooldown", duration: "1 day" }, ...]
  }
  
  private extractFrequency(instructions: string): Frequency {
    // Extract frequency (e.g., "once per 2-3 days")
    // Returns: { interval: "2-3 days", type: "conversation" }
  }
}
```

### Advanced Parsing (Future)

For complex instructions, consider using an LLM to parse:

```typescript
async parseInstructions(instructions: string): Promise<MovementRules> {
  const prompt = `Parse these movement instructions into structured rules:
  
  ${instructions}
  
  Return JSON with: targets, conditions, restrictions, frequency`;
  
  const parsed = await this.aiClient.parse(prompt);
  return JSON.parse(parsed);
}
```

## Configuration Structure

### Complete Bot Configuration

```typescript
interface BotConfiguration {
  // Public (WAM file)
  botId: string;
  name: string;
  position: PositionInterface;
  behaviorType: 'idle' | 'patrol' | 'social';
  behaviorConfig: {
    conversationRadius: number;
    wanderRadius: number;
    // ... other public config
  };
  aiProvider: string;  // Just the name
  aiConfigRef: string; // Reference ID
  
  // Private (Admin API only)
  aiConfig: {
    apiKey: string;        // SECRET
    endpoint: string;      // SECRET
    model: string;
    temperature: number;
  };
  chatInstructions: string;      // SECRET - AI system prompt
  movementInstructions: string;  // SECRET - Behavioral rules
}
```

## Bot Editor Integration

### UI Components

**Chat Instructions Editor:**
- Large text area for system prompt
- Character counter
- Preview/test button
- Examples/templates

**Movement Instructions Editor:**
- Text area for natural language instructions
- Visual rule builder (optional)
- Preview of parsed rules
- Examples/templates

### Editor Flow

```typescript
// In Bot Editor
async loadBotForEditing(botId: string) {
  // Load public config from WAM
  const publicConfig = await loadFromWAM(botId);
  
  // Fetch sensitive config from Admin API (authenticated)
  const sensitiveConfig = await adminApi.getBotConfiguration(botId, {
    includeSensitive: true,
    userId: currentUser.id
  });
  
  // Combine for display
  return {
    ...publicConfig,
    chatInstructions: sensitiveConfig.chatInstructions,
    movementInstructions: sensitiveConfig.movementInstructions,
    aiConfig: sensitiveConfig.aiConfig
  };
}

async saveBot(botId: string, config: BotConfig) {
  // Separate public and sensitive
  const { chatInstructions, movementInstructions, aiConfig, ...publicConfig } = config;
  
  // Save public to WAM
  await saveToWAM(botId, publicConfig);
  
  // Save sensitive to Admin API
  await adminApi.saveBotConfiguration({
    botId,
    chatInstructions,
    movementInstructions,
    aiConfig
  });
}
```

## Usage in Behaviors

### SocialBehavior with Instructions

```typescript
class SocialBehavior extends BaseBehavior {
  private chatInstructions: string;
  private movementRules: MovementRules;
  
  constructor(config: SocialBehaviorConfig) {
    super(config);
    this.chatInstructions = config.chatInstructions || '';
    this.movementRules = this.parseInstructions(config.movementInstructions || '');
  }
  
  update(deltaTime: number): void {
    // Apply movement rules
    const target = this.findTargetPlayer(this.movementRules);
    if (target) {
      this.approachPlayer(target);
    }
  }
  
  onChatMessage(spaceName: string, message: string, senderId: number): void {
    // Use chat instructions for AI response
    const response = await this.aiProvider.generateResponse(
      this.chatInstructions,
      this.conversationHistory,
      message
    );
    this.bot.sendChatMessage(spaceName, response);
  }
}
```

## Best Practices

### Chat Instructions

1. **Be Specific**: Clear personality and behavior
2. **Set Boundaries**: What bot should/shouldn't do
3. **Include Examples**: Show desired conversation style
4. **Keep It Concise**: Too long may confuse the AI
5. **Test Regularly**: Adjust based on bot behavior

### Movement Instructions

1. **Be Clear**: Use simple, direct language
2. **Specify Targets**: Who to approach
3. **Set Conditions**: When to approach
4. **Define Restrictions**: When NOT to approach
5. **Include Frequency**: How often to interact

### Security

1. **Never in WAM**: Instructions stored only in Admin API
2. **Authenticated Access**: Only authorized users can edit
3. **Audit Logging**: Log who edits instructions
4. **Validation**: Validate instruction length and content

## Examples

### Complete Bot Configuration Example

**WAM File (Public):**
```json
{
  "bots": {
    "reception-bot": {
      "botId": "reception-bot",
      "name": "Reception Bot",
      "position": { "x": 500, "y": 500 },
      "behaviorType": "social",
      "behaviorConfig": {
        "conversationRadius": 300,
        "assignedSpace": {
          "center": { "x": 500, "y": 500 },
          "radius": 200
        }
      },
      "aiProvider": "lmstudio",
      "aiConfigRef": "reception-bot-ai-config"
    }
  }
}
```

**Admin API (Private):**
```json
{
  "botId": "reception-bot",
  "aiConfig": {
    "apiKey": "sk-...",
    "endpoint": "http://localhost:1234",
    "model": "llama-2-7b",
    "temperature": 0.7
  },
  "chatInstructions": "You are a friendly receptionist at a tech company. Always greet visitors warmly and offer to help them find their way. Be professional but approachable.",
  "movementInstructions": "Your job is to welcome visitors entering the lobby. Only welcome visitors entering the lobby. Do not welcome a visitor if you already seen them today, unless asked to. You can talk to your coworkers but not do that too much. Once per 2 or 3 days is enough."
}
```

## Summary

- **Chat Instructions**: Define bot personality and conversation style (stored in Admin API)
- **Movement Instructions**: Define who to approach and when (stored in Admin API)
- **Both are sensitive**: Never stored in publicly accessible WAM files
- **Editable in UI**: Users can edit from Bot Editor sidebar (authenticated)
- **Used at runtime**: Instructions fetched from Admin API and applied by behavior system

