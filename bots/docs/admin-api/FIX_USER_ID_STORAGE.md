# Fix User ID Storage and User Information

## Problem

Currently, bot conversations store `playerId` as an `INTEGER`, but:
1. **Unauthenticated users** have string IDs (e.g., `spaceUserId`, `uuid`) and names
2. **Authenticated users** have more details (email, etc.) but IDs may also be strings
3. The integer storage doesn't persist correctly for string IDs
4. Terminology uses "player" but should be "person" or "user"

## Solution

### 1. Change User ID from `number` to `string`

**Files to update:**
- `bots/memory/ConversationStorage.ts` - Change `playerId: number` to `userId: string`
- `bots/memory/ConversationMemory.ts` - Change `playerId: number` to `userId: string`
- All behavior files that use `playerId` - Convert to string

**Key changes:**
```typescript
// OLD
export interface ConversationRecord {
    playerId: number;
    playerName?: string;
}

// NEW
export interface ConversationRecord {
    userUuid?: string; // WorkAdventure UUID (ephemeral for guests)
    userId?: string; // Foreign key to User.id (only set if authenticated)
    userName?: string; // Display name (from request or User.name)
    isGuest?: boolean; // true if unauthenticated
    // Note: userEmail removed - join to User.email via userId instead
    
    // Backward compatibility (deprecated)
    playerId?: number;
    playerName?: string;
}
```

### 2. Update Database Schema

**Admin API needs to update Prisma schema:**

```prisma
// OLD
model BotsConversation {
  playerId     Int      @map("player_id")
  playerName   String?  @map("player_name") @db.VarChar(255)
  ...
}

// NEW
model BotsConversation {
  userUuid     String?  @map("user_uuid") @db.VarChar(255) // WorkAdventure UUID (ephemeral for guests)
  userId       String?  @map("user_id") // Foreign key to User.id (only set if authenticated)
  userName     String?  @map("user_name") @db.VarChar(255) // Display name (from request or User.name)
  isGuest      Boolean  @default(true) @map("is_guest") // true if unauthenticated
  // Removed: userEmail - join to User.email via userId instead
  
  // Relations
  user         User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  
  // Backward compatibility (deprecated, remove after migration)
  playerId     Int?     @map("player_id")
  playerName   String?  @map("player_name") @db.VarChar(255)
  
  @@index([userUuid])
  @@index([userId])
  @@index([botId, createdAt])
  ...
}
```

**Migration SQL:**

```sql
-- Step 1: Add new columns
ALTER TABLE bots_conversations_recent 
  ADD COLUMN user_uuid VARCHAR(255),
  ADD COLUMN user_id VARCHAR(255),
  ADD COLUMN user_name VARCHAR(255),
  ADD COLUMN is_guest BOOLEAN DEFAULT true;

-- Step 2: Migrate existing data (convert numeric playerId to string, try to match User.uuid)
UPDATE bots_conversations_recent bc
SET 
  user_uuid = CAST(bc.player_id AS VARCHAR),
  user_name = bc.player_name,
  is_guest = true -- Assume existing records are guests (or update based on your logic)
WHERE bc.player_id IS NOT NULL;

-- Step 3: Try to match authenticated users by UUID (if you have a mapping)
-- This depends on how you map numeric IDs to User.uuid
-- UPDATE bots_conversations_recent bc
-- SET user_id = u.id, is_guest = false
-- FROM users u
-- WHERE bc.user_uuid = u.uuid;

-- Step 4: Add foreign key constraint
ALTER TABLE bots_conversations_recent
  ADD CONSTRAINT fk_bots_conversation_user 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Step 5: Add indexes
CREATE INDEX idx_bots_conversation_user_uuid ON bots_conversations_recent(user_uuid);
CREATE INDEX idx_bots_conversation_user_id ON bots_conversations_recent(user_id);

-- Step 6: After verifying migration, drop old columns (optional, keep for backward compatibility)
-- ALTER TABLE bots_conversations_recent DROP COLUMN player_id;
-- ALTER TABLE bots_conversations_recent DROP COLUMN player_name;
```

### 3. Update Terminology

**Replace "player" with "person" or "user":**
- `playerId` → `userId` or `personId`
- `playerName` → `userName` or `personName`
- Comments and documentation

### 4. Update Bot Code to Pass User Information

**When starting conversations, pass full user info:**

```typescript
// In behaviors (IdleBehavior, SocialBehavior, PatrolBehavior)
onChatMessage(spaceName: string, message: string, senderId: number, user?: SpaceUser): void {
    // Get user info from SpaceUser
    const userUuid = user?.uuid; // WorkAdventure UUID (string)
    const userName = user?.name;
    const isGuest = !user?.isLogged; // true if not authenticated
    
    // Start conversation with user info
    // Note: userId (User.id) will be set by Admin API if user is authenticated
    this.conversationStorage?.startConversation(botId, userUuid || String(senderId), {
        name: userName,
        uuid: userUuid,
        isLogged: !isGuest, // or isGuest: isGuest
    });
}
```

### 5. Admin API Endpoints

**Update endpoints to handle string IDs:**

```typescript
// GET /api/bots/:botId/conversations
// Query params: userId (string) instead of playerId (number)

// Response should include:
{
  "conversations": [{
    "userUuid": "550e8400-e29b-41d4-a716-446655440000", // WorkAdventure UUID
    "userId": "user-uuid-from-db", // User.id if authenticated, null for guests
    "userName": "John Doe", // Display name
    "isGuest": false, // true if unauthenticated
    "user": { // Include User relation if authenticated (optional, can join in UI)
      "id": "user-uuid-from-db",
      "email": "john@example.com",
      "name": "John Doe"
    },
    ...
  }]
}
```

## Migration Strategy

1. **Bot Server Changes:**
   - Update interfaces to use `string` for user IDs
   - Convert numeric IDs to strings when storing: `String(playerId)`
   - Pass user information (name, uuid, email, isLogged) when available
   - Update all method signatures

2. **Admin API Changes:**
   - Update Prisma schema: Add `userUuid`, `userId`, `userName`, `isGuest` columns
   - Add foreign key relation to `User` table via `userId`
   - Migrate existing data: Convert `playerId` (Int) to `userUuid` (String)
   - Update endpoints to accept/return `userUuid` (string) instead of `playerId` (number)
   - Join to `User` table when `userId` is set to get email/name
   - Update UI to display user name (from conversation or User table) and email (from User table via join)

3. **Backward Compatibility:**
   - For now, convert numeric IDs to strings: `String(id)`
   - Store both old and new format during migration period
   - Eventually remove numeric ID support

## Files to Update

### Bot Server:
- `bots/memory/ConversationStorage.ts`
- `bots/memory/ConversationMemory.ts`
- `bots/memory/PersistentMemory.ts`
- `bots/behaviors/BaseBehavior.ts`
- `bots/behaviors/IdleBehavior.ts`
- `bots/behaviors/SocialBehavior.ts`
- `bots/behaviors/PatrolBehavior.ts`
- `bots/server/AdminApiService.ts`
- `bots/testing/BotTestRunner.ts`

### Admin API:
- Database schema migration
- Endpoint handlers for conversations
- UI components to display user information
