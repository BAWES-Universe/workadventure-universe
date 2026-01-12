# Next Steps: Bot System Roadmap

## Current Status (January 2025)

### ✅ Completed Features
- **Core Bot System**: Full WebSocket client with state management
- **Pathfinding System**: Full implementation using EasyStar.js
- **Behavior System**: Idle, Patrol, and Social behaviors fully implemented
- **Summon Functionality**: Players can summon bots to their location
- **Greeting Messages**: Configurable greeting messages for all bot types
- **Conversation Memory**: Per-bot, per-player memory system
- **User List Integration**: Bots appear in sidebar user list
- **Production Logging**: Environment-aware logging
- **Bot Editor UI**: Complete visual editor integrated into map editor
- **Bot List View**: List/grid view of all bots on the map
- **Bot Toggle**: Enable/disable bots individually

### 🚧 Current Priorities

1. **AI Integration** (High Priority)
   - Implement `AIProvider` interface
   - Create `LMStudioProvider` for local LLM
   - Integrate with conversation memory
   - Add response generation
   - Test AI responses with conversation context

2. **Bot Editor UX Improvements** (Medium Priority)
   - Better list/detail view pattern
   - Move AI configuration to admin side
   - Visual position picker on map
   - Improved waypoint editor for patrol bots

## Proposed Solution

### 1. List + Detail View Pattern (Like EntityEditor)

**List View (Default)**:
- Grid/list of all bots on the current map
- Each bot shows: name, preview image, position indicator
- "Create New Bot" button at top
- Click bot card → opens detail view

**Detail View**:
- Shows full bot configuration
- Properties tab: name, description, position (with map picker), character texture
- Behavior tab: behavior type, assigned space, behavior-specific settings
- Chat/Movement Instructions: text areas for instructions (stored in Admin API)
- Save/Delete buttons

### 2. Move AI Configuration to Admin Side

**What Stays in Bot Editor (User-Facing)**:
- Bot name, description
- Position on map (with visual picker)
- Character texture selection
- Behavior type and settings (Idle/Patrol/Social)
- Assigned space configuration
- **Chat instructions** (what the bot should say - natural language)
- **Movement instructions** (how the bot should move - natural language)
- Map awareness tooling (where bot can go, what areas to avoid, etc.)

**What Moves to Admin API (Superadmin Only)**:
- **AI Provider selection** (OpenAI, Anthropic, Llama, LMStudio, Ultravox, GPT Voice)
  - Can be set globally or per-bot-type
  - Can be enabled/disabled as providers are tested
  - Admin can add new providers after testing
- API endpoint configuration
- API keys/tokens (never exposed to users)
- Model selection (which model to use per provider)
- Provider-specific settings (temperature, max tokens, etc.)

**Rationale**:
- **Admin Side**: Technical AI backend configuration
  - Admin tests and enables providers (OpenAI, Anthropic, etc.)
  - Admin configures API keys and endpoints securely
  - Admin selects models and provider settings
  - Can add new providers as they're tested (e.g., "We tested Anthropic, now it's available")
- **Bot Editor Side**: User-friendly bot behavior configuration
  - Users write natural language instructions
  - Users configure movement and map awareness
  - Users don't need to understand AI providers or APIs
  - Focus on "what should the bot do" not "how does the AI work"

### 3. Implementation Plan

#### Phase 1: Redesign BotEditor Component

1. **Create BotList.svelte**
   - Grid/list view of bots
   - Load bots from bot-server API
   - Create new bot button
   - Click bot → navigate to detail view

2. **Create BotDetailView.svelte**
   - Replace current tab-based interface
   - Properties section
   - Behavior section
   - Instructions section (chat + movement)
   - Save/Delete actions

3. **Update BotEditor.svelte**
   - Router-like state: `view: "list" | "detail"`
   - Show BotList or BotDetailView based on state
   - Handle navigation between views

#### Phase 2: Remove AI Config UI

1. **Remove BotAIConfigEditor.svelte** (or repurpose for instructions only)
2. **Update BotData interface** - remove `aiProvider`, `apiEndpoint`, `modelName`, `apiKey`
3. **Keep only**:
   - `chatInstructions` - what bot should say
   - `movementInstructions` - how bot should move

#### Phase 3: Position Picker

1. **Create BotPositionPicker.svelte**
   - Click "Pick from Map" → enters pick mode
   - User clicks on map → sets bot position
   - Shows visual indicator on map
   - Similar to EntityEditor's position picker

#### Phase 4: API Integration

1. **Create BotApiService.ts** (in extension module)
   - Methods to call bot-server API
   - `getBots(roomUrl)` - list bots
   - `getBot(botId)` - get bot details
   - `createBot(botData)` - create new bot
   - `updateBot(botId, botData)` - update bot
   - `deleteBot(botId)` - delete bot

2. **Integrate with Admin API**
   - Save chat/movement instructions to Admin API
   - Load bot configurations
   - Handle errors gracefully

## Updated Component Structure

```
play/src/front/external-modules/bots/
├── index.ts                    # Extension module
├── BotEditor.svelte            # Main container (router)
├── BotList.svelte              # List view (NEW)
├── BotDetailView.svelte        # Detail view (NEW)
├── components/
│   ├── BotCard.svelte          # Bot card in list (NEW)
│   ├── BotPropertiesEditor.svelte  # Properties section
│   ├── BotBehaviorEditor.svelte    # Behavior section
│   ├── BotInstructionsEditor.svelte # Instructions (NEW - combines chat + movement)
│   ├── BotPositionPicker.svelte     # Position picker (NEW)
│   ├── BotAssignedSpacePicker.svelte # Assigned space picker (NEW)
│   └── BotWaypointPicker.svelte     # Waypoint picker for patrol (NEW)
└── services/
    └── BotApiService.ts        # API client (NEW)
```

## Map Awareness & Movement Tooling

The bot editor provides visual tools for configuring bot movement and map awareness:

### 1. Position Picker
- Click "Pick from Map" → enters pick mode
- Click on map → sets bot spawn position
- Visual indicator shows bot location
- Similar to EntityEditor's position picker

### 2. Assigned Space Picker
- Draw circle/rectangle on map
- Bot stays within this area
- Visual overlay shows boundaries
- Used for: Social bots wandering, Idle bots staying in place

### 3. Restricted Zones
- Mark areas bot can't enter
- Visual overlay shows restricted areas
- Bot pathfinding avoids these zones

### 4. Waypoint Picker (for Patrol behavior)
- Click on map to add waypoints
- Bot follows waypoint path in order
- Visual line shows patrol route
- Can reorder waypoints

### 5. Proximity Detection Settings
- Set detection radius (how far bot can "see" players)
- Visual circle shows detection area
- Bot detects players within radius for conversations

### 6. Map Awareness Integration
- Bot editor can query WorkAdventure's map data
- Knows about areas, restricted zones, exits
- Can show visual overlays for map features
- Helps users configure bots with map context

## Admin API Changes

### New Endpoint: Get Bots for Room

```
GET /api/bots/configuration?roomUrl={roomUrl}
```

Returns list of all bots for a room.

### Updated: Bot Configuration

Remove from user-facing fields:
- `aiProvider` (admin-only)
- `apiEndpoint` (admin-only)
- `modelName` (admin-only)
- `apiKey` (admin-only, never exposed)

Keep in user-facing fields:
- `chatInstructions` (user can edit)
- `movementInstructions` (user can edit)

### Admin-Only Configuration

Superadmin can configure:
- Default AI provider per bot type
- API endpoints and keys
- Model selection
- Provider-specific settings

This is done in Admin API's admin panel, not in WorkAdventure.

## User Flow

1. **Open Bot Editor** → See list of bots
2. **Click "Create Bot"** → Opens detail view with empty form
3. **Fill in properties**:
   - Name: "Welcome Bot"
   - Click "Pick Position" → Click on map → Position set
   - Select character texture
4. **Configure behavior**:
   - Select "Social"
   - Set assigned space
   - Configure social settings
5. **Write instructions**:
   - Chat: "You are a friendly greeter. Welcome visitors warmly..."
   - Movement: "Stand near the entrance. Greet new visitors..."
6. **Click Save** → Bot created, returns to list
7. **Click bot in list** → Opens detail view to edit

## Benefits

1. **Better UX**: Clear list → detail flow
2. **Scalable**: Can manage many bots easily
3. **Simpler**: Users don't need to understand AI providers
4. **Secure**: API keys never in user-facing UI
5. **Flexible**: Admin configures AI backend, users write instructions

## Future Enhancements

### Short Term
- **AI Provider Integration**: Connect to LMStudio, OpenAI, Anthropic, etc.
- **Voice AI**: Ultravox and GPT Voice integration
- **Enhanced Memory**: Persistent storage to Admin API
- **Bot Analytics**: Usage metrics and performance tracking

### Medium Term
- **Custom Behaviors**: User-defined behavior scripts
- **Bot Marketplace**: Share bot configurations
- **Multi-language Support**: Internationalization
- **Advanced Pathfinding**: Dynamic obstacle avoidance

### Long Term
- **Bot Learning**: Machine learning for behavior adaptation
- **Emotional AI**: Advanced emotional state modeling
- **Group Behaviors**: Bots working together
- **Procedural Generation**: Auto-generate bot personalities

