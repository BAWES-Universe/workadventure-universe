# Assigned Spaces Feature

## Overview

Bots can be assigned to specific areas (spaces) on the map. When a bot moves outside its assigned space or finishes a conversation, it will automatically return to its assigned area.

## Configuration

Assign a space to a bot by including `assignedSpace` in the behavior configuration:

```typescript
const behavior = new SocialBehavior({
    type: 'social',
    assignedSpace: {
        center: { x: 500, y: 500 },  // Center of the assigned area
        radius: 200,                  // Maximum distance from center
    },
    // ... other config
});
```

## How It Works

### 1. Space Assignment

When a bot is configured with an `assignedSpace`:
- The bot's wander/patrol area is constrained to the assigned space
- The bot will not seek conversations outside its assigned space
- After conversations end, the bot returns to its assigned space

### 2. Automatic Return

When a bot leaves a conversation (space), the `onSpaceLeft()` method is called:
- The bot checks if it's outside its assigned space
- If outside, it calculates a path back to the assigned space
- The bot moves back to within the assigned radius

### 3. Constraint Enforcement

During normal behavior:
- **SocialBehavior**: Only looks for conversations within assigned space
- **PatrolBehavior**: Waypoints should be within assigned space
- **IdleBehavior**: Bot stays at assigned position

## Example Use Cases

### 1. Reception Bot

A bot assigned to the reception area:

```typescript
const receptionBot = new SocialBehavior({
    type: 'social',
    assignedSpace: {
        center: { x: 100, y: 100 },  // Reception desk location
        radius: 150,                   // Reception area
    },
    conversationRadius: 200,
    // ... other config
});
```

This bot will:
- Stay near the reception area
- Greet players who approach
- Return to reception after conversations

### 2. Zone-Specific Helper

A bot assigned to a specific zone:

```typescript
const zoneBot = new IdleBehavior({
    type: 'idle',
    assignedSpace: {
        center: { x: 500, y: 500 },
        radius: 100,
    },
    position: { x: 500, y: 500 },
    responseRadius: 150,
});
```

This bot will:
- Stay in its assigned zone
- Help players in that area
- Never leave the zone

### 3. Patrol Route in Area

A bot that patrols within a specific area:

```typescript
const patrolBot = new PatrolBehavior({
    type: 'patrol',
    assignedSpace: {
        center: { x: 300, y: 300 },
        radius: 250,
    },
    waypoints: [
        { x: 250, y: 300 },  // All within assigned space
        { x: 350, y: 300 },
        { x: 350, y: 350 },
        { x: 250, y: 350 },
    ],
    loop: true,
});
```

## Implementation Details

### BaseBehavior Methods

All behaviors inherit these methods from `BaseBehavior`:

```typescript
// Check if bot is within assigned space
protected isWithinAssignedSpace(): boolean

// Return bot to assigned space
protected returnToAssignedSpace(): void
```

### Behavior-Specific Behavior

#### SocialBehavior
- Only seeks conversations within assigned space
- Returns to assigned space after conversations
- Wanders within assigned space (if no wander config, uses assigned space)

#### PatrolBehavior
- Returns to assigned space after conversations
- Waypoints should be within assigned space

#### IdleBehavior
- Position should be within assigned space
- Stays at assigned position

## Visual Representation

When editing bots in the map editor, the assigned space can be visualized:
- Circle overlay showing the assigned area
- Center point marker
- Radius indicator

## Best Practices

1. **Appropriate Radius**: Set radius based on the area you want the bot to cover
2. **Center Placement**: Place center at a logical location (e.g., desk, entrance)
3. **Overlap Consideration**: Ensure assigned spaces don't overlap unnecessarily
4. **Patrol Routes**: Make sure patrol waypoints are within assigned space
5. **Conversation Radius**: Set conversation radius smaller than assigned space radius

## Integration with Admin API

Assigned spaces are tracked in the Admin API:

```json
{
  "botId": "bot-123",
  "assignedSpace": {
    "center": { "x": 500, "y": 500 },
    "radius": 200
  }
}
```

This allows you to:
- Query bots by location
- Analyze bot distribution across maps
- Ensure proper bot placement

