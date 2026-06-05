# Patrol Bot: Bot Keeps Walking After Player Interaction — Fix Plan

> **For Hermes:** Use subagent-driven-development skill to implement tasks.

**Goal:** Fix the race condition where a patrol bot continues walking to its next waypoint instead of stopping when a player interacts with it (enters its bubble/conversation space).

**Architecture:** Two root causes found. (1) `moveTowardsWaypoint()` restarts async pathfinding even when `currentSpaceName` is set, creating a 1-2 tick race window. (2) The ghost-mode idle detection (2-second IDLE_RESUME_DELAY) allows the bot to "ghost through" a stationary player who just interacted with it, resuming patrol movement while the player is still nearby.

**Files to modify:**
- `bots/behaviors/PatrolBehavior.ts` — two buggy sections identified
- `bots/client/BotClient.ts` — moveTo() has guard but moveToWithPathfinding() does not

---

### Task 1: Add `currentSpaceName` / `engagedWithUsers` guard to `moveTowardsWaypoint()`

**Objective:** Prevent `moveTowardsWaypoint()` from starting new pathfinding when the bot is in a conversation space.

**Files:**
- Modify: `bots/behaviors/PatrolBehavior.ts:723-826`

**Problem:** `moveTowardsWaypoint()` (called from lines 243 and 493) does not check `this.currentSpaceName` or `this.engagedWithUsers.size` before calling `moveToWithPathfinding()`. When `onSpaceJoined` cancels pathfinding and stops the bot, the very next `behavior.update()` tick sees `!this.bot.getIsFollowingPath()` is true and `this.targetWaypoint` is still set, so it fires `moveTowardsWaypoint()` which starts a NEW async pathfinding operation. Because `moveToWithPathfinding()` awaits `pathfindingManager.findPath()`, `isFollowingPath` is still false when `BotClient.update()` checks it in the same tick — the guard misses it. Next tick, the pathfinding promise resolved and `isFollowingPath = true` — bot starts moving again.

**Step 1: Add guard at the top of `moveTowardsWaypoint()`**

Add this check immediately after the `if (!this.bot || !this.targetWaypoint) return;` line:

```typescript
// CRITICAL: Don't restart pathfinding if we're in a conversation space
const config = this.config as PatrolBehaviorConfig;
const shouldRespond = config.respondToPlayers !== false;
if (shouldRespond && (this.currentSpaceName || this.engagedWithUsers.size > 0)) {
    return; // Bot is in a conversation space — don't restart movement
}
```

**Step 2: Also add guard to the section at line 471 (the main "move to waypoint" block)**

Add an additional guard before calling `moveTowardsWaypoint`:

```typescript
if (this.targetWaypoint) {
    if (!this.bot.getIsFollowingPath()) {
        // DOUBLE CHECK: Don't start pathfinding if in a space (redundant with guard in moveTowardsWaypoint, 
        // but catches the case where the async pathfinding hasn't resolved yet in the same tick)
        if (shouldRespond && (this.currentSpaceName || this.engagedWithUsers.size > 0)) {
            return; // Silently skip — in conversation space
        }
        ...
        this.moveTowardsWaypoint(config, deltaTime).catch(...)
    }
}
```

---

### Task 2: Extend `IDLE_RESUME_DELAY` and add "recently interacted" guard to ghost mode

**Objective:** Prevent the ghost-mode code from resuming patrol movement while a player is still standing next to the bot after interacting.

**Files:**
- Modify: `bots/behaviors/PatrolBehavior.ts:218-249`

**Problem:** The ghost-mode code at lines 218-249 checks if all nearby players have been idle for >2 seconds (`IDLE_RESUME_DELAY = 2000`). If they have, it resumes patrol movement. But a player who just interacted with the bot by typing a message may be standing still (idle) for longer than 2 seconds while reading the bot's response or waiting for the AI to reply. The bot ghosts through them and walks away mid-conversation.

**Step 1: Add a `lastSpaceInteractionTime` field**

Add near the top of the class (around line 42):

```typescript
private lastSpaceInteractionTime: number = 0; // Track when bot was last in a conversation space
private readonly GHOST_RESUME_COOLDOWN = 10000; // 10 seconds after leaving a space before ghost mode resumes
```

**Step 2: Update `onSpaceJoined` to record the interaction time**

In `onSpaceJoined` (around line 635), add:

```typescript
this.currentSpaceName = spaceName;
this.lastSpaceInteractionTime = Date.now(); // Track when interaction started
```

**Step 3: Update `onSpaceLeft` to record when interaction ended**

In `onSpaceLeft` (around line 719), update:

```typescript
onSpaceLeft(spaceName: string): void {
    if (!this.currentSpaceName) return;
    this.currentSpaceName = null;
    this.spaceLeftTime = Date.now();
    this.lastSpaceInteractionTime = Date.now(); // Record when interaction ended
}
```

**Step 4: Add recency check to ghost-mode resume**

In the ghost-mode block (around line 235), add a check:

```typescript
if (allPlayersIdle && this.nearbyPlayers.size > 0) {
    // GHOST MODE: Check if we recently interacted with any of these players
    const now = Date.now();
    const timeSinceInteraction = now - this.lastSpaceInteractionTime;
    if (timeSinceInteraction < this.GHOST_RESUME_COOLDOWN) {
        // Too soon after a space interaction — don't ghost through players
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[PatrolBehavior] ⏳ Ghost mode blocked — only ${Math.round(timeSinceInteraction / 1000)}s since last space interaction (cooldown: ${this.GHOST_RESUME_COOLDOWN / 1000}s)`);
        }
        return;
    }
    
    // Original code continues...
    if (this.targetWaypoint) {
        this.moveTowardsWaypoint(config, deltaTime).catch(...)
    }
    return;
}
```

---

### Task 3: Add `currentSpaceName` guard to the "active players check" block

**Objective:** Prevent the bot from stopping for "active players" at line 274 AFTER it has already returned from the space check at line 206 — there's a redundancy gap.

**Files:**
- Modify: `bots/behaviors/PatrolBehavior.ts:250-303`

**Problem:** The code at lines 251-303 checks for nearby active players and stops the bot. But if the bot is in a space (currentSpaceName is set) AND there are no "active" nearby players (all idle), this block won't fire. The space check at line 206 already handles this, so this block is a secondary safety net. But the condition at line 274 (`hasNearbyPlayers && hasActivePlayers`) is wrong — it should also fire when `currentSpaceName` is set regardless of player activity.

Fix: Add `this.currentSpaceName` to the condition at line 274:

```typescript
if ((hasNearbyPlayers && hasActivePlayers || this.currentSpaceName) && !this.isLeading) {
```

---

### Task 4: Add space guard to `moveToWithPathfinding()` in BotClient.ts

**Objective:** Prevent `moveToWithPathfinding()` from setting `isFollowingPath = true` when the bot is in a conversation space.

**Files:**
- Modify: `bots/client/BotClient.ts:551-709`

**Problem:** `moveTo()` has a guard at line 399 that blocks movement if `isInSpace`. But `moveToWithPathfinding()` has no equivalent guard — it blindly sets `isFollowingPath = true` and `state.setMoving(true)` after the async pathfinding resolves. This creates a window where path following is active even though the bot should be stopped.

Add a guard after the pathfinding resolves (around line 694):

```typescript
// After pathfinding resolves but before setting isFollowingPath:
if (this.behavior) {
    const behaviorType = (this.behavior as any)?.config?.type;
    const respondToPlayers = (this.behavior as any)?.config?.respondToPlayers;
    const isInSpace = (this.behavior as any)?.currentSpaceName || (this.behavior as any)?.engagedWithUsers?.size > 0;
    if (behaviorType === 'patrol' && isInSpace && respondToPlayers !== false) {
        // Bot is in a space — don't start following path
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🛑 moveToWithPathfinding BLOCKED — bot is in space`);
        }
        return false;
    }
}
```

---

### Verification

1. **Unit test:** Create a patrol bot scenario where a player enters the bot's bubble. Verify bot stops immediately (within 1 frame).
2. **Unit test:** Player stands still after interaction for 3 seconds. Verify bot does NOT ghost through them for at least 10 seconds.
3. **Unit test:** Player walks away (leaves bubble). After 10s cooldown, verify bot resumes patrol.
4. **Manual test:** Deploy with `ENABLE_BOT_DEBUG=true`, observe logs for "BLOCKED", "ghost mode blocked" messages.
5. **Edge case:** Bot leading someone while passing through a bubble — verify leading override still works (`!this.isLeading` guard).