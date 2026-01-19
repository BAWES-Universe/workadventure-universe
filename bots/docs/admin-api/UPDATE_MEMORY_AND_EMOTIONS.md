# Update Memory and Emotions to Use UUID Matching

## Problem

Memory and emotions currently use `playerId: number` (integer), but we need to:
1. Use `userUuid` (string) to match authenticated users
2. Allow Admin API to match UUID to `User.id` for persistence
3. Support the same persistence strategy as conversations

## Current State

- **Memory Storage**: `POST /api/bots/memory/${botId}` sends `BotPlayerMemory` with `playerId: number`
- **Database Schema**: `bots_memory` table has `player_id INTEGER`
- **Internal Memory**: `BotPlayerMemory` interface has `playerId: number`

## Solution

### 1. Update BotPlayerMemory Interface

Add `userUuid` and `userId` fields (no backward compatibility):

```typescript
export interface BotPlayerMemory {
    // UUID matching fields (for persistence across sessions)
    userUuid: string; // REQUIRED - WorkAdventure UUID
    userId?: string; // Optional - User.id if authenticated (set by Admin API)
    isGuest?: boolean; // Optional - true if not authenticated (defaults to true)
    
    // Internal tracking (not persisted to Admin API)
    playerId: number; // Internal use only - for in-memory tracking
    
    // ... rest of fields
}
```

### 2. Update MemoryStorage to Include UUID

When saving memory, include `userUuid` from the tracking map:

```typescript
// In PersistentMemory or wherever memory is saved
const userUuid = this.userIdToUuid.get(playerId);
const isLogged = this.userIdToIsLogged.get(playerId) ?? false;

// Add to memory before saving
memory.userUuid = userUuid || String(playerId);
memory.isGuest = !isLogged;
```

### 3. Admin API Must Match UUIDs

When receiving memory via `POST /api/bots/memory/${botId}`, Admin API should:

1. **For each memory in the array:**
   - Check if `userUuid` is provided
   - If `isGuest === false` or `isLogged === true`, try to match `userUuid` to `User.uuid`
   - If match found, set `userId = User.id` and `isGuest = false`
   - If no match, set `userId = null` and `isGuest = true`

2. **Store in database:**
   - Update `bots_memory` table schema to use `user_uuid` and `user_id` (similar to conversations)
   - Keep `player_id` for backward compatibility during migration

### 4. Database Schema Update

**Prisma Schema:**

```prisma
model BotsMemory {
  id              Int       @id @default(autoincrement())
  botId           String    @map("bot_id") @db.VarChar(255)
  userUuid        String    @map("user_uuid") @db.VarChar(255) // REQUIRED - WorkAdventure UUID
  userId          String?   @map("user_id") // Optional - Foreign key to User.id
  userName        String?   @map("user_name") @db.VarChar(255)
  isGuest         Boolean   @default(true) @map("is_guest")
  memories        Json?     // Array of memory objects
  emotions        Json?     // Emotion data
  lastEmotionUpdate DateTime? @map("last_emotion_update")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  
  // Relations
  user            User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  
  @@unique([botId, userUuid]) // Changed from [botId, playerId]
  @@index([botId])
  @@index([userUuid])
  @@index([userId])
  @@map("bots_memory")
}
```

**Migration SQL:**

```sql
-- Step 1: Add new columns
ALTER TABLE bots_memory 
  ADD COLUMN user_uuid VARCHAR(255) NOT NULL,
  ADD COLUMN user_id VARCHAR(255),
  ADD COLUMN user_name VARCHAR(255),
  ADD COLUMN is_guest BOOLEAN DEFAULT true;

-- Step 2: Migrate existing data (set user_uuid from player_id)
UPDATE bots_memory bm
SET 
  user_uuid = CAST(bm.player_id AS VARCHAR),
  is_guest = true -- Assume existing records are guests
WHERE bm.player_id IS NOT NULL;

-- Step 3: Make user_uuid NOT NULL (after migration)
-- Already done in Step 1

-- Step 3: Add foreign key constraint
ALTER TABLE bots_memory
  ADD CONSTRAINT fk_bots_memory_user 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Step 4: Add indexes
CREATE INDEX idx_bots_memory_user_uuid ON bots_memory(user_uuid);
CREATE INDEX idx_bots_memory_user_id ON bots_memory(user_id);

-- Step 5: Update unique constraint (after migration)
ALTER TABLE bots_memory DROP CONSTRAINT IF EXISTS bots_memory_bot_id_player_id_key;
ALTER TABLE bots_memory ADD CONSTRAINT bots_memory_bot_id_user_uuid_key UNIQUE (bot_id, user_uuid);

-- Step 6: Remove old columns (after verifying migration)
ALTER TABLE bots_memory DROP COLUMN IF EXISTS player_id;
ALTER TABLE bots_memory DROP COLUMN IF EXISTS player_name;
```

### 5. Admin API Implementation

**When receiving memory:**

```typescript
// POST /api/bots/memory/:botId
async function saveMemory(botId: string, memories: BotPlayerMemory[]) {
  for (const memory of memories) {
    let userId: string | null = null;
    let isGuest = true;
    
    // If user claims to be logged in, try to match UUID
    if (memory.isGuest === false || memory.isLogged === true) {
      if (memory.userUuid) {
        const user = await prisma.user.findUnique({
          where: { uuid: memory.userUuid }
        });
        
        if (user) {
          userId = user.id;
          isGuest = false;
        }
      }
    }
    
        // Store memory with matched userId
        await prisma.botsMemory.upsert({
          where: {
            botId_userUuid: {
              botId: botId,
              userUuid: memory.userUuid, // REQUIRED
            }
          },
          update: {
            userId: userId,
            userName: memory.userName,
            isGuest: isGuest,
        memories: memory.memories,
        emotions: memory.emotions,
        lastEmotionUpdate: memory.lastEmotionUpdate ? new Date(memory.lastEmotionUpdate) : null,
        updatedAt: new Date(),
      },
          create: {
            botId: botId,
            userUuid: memory.userUuid, // REQUIRED
            userId: userId,
            userName: memory.userName,
            isGuest: isGuest,
        memories: memory.memories,
        emotions: memory.emotions,
        lastEmotionUpdate: memory.lastEmotionUpdate ? new Date(memory.lastEmotionUpdate) : null,
      }
    });
  }
}
```

### 6. Querying Memory

**For authenticated users (persistent):**
```sql
SELECT * FROM bots_memory 
WHERE bot_id = $botId AND user_id = $userId;
```

**For guests (current session only):**
```sql
SELECT * FROM bots_memory 
WHERE bot_id = $botId AND user_uuid = $userUuid AND is_guest = true;
```

## Benefits

1. **Persistent memory for authenticated users** - Memory linked via `userId` persists across sessions
2. **Consistent with conversations** - Same UUID matching pattern
3. **Clean schema** - No deprecated fields, uses UUID-based identification
4. **Guest memory still works** - Ephemeral, tied to session UUID

## Important Notes

1. **Memory is stored per bot-user pair** - Unique constraint on `(botId, userUuid)`
2. **Emotions update frequently** - Use `immediate` saveType for emotion-only updates
3. **Full memory saves are periodic** - Use `periodic` saveType for full memory saves
4. **UUID matching is fire-and-forget** - Don't block memory saves if UUID lookup fails
