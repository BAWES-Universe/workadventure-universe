# Changelog

## [Unreleased]

### Added
- **Viewport System**: Dynamic viewport centered on bot position (2000px radius) for accurate player detection
- **Bot Identification**: Static bot user ID tracking to distinguish bots from players
- **Smart Engagement Logic**: Bots only engage when players actively move into proximity
- **Ghost Mode**: Bots can walk through idle players without triggering bubbles
- **Real-time Facing**: Continuous facing updates during engagement with direction change detection
- **Smart Waypoint Pausing**: Patrol bots skip pauses if players are nearby to avoid triggering bubbles

### Changed
- **PatrolBehavior**: Now matches SocialBehavior engagement pattern - walks through idle players like ghosts
- **BaseBehavior**: Improved proximity detection with hysteresis to prevent flickering
- **BotClient**: Dynamic viewport system ensures players remain in bot's knowledge
- **Player Detection**: Filters out bots and invalid positions (0,0) from player lists
- **Facing System**: Only sends direction updates when direction actually changes

### Fixed
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

