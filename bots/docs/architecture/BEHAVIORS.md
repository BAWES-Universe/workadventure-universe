# Bot Behavior System

## Overview

The behavior system defines how bots act in the WorkAdventure world. Behaviors are modular, composable, and extensible.

## Base Behavior

All behaviors extend `BaseBehavior`:

```typescript
abstract class BaseBehavior {
  protected bot: BotClient;
  protected config: BehaviorConfig;
  
  abstract update(deltaTime: number): void;
  abstract onPlayerApproached(playerId: number, distance: number): void;
  abstract onSpaceJoined(spaceName: string, users: SpaceUser[]): void;
  abstract onSpaceLeft(spaceName: string): void;
  abstract onChatMessage(spaceName: string, message: string, senderId: number): void;
}
```

## Behavior Types

### 1. IdleBehavior

**Purpose**: Bot stands in place and responds to interactions.

**Configuration:**
```typescript
interface IdleBehaviorConfig {
  position: { x: number; y: number };
  responseRadius: number;  // Distance to respond to players
  greetingMessages: string[];  // Random greetings
  idleAnimations: string[];  // Idle animations to play
}
```

**Behavior:**
- Stay at fixed position
- When player approaches within `responseRadius`, greet them
- Join conversation if player initiates
- Respond to chat messages naturally
- Play idle animations periodically

### 2. PatrolBehavior

**Purpose**: Bot follows a predefined route.

**Configuration:**
```typescript
interface PatrolBehaviorConfig {
  waypoints: Array<{ x: number; y: number }>;
  loop: boolean;  // Loop back to start
  pauseAtWaypoints: number;  // Seconds to pause
  speed: number;  // Movement speed
  respondToPlayers: boolean;  // Pause to chat?
}
```

**Behavior:**
- Move between waypoints
- Pause at each waypoint
- Optionally respond to nearby players
- Loop route if configured

### 3. SocialBehavior

**Purpose**: Bot actively seeks conversations with players.

**Configuration:**
```typescript
interface SocialBehaviorConfig {
  conversationRadius: number;  // Distance to detect players
  minTimeBetweenConversations: number;  // Cooldown (seconds)
  maxConversationDuration: number;  // Max chat time
  conversationHistorySize: number;  // Remember last N players
  respectPlayerStatus: boolean;  // Check player availability
  maxConcurrentConversations: number;  // Limit active chats
  conversationTopics: string[];  // Topics to discuss
  wanderRadius: number;  // Area to wander in
  wanderCenter: { x: number; y: number };
}
```

**Behavior:**
- Wander within `wanderRadius`
- Detect players within `conversationRadius`
- Check if player is available (not busy, not in conversation)
- Check conversation history (avoid recent players)
- Check if other bots are targeting same player
- Approach player and initiate conversation
- Maintain conversation for reasonable duration
- Leave gracefully when done

**Smart Conversation Management:**
```typescript
class SocialBehavior extends BaseBehavior {
  private conversationHistory: Map<number, Date> = new Map();
  private activeConversations: Set<number> = new Set();
  
  canStartConversation(playerId: number): boolean {
    // Check cooldown
    const lastChat = this.conversationHistory.get(playerId);
    if (lastChat && Date.now() - lastChat.getTime() < this.config.minTimeBetweenConversations) {
      return false;
    }
    
    // Check if already talking
    if (this.activeConversations.has(playerId)) {
      return false;
    }
    
    // Check player status (via BotRegistry)
    const playerStatus = this.bot.getPlayerStatus(playerId);
    if (playerStatus === 'busy' || playerStatus === 'away') {
      return false;
    }
    
    // Check if other bots are targeting this player
    if (this.bot.registry.isPlayerTargeted(playerId)) {
      return false;
    }
    
    // Check max conversations
    if (this.activeConversations.size >= this.config.maxConcurrentConversations) {
      return false;
    }
    
    return true;
  }
}
```

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
  }
  
  onPlayerApproached(playerId: number, distance: number) {
    // Custom response
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
- **Patrol**: Add waypoints on map, set speed
- **Social**: Set wander area, conversation settings
- **Custom**: JSON editor for advanced configuration

