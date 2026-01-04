# Changelog

## [Unreleased]

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

