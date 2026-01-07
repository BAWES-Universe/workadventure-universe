# Bot Behavior System

## Overview

The behavior system defines how bots act in the WorkAdventure world. Behaviors are modular, composable, and extensible. All behaviors extend `BaseBehavior` which provides common functionality like proximity detection, player tracking, and engagement management.

## Base Behavior

All behaviors extend `BaseBehavior`:

```typescript
abstract class BaseBehavior {
  protected bot: BotClient | null;
  protected config: BehaviorConfig;
  
  // Engagement tracking
  protected isEngaged: boolean;
  protected engagedWithUsers: Map<number, { spaceName: string; position?: PositionInterface }>;
  
  // Proximity tracking (only populated when players MOVE)
  protected nearbyPlayers: Map<number, PositionInterface>;
  protected readonly PROXIMITY_RADIUS = 64;  // Enter radius
  protected readonly DISENGAGE_RADIUS = 80;  // Leave radius (hysteresis)
  
  abstract update(deltaTime: number): void;
  onPlayerMoved(playerId: number, position: PositionInterface): void;
  onSpaceJoined(spaceName: string): void;
  onSpaceLeft(spaceName: string): void;
  onChatMessage(spaceName: string, message: string, senderId: number): void;
  shouldJoinProximitySpace(spaceName: string): boolean;  // Default: true
}
```

### Key Concepts

**Proximity Detection:**
- `nearbyPlayers` map is ONLY populated via `onPlayerMoved` events
- If a player is idle (not moving), they won't trigger `onPlayerMoved`
- This allows bots to walk through idle players without engaging

**Engagement Logic:**
- Bots only engage when `nearbyPlayers.size > 0` (player actively moved into proximity)
- Bots can walk through idle players like "ghosts" without triggering bubbles
- Space joins are always accepted, but engagement only happens if player approached bot

**Facing System:**
- Bots continuously face the closest player during engagement
- Uses `facePosition()` which only sends updates when direction actually changes
- Real-time facing updates as players move

## Behavior Types

### 1. IdleBehavior

**Purpose**: Bot stands in place and responds to interactions.

**Configuration:**
```typescript
interface IdleBehaviorConfig extends BehaviorConfig {
  type: 'idle';
  assignedSpace?: {
    center: { x: number; y: number };
    radius: number;  // For idle bots, radius=0 means they won't move
  };
  responseRadius: number;  // Distance to respond to players
  greetingMessages: string[];  // Random greetings
  idleAnimations?: string[];  // Idle animations to play
  animationInterval?: number;  // Milliseconds between animations
}
```

**Behavior:**
- Stay at fixed position (assignedSpace.center)
- If radius=0, bot will not move at all
- When player approaches within `responseRadius`, greet them
- Join conversation if player initiates
- Respond to chat messages naturally
- Play idle animations periodically

**Engagement:**
- Uses base behavior's proximity detection
- Engages when players move into proximity
- Sends greeting when space is joined

### 2. PatrolBehavior

**Purpose**: Bot follows a predefined route.

**Configuration:**
```typescript
interface PatrolBehaviorConfig extends BehaviorConfig {
  type: 'patrol';
  assignedSpace?: {
    center: { x: number; y: number };
    radius: number;  // Maximum distance from center (boundary enforcement)
  };
  waypoints: Array<{ x: number; y: number }>;
  loop: boolean;  // Loop back to start
  pauseAtWaypoints: number;  // Seconds to pause
  speed: number;  // Movement speed
  respondToPlayers: boolean;  // Pause to chat?
  responseRadius?: number;  // Distance to respond
}
```

**Behavior:**
- Spawns at assignedSpace.center (or first waypoint)
- Move between waypoints in order
- If bot strays outside assignedSpace.radius, it will return to the assigned space
- **Smart Pause Logic**: Skips pause at waypoints if players are nearby (prevents triggering bubbles with idle players)
- Loop route if configured
- **Ghost Mode**: Walks through idle players without engaging

**Engagement Logic:**
- **Always accepts spaces** (uses default `shouldJoinProximitySpace = true`)
- **In `onSpaceJoined`**: Only engages if `nearbyPlayers.size > 0`
  - If empty → bot walked into idle player → return early, keep walking
  - If populated → player approached bot → engage normally
- **Stops and faces** when `nearbyPlayers.size > 0` (player actively moved into proximity)
- **Resumes patrol** after conversation ends (500ms delay to prevent flickering)

**Key Implementation Details:**
```typescript
onSpaceJoined(spaceName: string): void {
  // Like social bot: if no nearby players (bot walked into idle player),
  // just return - don't engage, keep walking
  if (this.nearbyPlayers.size === 0) return;
  
  // Player actively approached us - engage
  this.currentSpaceName = spaceName;
  this.bot.stop();
  // ... send greeting, etc.
}

private moveTowardsWaypoint(config: PatrolBehaviorConfig): void {
  // ... movement logic ...
  
  if (distance < 10) {  // Reached waypoint
    // Check if players nearby (even idle ones)
    const playersNearby = this.bot.getNearbyPlayers(100);
    if (playersNearby.length > 0) {
      // Player nearby - don't stop, just advance to next waypoint
      this.advanceToNextWaypoint(config);
      return;
    }
    
    // No players nearby - safe to pause
    this.bot.stop();
    this.isPaused = true;
    // ...
  }
}
```

### 3. SocialBehavior

**Purpose**: Bot actively seeks conversations with players.

**Configuration:**
```typescript
interface SocialBehaviorConfig extends BehaviorConfig {
  type: 'social';
  assignedSpace?: {
    center: { x: number; y: number };
    radius: number;  // How far the bot can wander from center
  };
  conversationRadius: number;  // Distance to detect players
  minTimeBetweenConversations: number;  // Cooldown (milliseconds)
  maxConversationDuration: number;  // Max chat time
  conversationHistorySize: number;  // Remember last N players
  respectPlayerStatus: boolean;  // Check player availability
  maxConcurrentConversations: number;  // Limit active chats
  conversationTopics: string[];  // Topics to discuss
  wanderRadius: number;  // Area to wander in
  wanderCenter: { x: number; y: number };
  wanderSpeed: number;  // Movement speed
  approachDistance: number;  // How close to get before starting conversation
}
```

**Behavior:**
- Spawns at assignedSpace.center
- Wander within `assignedSpace.radius` (random targets within this area)
- Detect players within `conversationRadius`
- Check if player is available (not busy, not in conversation)
- Check conversation history (avoid recent players)
- Approach player and initiate conversation
- Maintain conversation for reasonable duration
- Leave gracefully when done
- Return to assigned space if it strays outside the radius

**Engagement Logic:**
- **Always accepts spaces** (uses default `shouldJoinProximitySpace = true`)
- **In `onSpaceJoined`**: Only engages if `targetPlayerId` is set
  - If no target → bot walked into idle player → return early, keep wandering
  - If target set → player was actively being approached → engage normally
- **Wandering**: Picks random targets, never stops on top of players
- **Ghost Mode**: Walks through idle players without engaging

**Key Implementation Details:**
```typescript
onSpaceJoined(spaceName: string): void {
  // Like patrol bot: if no target, do nothing - just return
  if (!this.bot || !this.targetPlayerId) return;
  
  // Player was being actively approached - engage
  // ... start conversation, send greeting, etc.
}

private checkForConversations(config: SocialBehaviorConfig): void {
  // Only look for conversations if within assigned space
  if (!this.isWithinAssignedSpace()) return;
  
  const nearbyPlayers = this.bot.getNearbyPlayers(config.conversationRadius);
  for (const player of nearbyPlayers) {
    if (this.canStartConversation(player.userId, config, currentTime)) {
      this.targetPlayerId = player.userId;  // Set target
      break;
    }
  }
}
```

**Smart Conversation Management:**
```typescript
class SocialBehavior extends BaseBehavior {
  private conversationHistory: Map<number, number> = new Map();
  private activeConversations: Map<number, ConversationState> = new Map();
  private targetPlayerId: number | null = null;
  
  canStartConversation(playerId: number, config: SocialBehaviorConfig, currentTime: number): boolean {
    // Check cooldown
    const lastChat = this.conversationHistory.get(playerId);
    if (lastChat && currentTime - lastChat < config.minTimeBetweenConversations) {
      return false;
    }
    
    // Check if already talking
    if (this.activeConversations.has(playerId)) {
      return false;
    }
    
    // Check player status if enabled
    if (config.respectPlayerStatus) {
      const player = this.bot?.getPlayerInfo(playerId);
      if (player) {
        // AvailabilityStatus: 0=ONLINE, 1=AWAY, 2=SPEAK, 3=LISTEN, 4=DO_NOT_DISTURB
        if (player.availabilityStatus === 1 || player.availabilityStatus === 4) {
          return false;  // AWAY or DO_NOT_DISTURB
        }
      }
    }
    
    // Check max conversations
    if (this.activeConversations.size >= config.maxConcurrentConversations) {
      return false;
    }
    
    return true;
  }
}
```

**Conversation Memory:**
- Per-bot, per-player memory system
- Remembers past conversations
- Tracks emotional state (bot and player)
- Extracts and remembers personal information (birthday, name, preferences)
- Relationship context (first met, conversation stats, important events)
- Personalized greetings based on memory

## Engagement Pattern (All Behaviors)

All behaviors follow the same engagement pattern:

1. **Player Movement Detection**: `onPlayerMoved` is called when players move
2. **Proximity Tracking**: `nearbyPlayers` map is populated only via `onPlayerMoved`
3. **Space Join Request**: Server sends `joinSpaceRequestMessage` when in proximity
4. **Space Join Decision**: `shouldJoinProximitySpace` is called (default: `true`)
5. **Space Joined**: `onSpaceJoined` is called
6. **Engagement Check**: If `nearbyPlayers.size === 0`, return early (ghost mode)
7. **Engagement**: If `nearbyPlayers.size > 0`, engage normally (stop, face, greet)

**Key Insight**: The `nearbyPlayers` map is the authoritative source for "did player actively approach bot". If empty, bot walked into idle player. If populated, player moved into proximity.

## Behavior Composition

Behaviors can be composed for complex behaviors:

```typescript
class CompositeBehavior extends BaseBehavior {
  private behaviors: BaseBehavior[] = [];
  
  addBehavior(behavior: BaseBehavior) {
    this.behaviors.push(behavior);
  }
  
  update(deltaTime: number) {
    for (const behavior of this.behaviors) {
      behavior.update(deltaTime);
    }
  }
}

// Example: Social bot that patrols
const socialPatrol = new CompositeBehavior();
socialPatrol.addBehavior(new PatrolBehavior(patrolConfig));
socialPatrol.addBehavior(new SocialBehavior(socialConfig));
```

## Custom Behaviors

Users can create custom behaviors by extending `BaseBehavior`:

```typescript
class CustomBehavior extends BaseBehavior {
  update(deltaTime: number) {
    // Custom logic
    if (!this.bot) return;
    
    // Check for engagement
    if (this.nearbyPlayers.size > 0) {
      this.bot.stop();
      // ... custom engagement logic
    } else {
      // ... custom movement logic
    }
  }
  
  onSpaceJoined(spaceName: string): void {
    // Only engage if player approached us
    if (this.nearbyPlayers.size === 0) return;
    
    // Custom engagement logic
  }
  
  // ... implement other required methods
}
```

## Behavior State Machine

Complex behaviors can use state machines:

```typescript
enum BotState {
  IDLE,
  WANDERING,
  APPROACHING,
  CONVERSING,
  LEAVING
}

class StatefulBehavior extends BaseBehavior {
  private state: BotState = BotState.IDLE;
  
  update(deltaTime: number) {
    switch (this.state) {
      case BotState.IDLE:
        this.handleIdle();
        break;
      case BotState.WANDERING:
        this.handleWandering();
        break;
      // ... etc
    }
  }
}
```

## Behavior Configuration UI

The bot editor allows users to configure behaviors visually:

- **Idle**: Set position, response radius
- **Patrol**: Add waypoints on map, set speed, pause duration
- **Social**: Set wander area, conversation settings, topics
- **Custom**: JSON editor for advanced configuration

## Best Practices

1. **Always check `nearbyPlayers.size`** in `onSpaceJoined` to determine if player approached bot
2. **Use `shouldJoinProximitySpace`** to control space joining (default `true` is usually correct)
3. **Skip pauses/stops** if players are nearby to avoid triggering bubbles with idle players
4. **Use `getNearbyPlayers()`** for real-time player detection (not just `nearbyPlayers` map)
5. **Face players continuously** during engagement using `facePosition()`
6. **Respect assigned spaces** - return to assigned space after conversations
7. **Clean up state** in `onSpaceLeft` to ensure proper resumption

## Technical Details

### Viewport System
- Bots use dynamic viewport centered on bot position (2000px radius)
- Ensures players remain in bot's knowledge even when bot moves
- Prevents players from disappearing from `getNearbyPlayers()` results

### Bot Identification
- Static `BotClient.botUserIds` set tracks all bot user IDs
- `BotClient.isBot(userId)` checks if a user ID belongs to a bot
- Bots filter themselves from player lists

### Proximity Detection
- Uses distance calculation with hysteresis (PROXIMITY_RADIUS / DISENGAGE_RADIUS)
- Prevents flickering at edge of proximity zone
- Only tracks players that have moved (via `onPlayerMoved`)

### Direction Updates
- `facePosition()` only sends updates when direction actually changes
- Prevents excessive network traffic
- Ensures smooth facing behavior
