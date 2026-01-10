# Bot System Status

## ✅ Completed

### Core Infrastructure
- ✅ Created comprehensive directory structure (`bots/`)
- ✅ Designed scalable architecture for thousands of bots
- ✅ Implemented `BotClient` - WebSocket-based client that connects to WorkAdventure
- ✅ Implemented `BotState` - Manages bot position, direction, and movement state
- ✅ Created `BaseBehavior` abstract class for extensible behavior system
- ✅ **Viewport System**: Dynamic viewport centered on bot position (2000px radius) for accurate player detection
- ✅ **Bot Identification**: Static bot user ID tracking to distinguish bots from players
- ✅ **Player Detection**: Filtering out bots and invalid positions (0,0) from player lists

### Bot Server & Management
- ✅ **BotManager**: Orchestrates bot lifecycle and spawning
- ✅ **BotAPI**: REST API endpoints for bot operations
- ✅ **Room Occupancy Verification**: Periodic checks to despawn bots from empty rooms
- ✅ **On-Demand Spawning**: Bots spawn only when players are present
- ✅ **Live Bot Updates**: Partial config updates to running bots (teleport, behavior changes)
- ✅ **Manual Bot Control**: Spawn/despawn specific bots via API

### Behavior System
- ✅ **IdleBehavior**: Bot stands in place and responds to interactions
  - Configurable response radius
  - Configurable greeting messages (with default fallback)
  - Idle animations support
  - Summon functionality (can be summoned to player location)
  
- ✅ **PatrolBehavior**: Bot follows predefined waypoints
  - Loop or back-and-forth routing
  - Pause at waypoints (skips pause if players nearby to avoid triggering bubbles)
  - **Smart Engagement**: Stops when players actively move into proximity, resumes if player becomes idle
  - **Ghost Mode**: Walks through idle players without triggering bubbles
  - **Continuous Facing**: Faces players in real-time during conversations
  - **Resume Logic**: Automatically resumes patrol after conversations end
  - Configurable greeting messages (with default fallback)
  - Summon functionality (can be summoned to player location)
  - Configurable `respondToPlayers` setting (default: true)
  
- ✅ **SocialBehavior**: Bot actively seeks conversations
  - Smart conversation management
  - Respects player status (busy, away, etc.)
  - Conversation history tracking
  - Cooldown system (configurable `minTimeBetweenConversations`)
  - Wandering behavior within assigned space
  - Prevents multiple bots targeting same player
  - **Conversation Memory**: Per-bot, per-player memory system
    - Remembers past conversations
    - Tracks emotional state (bot and player)
    - Extracts and remembers personal information (birthday, name, preferences)
    - Relationship context (first met, conversation stats, important events)
  - Configurable detection range (`conversationRadius`)
  - Configurable greeting messages (with default fallback)
  - Summon functionality (can be summoned to player location)

### Engagement System
- ✅ **Proximity Detection**: Distance-based player detection with hysteresis (PROXIMITY_RADIUS / DISENGAGE_RADIUS)
- ✅ **Player Movement Tracking**: `nearbyPlayers` map only populated via `onPlayerMoved` (player movement events)
- ✅ **Idle Player Handling**: Bots can walk through idle players without engaging
- ✅ **Space Join Logic**: Always accept spaces, but only engage if `nearbyPlayers.size > 0`
- ✅ **Real-time Facing**: Bots continuously face closest player during engagement

### Extension Module (UI)
- ✅ **Bot Editor Sidebar**: Full-featured bot editor integrated into map editor
- ✅ **Bot List View**: List/grid view of all bots on the map
- ✅ **Bot Detail View**: Detailed configuration view for individual bots
- ✅ **Visual Bot Placement**: Drag-and-drop bot placement on map
- ✅ **Behavior Configuration**: UI for configuring all behavior types
- ✅ **Waypoint Editor**: Visual waypoint placement for patrol bots
- ✅ **Live Updates**: Real-time bot updates without respawning
- ✅ **Metadata Display**: Shows created/updated timestamps and user info
- ✅ **Room Notifications**: Notifies bot-server when players enter/leave rooms
- ✅ **Bot Toggle**: Enable/disable bots individually for easier debugging
- ✅ **Summon Button**: "Summon" button on user cards (WokaMenu) to summon bots to player location
- ✅ **User List Integration**: Bots appear in sidebar user list with proper availability status

### Admin API Integration
- ✅ **Configuration Tracking**: Track bot configurations per room/world/universe/user
- ✅ **Usage Metrics**: Monitor bot conversations, messages, and active time
- ✅ **Bot Persistence**: Save/load bot configurations from Admin API
- ✅ **User Tracking**: Track who created/updated each bot

### Documentation
- ✅ Comprehensive README with architecture overview
- ✅ Detailed ARCHITECTURE.md with technical specs
- ✅ BEHAVIORS.md explaining behavior system
- ✅ QUICK_START.md with examples
- ✅ IMPLEMENTATION_PLAN.md with roadmap
- ✅ SCALABILITY.md with resource usage and optimization strategies
- ✅ DATA_STORAGE.md with data storage and manipulation details
- ✅ SCALING_REQUIREMENTS.md with infrastructure and scaling requirements
- ✅ ADMIN_API_REQUIREMENTS.md with Admin API implementation requirements
- ✅ SECURITY.md with security considerations and best practices
- ✅ CHAT_AND_MOVEMENT_INSTRUCTIONS.md with chat and movement instructions guide
- ✅ HORIZONTAL_SCALING.md with horizontal scaling setup and configuration
- ✅ BotRegistry with Redis support for multi-server coordination
- ✅ BotServerCoordinator for bot distribution across servers

### Pathfinding System
- ✅ **BotPathfindingManager**: Full pathfinding implementation using EasyStar.js
- ✅ **Collision Grid Integration**: Loads collision data from map WAM files
- ✅ **Path Calculation**: A* pathfinding algorithm for optimal routes
- ✅ **Path Following**: Smooth path following with waypoint advancement
- ✅ **Obstacle Avoidance**: Bots navigate around walls and colliders
- ✅ **Path Smoothing**: Natural movement along calculated paths
- ✅ **Stuck Detection**: Detects when bots are stuck and recalculates paths
- ✅ **Summon Pathfinding**: Uses pathfinding for summon movement (3x speed)
- ✅ **Return Pathfinding**: Uses pathfinding for returning to original position (2x speed)
- ✅ **MapDataService**: Caches collision grids per room for performance

### Summon Functionality
- ✅ **Summon API**: `POST /api/bots/:botId/summon` endpoint
- ✅ **Frontend Integration**: "Summon" button in WokaMenu (user card popup)
- ✅ **Pathfinding Movement**: Bots use pathfinding to reach summoned player
- ✅ **Speed Multiplier**: 3x speed when summoned, 2x speed when returning
- ✅ **Engagement Protection**: Bots cannot be summoned if engaged with another player
- ✅ **Return Logic**: Bots automatically return to original spawn position after summon
- ✅ **Interrupt Handling**: New summon requests cancel ongoing return journeys
- ✅ **Bubble Initiation**: Bots stop and initiate conversation bubble when reaching summoned player
- ✅ **Facing Behavior**: Bots face the player when summoned and close

### Greeting Messages
- ✅ **Configurable Greetings**: All bot types support configurable greeting messages
- ✅ **Default Fallbacks**: Default greeting messages if none configured
- ✅ **Per-Behavior Greetings**: Different greeting messages per behavior type
- ✅ **Summon Greetings**: Bots send greetings when summoned (if configured)
- ✅ **Space Join Greetings**: Bots send greetings when players join conversation spaces
- ✅ **Memory Integration**: Greetings can be personalized based on conversation memory

### User List Integration
- ✅ **Sidebar Visibility**: Bots appear in the user list sidebar
- ✅ **Availability Status**: Proper availability status (ONLINE) for bots
- ✅ **World Space**: Bots automatically join "allWorldUser" space for visibility
- ✅ **User Card Actions**: Bots have "Summon" button in user card popup

### Production Logging
- ✅ **Environment-Aware Logging**: Logging levels based on NODE_ENV
- ✅ **Debug Mode**: `ENABLE_BOT_DEBUG` flag for verbose logging in development
- ✅ **Production Optimization**: Reduced logging in production builds

## 🚧 In Progress / Next Steps

### 1. AI Integration (High Priority)
**Goal**: Connect AI providers for bot responses

**Status**: Infrastructure ready, needs provider implementation

**Tasks:**
- [ ] Create `AIProvider` interface
- [ ] Implement `LMStudioProvider` for local LLM
- [ ] Add conversation context management
- [ ] Implement response generation
- [ ] Add streaming support (if needed)
- [ ] Integrate with conversation memory system

**Files to Create:**
- `bots/ai/AIProvider.ts`
- `bots/ai/LMStudioProvider.ts`
- `bots/ai/UltravoxProvider.ts` (future)
- `bots/ai/GPTVoiceProvider.ts` (future)

### 3. Enhanced Conversation System (Medium Priority)
**Goal**: Improve conversation quality and context

**Tasks:**
- [ ] Integrate AI responses with conversation memory
- [ ] Add conversation topic management
- [ ] Implement conversation flow states
- [ ] Add multi-turn conversation support
- [ ] Improve greeting personalization

### 4. Performance Optimizations (Lower Priority)
**Goal**: Optimize for thousands of bots

**Tasks:**
- [ ] Implement connection pooling
- [ ] Add resource limits and throttling
- [ ] Implement spatial partitioning
- [ ] Add LOD system for distant bots
- [ ] Implement message batching
- [ ] Add async processing for AI calls

### 5. Voice AI (Future)
**Goal**: Add voice capabilities

**Tasks:**
- [ ] Research Ultravox API
- [ ] Implement Ultravox provider
- [ ] Add WebRTC audio handling
- [ ] Implement GPT Voice provider (alternative)

## Recent Improvements

### Summon Functionality (Latest)
- **Feature**: Players can summon bots to their location via "Summon" button
- **Implementation**: 
  - Frontend: WokaMenu action registration in extension module
  - Backend: `/api/bots/:botId/summon` endpoint
  - Movement: Uses pathfinding with 3x speed multiplier
  - Return: Automatically returns to original position with 2x speed
  - Protection: Cannot summon if bot is engaged with another player
- **Impact**: Bots can be called on-demand, enhancing player interaction

### Greeting Messages System
- **Feature**: Configurable greeting messages for all bot types
- **Implementation**:
  - `greetingMessages` array in behavior configs
  - Default fallback messages if none configured
  - Sent when players join conversation spaces
  - Sent when bots are summoned
- **Impact**: More natural bot interactions with personalized greetings

### Conversation Memory System
- **Feature**: Per-bot, per-player memory system
- **Implementation**:
  - `ConversationMemory` class tracks conversations, emotions, personal info
  - Extracts personal information (birthday, name, preferences)
  - Tracks emotional state (bot and player)
  - Relationship context (first met, conversation stats)
- **Impact**: Bots can remember players and personalize interactions

### Pathfinding Implementation
- **Feature**: Full pathfinding system using EasyStar.js
- **Implementation**:
  - `BotPathfindingManager` for path calculation
  - `MapDataService` for collision grid caching
  - Integrated into all movement (patrol, social, summon, return)
  - Stuck detection and path recalculation
- **Impact**: Bots navigate naturally around obstacles, no longer walk through walls

### User List Integration
- **Feature**: Bots appear in sidebar user list
- **Implementation**:
  - Bots join "allWorldUser" space automatically
  - Proper availability status (ONLINE)
  - Visible in sidebar with other users
- **Impact**: Better visibility and management of active bots

### Viewport System Fix
- **Problem**: Bots had static viewport (0,0)-(1000,1000), causing players to disappear from bot's knowledge
- **Solution**: Dynamic viewport centered on bot position with 2000px radius
- **Impact**: Bots now reliably detect and track players, enabling consistent engagement

### Patrol Bot Engagement Logic (Refined)
- **Problem**: Patrol bot would trigger bubbles when walking over idle players
- **Solution**: 
  - Stops when players actively move into proximity (`respondToPlayers: true` by default)
  - Resumes patrol if player becomes idle (ghost behavior)
  - Skip waypoint pauses if players nearby (prevents stopping on top of idle players)
  - Always accept spaces but only engage if player approached bot
- **Impact**: Patrol bots stop for active players but ghost through idle ones

### Player Detection Improvements
- **Problem**: Bots were detecting other bots as players
- **Solution**: Static `BotClient.botUserIds` set tracks all bot IDs, filters them from player lists
- **Impact**: Bots no longer try to engage with each other

### Real-time Facing (Enhanced)
- **Problem**: Bots wouldn't face players consistently during conversations, especially when summoned
- **Solution**: 
  - Continuous facing updates using `getNearbyPlayers()` and direction change detection
  - Fixed facing logic for summoned bots (face when stopped, not when moving)
  - Proper facing during summon and return states
- **Impact**: Bots now face players smoothly and consistently in all scenarios

## Architecture Highlights

### Scalability Design
- **Connection Pooling**: Reuse WebSocket connections
- **Resource Limits**: Configurable limits per server/map
- **Distributed Execution**: Support for multiple bot servers
- **Lazy Loading**: Only spawn bots when needed
- **Viewport Optimization**: Dynamic viewport reduces network traffic

### Smart Features
- **Status Awareness**: Bots respect player availability
- **Anti-Spam**: Prevents multiple bots targeting same player
- **Conversation History**: Tracks who bot has talked to
- **Cooldown System**: Prevents repetitive conversations
- **Idle Player Detection**: Bots don't engage with stationary players
- **Ghost Mode**: Bots walk through idle players without triggering UI

### Extensibility
- **Modular Behaviors**: Easy to add new behavior types
- **AI Provider Interface**: Easy to swap AI providers (ready for implementation)
- **Composable Behaviors**: Can combine multiple behaviors
- **Custom Behaviors**: Users can create custom behaviors

## Key Files

### Core Client
- `bots/client/BotClient.ts` - Main WebSocket client with viewport system
- `bots/client/BotState.ts` - State management

### Behaviors
- `bots/behaviors/BaseBehavior.ts` - Base class with proximity detection
- `bots/behaviors/IdleBehavior.ts` - Idle behavior
- `bots/behaviors/PatrolBehavior.ts` - Patrol behavior with smart engagement
- `bots/behaviors/SocialBehavior.ts` - Social behavior with conversation memory

### Server
- `bots/server/BotManager.ts` - Bot lifecycle management
- `bots/server/BotAPI.ts` - REST API endpoints
- `bots/server/BotRegistry.ts` - Active bot registry (Redis-based)

### Extension Module
- `play/src/front/external-modules/bots/index.ts` - Extension entry point
- `play/src/front/external-modules/bots/BotEditor.svelte` - Main editor UI
- `play/src/front/external-modules/bots/services/BotApiService.ts` - Frontend API service

## Integration Points

1. **WebSocket Protocol**: Uses same protocol as browser clients
2. **Extension Module**: UI injected via WorkAdventure's ExtensionModule system (`play/src/front/external-modules/bots/`)
3. **Map Storage**: Bot configs stored in WAM files (public data only)
4. **Admin API**: Sensitive bot configuration stored in Admin API
5. **Backend Services**: Bot spawning and management (standalone service in `bots/server/`)

## Notes

- The bot system is designed to be **scalable** - can handle thousands of bots
- Behaviors are **modular** and **extensible**
- Smart conversation management prevents spam and respects players
- **Ready for AI integration** - infrastructure in place, needs provider implementation
- **Independent Extension**: Uses WorkAdventure's ExtensionModule system, no upstream code changes needed
- **Clean Separation**: Extension module UI in WorkAdventure's structure, all server/client code in `bots/` directory
- **Production Ready**: Core features working, AI integration is next major milestone

## Questions?

See the documentation in `bots/docs/` for more details.
