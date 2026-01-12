# Implementation Plan

## Phase 1: Core Infrastructure ✅

- [x] Create bots directory structure
- [x] Design architecture documentation
- [x] Implement BotClient (WebSocket connection)
- [x] Implement BotState (state management)
- [x] Create BaseBehavior interface
- [x] Implement IdleBehavior
- [x] Implement SocialBehavior
- [x] Implement PatrolBehavior

## Phase 2: Extension Module Setup

**Goal**: Create WorkAdventure extension module that injects bot editor UI

### Tasks

- [ ] Create extension module structure in `play/src/front/external-modules/bots/`
  - [ ] `index.ts` - Extension module entry point
  - [ ] `BotEditorButton.svelte` - Button component
  - [ ] `BotEditorModal.svelte` - Main editor UI
  - [ ] `components/BotPropertiesEditor.svelte` - Properties editor
  - [ ] `components/BotBehaviorEditor.svelte` - Behavior editor
  - [ ] `components/BotAIConfigEditor.svelte` - AI config editor

- [ ] Implement extension module
  - [ ] Register with ExtensionModule interface
  - [ ] Inject button into action bar via `externalSvelteComponent.addComponentToZone()`
  - [ ] Handle modal/sidebar opening
  - [ ] Cleanup on destroy

- [ ] Register module in Admin API
  - [ ] Add `modules: ["bots"]` to room metadata response

### Files to Create

```
play/src/front/external-modules/bots/
├── index.ts                    # Extension module entry point
├── BotEditorButton.svelte      # Button to open editor
├── BotEditorModal.svelte         # Main editor modal
└── components/
    ├── BotPropertiesEditor.svelte
    ├── BotBehaviorEditor.svelte
    └── BotAIConfigEditor.svelte
```

**Note**: Extension module lives in WorkAdventure's directory structure. All other bot code (server, client, behaviors) remains in `bots/` directory.

## Phase 3: Bot Editor UI

**Goal**: Build complete bot editor interface

### Tasks

- [ ] Bot Properties Editor
  - [ ] Name, description fields
  - [ ] Position picker (click on map)
  - [ ] Character texture selection
  - [ ] Basic appearance settings

- [ ] Behavior Editor
  - [ ] Behavior type selector (Idle/Patrol/Social)
  - [ ] Behavior-specific configuration
  - [ ] Assigned space configuration
  - [ ] Preview behavior settings

- [ ] AI Configuration Editor
  - [ ] AI provider selection (LMStudio/Ultravox/GPT Voice)
  - [ ] Chat instructions editor (large text area)
  - [ ] Movement instructions editor
  - [ ] API configuration (endpoint, model, etc.)
  - [ ] Test connection button

- [ ] Bot List/Management
  - [ ] List existing bots on map
  - [ ] Edit existing bots
  - [ ] Delete bots
  - [ ] Duplicate bots

- [ ] Save/Load Integration
  - [ ] Save to WAM file (public data only)
  - [ ] Save sensitive data to Admin API
  - [ ] Load bot configurations
  - [ ] Handle errors gracefully

## Phase 4: Backend Bot Management

- [ ] Create BotManager service
- [ ] Create BotRegistry service
- [ ] Implement bot persistence (database/storage)
- [ ] Create REST API endpoints for bot CRUD
- [ ] Add bot spawning on map load
- [ ] Implement bot health monitoring

## Phase 5: Smart Conversation Management

- [ ] Implement conversation state tracking
- [ ] Add player status checking
- [ ] Implement anti-spam logic (prevent multiple bots targeting same player)
- [ ] Add conversation history tracking
- [ ] Implement busy detection
- [ ] Add cooldown system

## Phase 6: AI Integration

- [ ] Create AIProvider interface
- [ ] Implement LMStudio provider
- [ ] Add conversation context management
- [ ] Implement response generation
- [ ] Add streaming support (if needed)

## Phase 7: Scalability & Performance

- [ ] Implement connection pooling
- [ ] Add resource limits and throttling
- [ ] Implement spatial partitioning for bot updates
- [ ] Add update frequency optimization (reduce updates for distant bots, maintain visibility)
- [ ] Implement message batching
- [ ] Add async processing for AI calls

## Phase 8: Voice AI (Future)

- [ ] Research Ultravox API
- [ ] Implement Ultravox provider
- [ ] Add WebRTC audio handling for bots
- [ ] Implement GPT Voice provider (alternative)
- [ ] Add voice response generation

## Phase 9: Testing & Documentation

- [ ] Write unit tests for behaviors
- [ ] Write integration tests for BotClient
- [ ] Test with multiple bots
- [ ] Performance testing (1000+ bots)
- [ ] Update API documentation
- [ ] Create user guide for bot editor

## Implementation Order

### Recommended Sequence

1. **Phase 2: Extension Module Setup** (Foundation)
   - Creates the extension module structure
   - Enables UI injection without upstream changes
   - Establishes the connection between UI and bot server

2. **Phase 3: Bot Editor UI** (User-Facing)
   - Most visible feature
   - Allows users to create and configure bots
   - Builds on the extension module foundation

3. **Phase 4: Backend Bot Management** (Core Functionality)
   - Needed to actually spawn and manage bots
   - Completes the core system
   - Bot server runs independently

4. **Phase 5: Smart Conversation Management** (Polish)
   - Prevents spam
   - Improves UX
   - Coordinates conversations across servers

5. **Phase 6: AI Integration** (Intelligence)
   - Makes bots actually useful
   - Enables conversations
   - Connects to AI providers

6. **Phase 7: Scalability & Performance** (Optimization)
   - Optimize for production
   - Handle thousands of bots
   - Performance tuning

7. **Phase 9: Testing & Documentation** (Quality)
   - Ensures reliability
   - Helps users
   - Complete documentation

## Development Workflow

### Setup

1. Create extension module in `play/src/front/external-modules/bots/`
2. Keep all server/client code in `bots/` directory
3. Register module in Admin API metadata: `modules: ["bots"]`
4. Bot server runs independently

### Development

1. Develop extension module in `play/src/front/external-modules/bots/`
2. Develop bot server in `bots/server/`
3. Test locally with WorkAdventure
4. No upstream WorkAdventure code changes needed (except extension module)

### Deployment

1. Deploy bot server independently
2. Extension module is part of WorkAdventure build
3. Configure Admin API
4. Set up Redis for coordination

## Key Principles

1. **Independence**: Bot server, client, and behaviors stay in `bots/` directory
2. **Extension Module**: Only UI extension lives in WorkAdventure's structure
3. **No Upstream Changes**: Don't modify WorkAdventure core code
4. **Modularity**: Each component can be developed separately
5. **Scalability**: Designed for horizontal scaling from the start
6. **Security**: Sensitive data never in public files

