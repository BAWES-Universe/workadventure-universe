# Changelog

## [Unreleased]

### Added
- **Summon Functionality**: Players can summon bots to their location via "Summon" button in user card
  - `POST /api/bots/:botId/summon` endpoint (public, no auth required)
  - Frontend integration via WokaMenu dynamic actions
  - Pathfinding-based movement with 3x speed multiplier
  - Automatic return to original position with 2x speed
  - Protection: Cannot summon if bot is engaged with another player
  - Interrupt handling: New summon requests cancel ongoing returns
- **Greeting Messages**: Configurable greeting messages for all bot types
  - `greetingMessages` array in behavior configs
  - Default fallback messages if none configured
  - Sent when players join conversation spaces
  - Sent when bots are summoned
- **Conversation Memory System**: Per-bot, per-player memory system
  - `ConversationMemory` class tracks conversations, emotions, personal info
  - Extracts personal information (birthday, name, preferences)
  - Tracks emotional state (bot and player)
  - Relationship context (first met, conversation stats, important events)
- **Pathfinding System**: Full pathfinding implementation using EasyStar.js
  - `BotPathfindingManager` for path calculation
  - `MapDataService` for collision grid caching
  - Integrated into all movement (patrol, social, summon, return)
  - Stuck detection and path recalculation
- **User List Integration**: Bots appear in sidebar user list
  - Bots join "allWorldUser" space automatically
  - Proper availability status (ONLINE)
  - Visible in sidebar with other users
- **Production Logging**: Environment-aware logging
  - Logging levels based on NODE_ENV
  - `ENABLE_BOT_DEBUG` flag for verbose logging in development
  - Reduced logging in production builds
- **Viewport System**: Dynamic viewport centered on bot position (2000px radius) for accurate player detection
- **Bot Identification**: Static bot user ID tracking to distinguish bots from players
- **Smart Engagement Logic**: Bots only engage when players actively move into proximity
- **Ghost Mode**: Bots can walk through idle players without triggering bubbles
- **Real-time Facing**: Continuous facing updates during engagement with direction change detection
- **Smart Waypoint Pausing**: Patrol bots skip pauses if players are nearby to avoid triggering bubbles

### Changed
- **PatrolBehavior**: Refined engagement pattern - stops when players actively move into proximity, resumes if player becomes idle
  - `respondToPlayers` setting (default: true) controls stopping behavior
  - Ghost mode: Walks through idle players without triggering bubbles
  - Stops for active players, resumes if they become idle
- **BaseBehavior**: 
  - Improved proximity detection with hysteresis to prevent flickering
  - Enhanced facing logic for summoned bots (face when stopped, not when moving)
  - Summon state management with original position tracking
- **BotClient**: 
  - Dynamic viewport system ensures players remain in bot's knowledge
  - Pathfinding integration for all movement
  - Summon and return speed multipliers (3x summon, 2x return)
  - Bypass cooldowns when summoned or returning
- **Player Detection**: Filters out bots and invalid positions (0,0) from player lists
- **Facing System**: Only sends direction updates when direction actually changes
- **SocialBehavior**: 
  - Improved greeting message sending with retry mechanism
  - Memory integration for personalized greetings
  - Proper return behavior after summon
- **IdleBehavior**: 
  - Configurable greeting messages
  - Summon functionality support
  - Proper stop and face behavior when summoned

### Fixed
- **Summon Bubble Initiation**: Fixed summoned bots not stopping and initiating bubbles when reaching target
- **Summon Facing**: Fixed facing behavior for summoned bots (now faces when stopped, not when moving)
- **Return Behavior**: Fixed social bot teleporting back after summon (now uses pathfinding)
- **Return Resume**: Fixed social bot not resuming behavior after returning from summon
- **Summon Interrupt**: Fixed bots ignoring new summon requests while returning
- **Greeting Messages**: Fixed social bot not sending greeting messages (retry mechanism and proper space sync)
- **User List Visibility**: Fixed bots not appearing in sidebar user list (now join "allWorldUser" space)
- **Availability Status**: Fixed bots appearing as "not connected" (now send proper ONLINE status)
- **Player Disappearing**: Fixed issue where players would disappear from bot's knowledge when bot moved
- **Bubble Triggering**: Fixed patrol bots triggering bubbles when walking over idle players
- **Inconsistent Facing**: Fixed bots not facing players consistently during conversations
- **Bot-to-Bot Engagement**: Fixed bots trying to engage with each other

## [0.2.0] - Engagement System Improvements

### Added
- **Assigned Spaces**: Bots can now be assigned to specific areas and will automatically return after conversations
  - Added `assignedSpace` configuration to all behaviors
  - Automatic return to assigned space when conversations end
  - Constraint enforcement during normal behavior
  - See [ASSIGNED_SPACES.md](./docs/ASSIGNED_SPACES.md) for details

- **Admin API Integration**: Full integration with WorkAdventure Admin API for bot tracking
  - Bot configuration tracking (per room/world/universe/user)
  - Usage metrics tracking (conversations, messages, active time)
  - Conversation and message event tracking
  - See [ADMIN_API_INTEGRATION.md](./docs/ADMIN_API_INTEGRATION.md) for details

- **BotUsageTracker**: Service for tracking bot usage metrics
  - Automatic tracking of conversations, messages, and active time
  - Periodic flushing to Admin API
  - Per-bot metrics collection

- **AdminApiService**: Service for Admin API communication
  - Save/get/delete bot configurations
  - Track bot usage metrics
  - Track individual conversations and messages
  - Query usage data with filters

### Changed
- **BaseBehavior**: Added `assignedSpace` support and return logic
- **SocialBehavior**: Now respects assigned space boundaries and returns after conversations
- **PatrolBehavior**: Returns to assigned space after conversations
- **Behavior Config**: All behaviors now support `assignedSpace` configuration

### Documentation
- Added [ASSIGNED_SPACES.md](./docs/ASSIGNED_SPACES.md) - Guide for assigned spaces feature
- Added [ADMIN_API_INTEGRATION.md](./docs/ADMIN_API_INTEGRATION.md) - Admin API integration guide
- Updated README.md with new features

## [0.1.0] - Initial Release

### Added
- Core bot client (WebSocket-based)
- Behavior system (Idle, Patrol, Social)
- Smart conversation management
- Architecture documentation
- Quick start guide

