# User Identification and Conversation Persistence

## Problem

WorkAdventure generates **ephemeral UUIDs** for guests (new UUID each session), making it impossible to persist guest conversations across sessions. For authenticated users, we need to match the WorkAdventure UUID to the `User` table to get the persistent `userId`.

## Solution

### 1. Bot Server Sends Authentication Status

The bot server now tracks and sends `isLogged` status from `SpaceUser`:

```typescript
{
  userUuid: string,      // REQUIRED - WorkAdventure UUID (ephemeral for guests)
  userId?: string,      // Optional - Will be set by Admin API if authenticated
  userName?: string,    // Optional - Display name
  isGuest?: boolean,    // Optional - true if not authenticated (from isLogged)
  ...
}
```

### 2. Admin API Must Match UUID to User Table

**When storing a conversation, Admin API should:**

1. **Check if `isGuest === false` or `isLogged === true`** (from bot server)
2. **Try to match `userUuid` to `User.uuid`** in the database:
   ```sql
   SELECT id FROM users WHERE uuid = $userUuid
   ```
3. **If match found:**
   - Set `userId = User.id` (persistent identifier)
   - Set `isGuest = false`
   - Conversation is now linked to authenticated user
4. **If no match:**
   - Set `userId = null`
   - Set `isGuest = true`
   - Conversation is ephemeral (tied to this session's UUID)

### 3. Conversation Persistence Strategy

**Authenticated Users:**
- ✅ **Persist across sessions** - Conversations linked via `userId` (User.id)
- ✅ **Can query by user** - `SELECT * FROM bots_conversations_recent WHERE user_id = $userId`
- ✅ **Survives UUID changes** - Even if WorkAdventure generates new UUID, conversations persist via `userId`

**Guest Users:**
- ❌ **Ephemeral** - Conversations tied to ephemeral UUID, lost when session ends
- ❌ **Cannot persist** - No way to identify same guest across sessions
- ✅ **Still stored** - Available for current session viewing, but not queryable after session ends

### 4. Admin API Implementation

**When receiving conversation from bot server:**

```typescript
// POST /api/bots/:botId/conversations
async function storeConversation(conversation: ConversationRecord) {
  let userId: string | null = null;
  let isGuest = true;
  
  // If bot says user is logged in, try to match UUID
  if (conversation.isGuest === false || conversation.isLogged === true) {
    const user = await prisma.user.findUnique({
      where: { uuid: conversation.userUuid }
    });
    
    if (user) {
      userId = user.id;
      isGuest = false;
    }
  }
  
  // Store conversation with matched userId
  await prisma.botsConversation.create({
    data: {
      botId: conversation.botId,
      userUuid: conversation.userUuid,
      userId: userId,  // null for guests, User.id for authenticated
      userName: conversation.userName,
      isGuest: isGuest,
      messages: conversation.messages,
      startedAt: new Date(conversation.startedAt),
      endedAt: new Date(conversation.endedAt),
      messageCount: conversation.messageCount,
    }
  });
}
```

### 5. Querying Conversations

**For authenticated users:**
```sql
-- Get all conversations for a specific user (persistent)
SELECT * FROM bots_conversations_recent 
WHERE user_id = $userId
ORDER BY created_at DESC;
```

**For guests (current session only):**
```sql
-- Get conversations for current session UUID
SELECT * FROM bots_conversations_recent 
WHERE user_uuid = $userUuid 
AND is_guest = true
ORDER BY created_at DESC;
```

**All conversations for a bot:**
```sql
-- Get all conversations, showing user info for authenticated users
SELECT 
  c.*,
  u.email,
  u.name as user_name_from_db
FROM bots_conversations_recent c
LEFT JOIN users u ON c.user_id = u.id
WHERE c.bot_id = $botId
ORDER BY c.created_at DESC;
```

## Important Notes

1. **Guest conversations are ephemeral by design** - WorkAdventure doesn't provide persistent identifiers for guests
2. **Authenticated users must have their UUID in the User table** - Admin API should ensure `User.uuid` is set when users authenticate
3. **Bot server sends `isLogged` but Admin API should verify** - Always try to match UUID even if `isGuest = false`, as the bot's information might be stale
4. **UI should show different indicators** - Show "Guest" for `isGuest = true`, show user email/name for authenticated users

## Migration for Existing Conversations

If you have existing conversations with numeric `playerId`:

1. **Cannot migrate guest conversations** - No way to identify which guest was which
2. **Can try to migrate authenticated users** - If you have a mapping of `playerId` to `User.id`, you can update:
   ```sql
   UPDATE bots_conversations_recent 
   SET user_id = $userId, is_guest = false
   WHERE player_id = $playerId AND user_id IS NULL;
   ```
