# Admin API Integration

## Overview

The bot system integrates with WorkAdventure's Admin API to track bot configuration and usage across rooms, worlds, universes, and users.

## Configuration

Set these environment variables to enable Admin API integration:

```bash
ADMIN_API_URL=http://your-admin-api.com
ADMIN_API_TOKEN=your-api-token
```

## Admin API Endpoints

Your Admin API should implement these endpoints:

### 1. Save Bot Configuration

**POST** `/api/bots/configuration`

Save or update a bot configuration.

**Request Body:**
```json
{
  "botId": "bot-123",
  "name": "Helper Bot",
  "roomUrl": "https://play.workadventu.re/@/org/world/room",
  "worldUrl": "https://play.workadventu.re/@/org/world",
  "universeUrl": "https://play.workadventu.re/@/org",
  "userId": "user-456",
  "behaviorType": "social",
  "behaviorConfig": {
    "conversationRadius": 300,
    "wanderRadius": 500,
    "wanderCenter": { "x": 500, "y": 500 }
  },
  "aiProvider": "lmstudio",
  "aiConfig": {
    "model": "llama-2-7b",
    "temperature": 0.7
  },
  "assignedSpace": {
    "center": { "x": 500, "y": 500 },
    "radius": 200
  },
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

**Response:** `204 No Content` or `200 OK`

### 2. Get Bot Configuration

**GET** `/api/bots/configuration/:botId`

Get a specific bot's configuration.

**Response:**
```json
{
  "botId": "bot-123",
  "name": "Helper Bot",
  ...
}
```

### 3. List Bot Configurations

**GET** `/api/bots/configuration`

Query parameters:
- `roomUrl` - Filter by room
- `worldUrl` - Filter by world
- `universeUrl` - Filter by universe
- `userId` - Filter by user who created the bot

**Response:**
```json
[
  {
    "botId": "bot-123",
    "name": "Helper Bot",
    ...
  }
]
```

### 4. Delete Bot Configuration

**DELETE** `/api/bots/configuration/:botId`

Delete a bot configuration.

**Response:** `204 No Content`

### 5. Track Bot Usage

**POST** `/api/bots/usage`

Track bot usage metrics.

**Request Body:**
```json
{
  "botId": "bot-123",
  "roomUrl": "https://play.workadventu.re/@/org/world/room",
  "worldUrl": "https://play.workadventu.re/@/org/world",
  "universeUrl": "https://play.workadventu.re/@/org",
  "userId": "user-456",
  "totalConversations": 42,
  "totalMessages": 150,
  "totalActiveTime": 3600000,
  "lastActiveAt": "2024-01-01T12:00:00Z",
  "conversationsByDate": [
    { "date": "2024-01-01", "count": 10 },
    { "date": "2024-01-02", "count": 12 }
  ]
}
```

**Response:** `204 No Content`

### 6. Get Bot Usage Metrics

**GET** `/api/bots/usage`

Query parameters:
- `roomUrl` - Filter by room
- `worldUrl` - Filter by world
- `universeUrl` - Filter by universe
- `userId` - Filter by user
- `botId` - Filter by bot
- `startDate` - Start date (ISO 8601)
- `endDate` - End date (ISO 8601)

**Response:**
```json
[
  {
    "botId": "bot-123",
    "totalConversations": 42,
    "totalMessages": 150,
    ...
  }
]
```

### 7. Track Conversation Event

**POST** `/api/bots/conversations`

Track individual conversation events.

**Request Body:**
```json
{
  "botId": "bot-123",
  "playerId": 789,
  "roomUrl": "https://play.workadventu.re/@/org/world/room",
  "duration": 120000,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Response:** `204 No Content`

### 8. Track Message Event

**POST** `/api/bots/messages`

Track individual message events.

**Request Body:**
```json
{
  "botId": "bot-123",
  "roomUrl": "https://play.workadventu.re/@/org/world/room",
  "messageLength": 50,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Response:** `204 No Content`

## Usage Tracking

The bot system automatically tracks:

1. **Total Conversations**: Number of conversations the bot has had
2. **Total Messages**: Number of messages sent by the bot
3. **Total Active Time**: Time the bot has been active (in milliseconds)
4. **Last Active At**: Timestamp of last activity
5. **Conversations By Date**: Daily conversation counts

## Integration Points

### Bot Client Integration

```typescript
import { adminApiService } from './server/AdminApiService';
import { botUsageTracker } from './server/BotUsageTracker';

// When bot starts
botUsageTracker.startTracking({
  botId: bot.getBotId(),
  roomUrl: config.roomUrl,
  worldUrl: extractWorldUrl(config.roomUrl),
  userId: config.userId,
});

// When bot has conversation
botUsageTracker.trackConversation(botId, playerId, roomUrl, duration);

// When bot sends message
botUsageTracker.trackMessage(botId, roomUrl, message.length);

// Update active time in update loop
botUsageTracker.updateActiveTime(botId, roomUrl, deltaTime);
```

### Behavior Integration

Behaviors can access assigned space configuration:

```typescript
const behavior = new SocialBehavior({
  type: 'social',
  assignedSpace: {
    center: { x: 500, y: 500 },
    radius: 200,
  },
  // ... other config
});
```

The behavior will automatically return to the assigned space after conversations end.

## Database Schema Suggestions

If you're implementing the Admin API, consider these database tables:

### bots_configuration
```sql
CREATE TABLE bots_configuration (
  bot_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  room_url TEXT NOT NULL,
  world_url TEXT NOT NULL,
  universe_url TEXT,
  user_id VARCHAR(255),
  behavior_type VARCHAR(50) NOT NULL,
  behavior_config JSONB,
  ai_provider VARCHAR(50),
  ai_config JSONB,
  assigned_space JSONB,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

### bots_usage
```sql
CREATE TABLE bots_usage (
  id SERIAL PRIMARY KEY,
  bot_id VARCHAR(255) NOT NULL,
  room_url TEXT NOT NULL,
  world_url TEXT NOT NULL,
  universe_url TEXT,
  user_id VARCHAR(255),
  total_conversations INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_active_time BIGINT DEFAULT 0,
  last_active_at TIMESTAMP,
  conversations_by_date JSONB,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(bot_id, room_url)
);
```

### bots_conversations
```sql
CREATE TABLE bots_conversations (
  id SERIAL PRIMARY KEY,
  bot_id VARCHAR(255) NOT NULL,
  player_id INTEGER NOT NULL,
  room_url TEXT NOT NULL,
  duration INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL
);
```

### bots_messages
```sql
CREATE TABLE bots_messages (
  id SERIAL PRIMARY KEY,
  bot_id VARCHAR(255) NOT NULL,
  room_url TEXT NOT NULL,
  message_length INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL
);
```

## Example Queries

### Get all bots in a world
```sql
SELECT * FROM bots_configuration 
WHERE world_url = 'https://play.workadventu.re/@/org/world';
```

### Get usage stats for a user's bots
```sql
SELECT 
  bc.name,
  bu.total_conversations,
  bu.total_messages,
  bu.total_active_time
FROM bots_configuration bc
JOIN bots_usage bu ON bc.bot_id = bu.bot_id
WHERE bc.user_id = 'user-456';
```

### Get daily conversation trends
```sql
SELECT 
  DATE(timestamp) as date,
  COUNT(*) as conversations
FROM bots_conversations
WHERE bot_id = 'bot-123'
GROUP BY DATE(timestamp)
ORDER BY date;
```

