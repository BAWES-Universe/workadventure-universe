# AI Provider Architecture

## Overview

The bot system separates AI provider configuration (admin-side) from bot behavior configuration (user-side). This allows admins to test and enable AI providers independently, while users focus on writing bot instructions and configuring behavior.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin API (Superadmin)                     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ AI Provider Configuration                            │   │
│  │                                                       │   │
│  │ • Enable/disable providers (OpenAI, Anthropic, etc.) │   │
│  │ • Configure API keys and endpoints                   │   │
│  │ • Select models per provider                        │   │
│  │ • Set provider-specific settings                    │   │
│  │ • Test providers before enabling                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Bot Configuration (with AI Provider Reference)      │   │
│  │                                                       │   │
│  │ • botId: "bot-123"                                   │   │
│  │ • aiProviderRef: "openai-gpt4" (reference)          │   │
│  │ • chatInstructions: "You are a friendly greeter..." │   │
│  │ • movementInstructions: "Stand near entrance..."     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Bot Editor (User-Facing in WorkAdventure)       │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Bot Behavior Configuration                             │   │
│  │                                                       │   │
│  │ • Name, description, position                        │   │
│  │ • Behavior type (Idle/Patrol/Social)                │   │
│  │ • Assigned space                                     │   │
│  │ • Chat instructions (natural language)              │   │
│  │ • Movement instructions (natural language)           │   │
│  │ • Map awareness settings                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Map Awareness & Movement Tooling                      │   │
│  │                                                       │   │
│  │ • Visual position picker                             │   │
│  │ • Area selection (where bot can go)                  │   │
│  │ • Restricted zones (where bot can't go)             │   │
│  │ • Waypoint configuration (for patrol)               │   │
│  │ • Proximity detection settings                       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Bot Server                                │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ AI Provider Abstraction Layer                        │   │
│  │                                                       │   │
│  │ • Loads provider config from Admin API                │   │
│  │ • Routes requests to correct provider                │   │
│  │ • Handles provider-specific API calls                │   │
│  │ • Manages conversation context                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ AI Providers (Pluggable)                             │   │
│  │                                                       │   │
│  │ • OpenAIProvider                                     │   │
│  │ • AnthropicProvider                                 │   │
│  │ • LlamaProvider (local)                             │   │
│  │ • LMStudioProvider                                  │   │
│  │ • UltravoxProvider (voice)                           │   │
│  │ • GPTVoiceProvider                                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Admin Side: AI Provider Management

### Provider Configuration

Admins configure AI providers in the Admin API:

```json
{
  "providerId": "openai-gpt4",
  "name": "OpenAI GPT-4",
  "type": "openai",
  "enabled": true,
  "apiKey": "sk-...",  // Stored securely
  "endpoint": "https://api.openai.com/v1",
  "defaultModel": "gpt-4",
  "availableModels": ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
  "settings": {
    "temperature": 0.7,
    "maxTokens": 1000,
    "timeout": 30000
  },
  "tested": true,
  "testedAt": "2024-01-15T10:00:00Z"
}
```

### Provider Lifecycle

1. **Testing Phase**:
   - Admin adds provider configuration
   - `enabled: false`, `tested: false`
   - Admin tests provider with test bot
   - Admin verifies responses, latency, costs

2. **Enablement**:
   - Admin sets `enabled: true`, `tested: true`
   - Provider becomes available for bot creation
   - Can be set as default provider

3. **Usage**:
   - Users create bots → select from enabled providers
   - Bot server uses provider config for API calls
   - Admin can monitor usage and costs

4. **Disablement**:
   - Admin can disable provider (`enabled: false`)
   - Existing bots continue using it (grandfathered)
   - New bots can't select disabled provider

### Provider Selection in Bot Editor

When users create/edit bots, they see:
- **Provider dropdown**: Only shows enabled providers
- **Provider info**: Name, model, capabilities
- **No API keys**: Never exposed to users

Example:
```
AI Provider: [OpenAI GPT-4 ▼]
  - Anthropic Claude 3
  - Llama 2 (Local)
  - LMStudio
  - OpenAI GPT-4 (default)
```

## User Side: Bot Behavior Configuration

### Chat Instructions

Users write natural language instructions for what the bot should say:

```
You are a friendly greeter bot named "WelcomeBot". 
Your job is to:
- Welcome new visitors to the lobby
- Answer questions about the space
- Be helpful and cheerful
- Don't repeat the same greeting to someone you've already greeted today
```

### Movement Instructions

Users write natural language instructions for how the bot should move:

```
Your movement behavior:
- Stand near the main entrance (coordinates 500, 300)
- When a new visitor enters, approach them within 5 tiles
- After greeting, return to your position near the entrance
- Don't follow visitors into private areas
- Stay within the lobby area (defined by assigned space)
```

### Map Awareness Tooling

The bot editor provides visual tools for map awareness:

1. **Position Picker**:
   - Click "Pick from Map" button
   - Click on map → bot position set
   - Visual indicator shows bot location

2. **Assigned Space**:
   - Draw circle/rectangle on map
   - Bot stays within this area
   - Visual overlay shows boundaries

3. **Restricted Zones**:
   - Mark areas bot can't enter
   - Visual overlay shows restricted areas
   - Bot avoids these zones

4. **Waypoints** (for Patrol behavior):
   - Click on map to add waypoints
   - Bot follows waypoint path
   - Visual line shows patrol route

5. **Proximity Settings**:
   - Set detection radius
   - Visual circle shows detection area
   - Bot detects players within radius

## Data Flow

### Bot Creation Flow

1. **User in Bot Editor**:
   - Fills in bot name, position, behavior
   - Writes chat and movement instructions
   - Selects AI provider (from enabled list)
   - Clicks "Save"

2. **Bot Editor → Admin API**:
   ```json
   {
     "name": "WelcomeBot",
     "position": { "x": 500, "y": 300 },
     "behaviorType": "social",
     "chatInstructions": "You are a friendly greeter...",
     "movementInstructions": "Stand near entrance...",
     "aiProviderRef": "openai-gpt4"  // Reference, not config
   }
   ```

3. **Admin API**:
   - Stores bot configuration
   - Links to AI provider config (by reference)
   - Returns bot ID

4. **Bot Server**:
   - Loads bot configuration
   - Fetches AI provider config from Admin API
   - Creates BotClient instance
   - Bot spawns on map

### AI Request Flow

1. **Bot detects player** → wants to start conversation
2. **Bot Server**:
   - Loads bot's `chatInstructions` and `movementInstructions`
   - Loads AI provider config (API key, endpoint, model)
   - Builds prompt with instructions + context
3. **AI Provider**:
   - Makes API call to provider (OpenAI, Anthropic, etc.)
   - Returns response
4. **Bot Server**:
   - Processes response
   - Bot sends chat message or takes action

## Benefits

1. **Security**: API keys never in user-facing UI
2. **Flexibility**: Admin can test and enable providers independently
3. **Simplicity**: Users don't need to understand AI providers
4. **Scalability**: Easy to add new providers (just configure in admin)
5. **Cost Control**: Admin can monitor and control provider usage
6. **Testing**: Providers can be tested before enabling for users

## Example: Adding a New Provider

1. **Admin tests Anthropic**:
   - Admin adds Anthropic config in Admin API
   - `enabled: false`, `tested: false`
   - Admin creates test bot with Anthropic
   - Admin verifies it works

2. **Admin enables Anthropic**:
   - Sets `enabled: true`, `tested: true`
   - Anthropic appears in provider dropdown

3. **Users can now use Anthropic**:
   - Users see "Anthropic Claude 3" in dropdown
   - Users create bots with Anthropic
   - Bot server uses Anthropic API for those bots

4. **No code changes needed**:
   - Provider is pluggable
   - Just configuration in Admin API
   - Bot server handles routing automatically

