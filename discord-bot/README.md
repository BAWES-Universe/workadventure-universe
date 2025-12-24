# Discord Bot Service for WorkAdventure

A Discord bot service that monitors WorkAdventure rooms and sends real-time user join/leave events to Discord, along with periodic room activity statistics.

## Features

- **Real-time Events**: Sends Discord messages when users join or leave rooms
- **Room Activity Reports**: Updates a Discord channel every 10 minutes with current room statistics
- **Automatic Room Discovery**: Automatically discovers and monitors all active rooms
- **User Name Caching**: Caches user names to display them in leave events
- **Automatic Reconnection**: Handles WebSocket disconnections gracefully

## Architecture

The service consists of:

1. **WebSocket Manager**: Connects to WorkAdventure's Admin WebSocket to receive real-time events
2. **Room Discovery**: Polls the `/rooms` endpoint to discover all active rooms
3. **Discord Bot Client**: Sends messages to Discord using the Bot API
4. **Stats Scheduler**: Periodically updates the stats channel with room activity

## Setup

### 1. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section and create a bot
4. Copy the bot token
5. Enable the following bot permissions:
   - View Channels
   - Send Messages
   - Manage Messages
   - Embed Links
   - Read Message History
6. Invite the bot to your server using the OAuth2 URL generator
7. Get the channel IDs for:
   - Event channel (for real-time join/leave events)
   - Stats channel (for periodic activity reports)

### 2. Environment Variables

Create a `.env` file or set the following environment variables:

**Required:**
- `ADMIN_SOCKETS_TOKEN`: JWT secret for WorkAdventure Admin WebSocket authentication
- `ADMIN_API_TOKEN`: Token for WorkAdventure Admin API `/rooms` endpoint
- `DISCORD_BOT_TOKEN`: Discord bot token from Developer Portal
- `DISCORD_EVENT_CHANNEL_ID`: Discord channel ID for real-time events
- `DISCORD_STATS_CHANNEL_ID`: Discord channel ID for periodic stats

**Optional:**
- `PUSHER_URL`: WorkAdventure play service URL (default: `http://play.workadventure.localhost`)
- `ROOM_DISCOVERY_INTERVAL`: Room discovery polling interval in milliseconds (default: `30000` = 30 seconds)
- `STATS_UPDATE_INTERVAL`: Stats channel update interval in milliseconds (default: `600000` = 10 minutes)

### 3. Running with Docker Compose

Add to your `docker-compose.yaml` or use the provided `docker-compose.discord.yaml`:

```bash
docker-compose -f docker-compose.yaml -f docker-compose.discord.yaml up -d discord-bot
```

### 4. Running Locally

```bash
cd discord-bot
npm install
npm run build
npm start
```

For development:

```bash
npm run dev
```

## How It Works

### Real-time Events

1. Service connects to WorkAdventure Admin WebSocket
2. Discovers all active rooms via `/rooms` endpoint
3. Subscribes to all discovered rooms
4. Receives `MemberJoin` and `MemberLeave` events
5. Sends formatted Discord embeds to the event channel

### Stats Channel

1. Every 10 minutes (configurable), the service:
   - Fetches current room statistics from `/rooms` endpoint
   - Deletes all messages in the stats channel
   - Sends a new embed with:
     - Total users online
     - Active rooms count
     - Room breakdown by universe/world/room
     - Top active rooms sorted by user count

### Room Discovery

- Polls `/rooms` endpoint every 30 seconds (configurable)
- Tracks discovered rooms
- Automatically subscribes to newly discovered rooms
- Updates WebSocket JWT token when new rooms are found

## Discord Channel Setup

### Event Channel

This channel receives real-time notifications:
- ✅ User Connected (green embed)
- ❌ User Disconnected (red embed)

Each message includes:
- User name
- Room (formatted as universe/world/room)
- User UUID

### Stats Channel

This channel is automatically managed by the bot:
- All messages are deleted before sending new report
- Updated every 10 minutes with current activity
- Shows room breakdown and user counts

## Troubleshooting

### Bot not sending messages

- Check that `DISCORD_BOT_TOKEN` is correct
- Verify bot has necessary permissions in Discord server
- Check channel IDs are correct

### WebSocket connection fails

- Verify `ADMIN_SOCKETS_TOKEN` is set correctly
- Check that WorkAdventure play service is accessible
- Ensure `PUSHER_URL` is correct

### No rooms discovered

- Check `ADMIN_API_TOKEN` is correct
- Verify `/rooms` endpoint is accessible
- Check WorkAdventure play service is running

### Stats channel not updating

- Check `DISCORD_STATS_CHANNEL_ID` is correct
- Verify bot has "Manage Messages" permission
- Check logs for error messages

## Development

### Project Structure

```
discord-bot/
├── src/
│   ├── index.ts              # Main service entry point
│   ├── discord/
│   │   ├── bot.ts            # Discord bot client
│   │   └── channels.ts       # Channel management utilities
│   ├── workadventure/
│   │   ├── websocket.ts      # WebSocket connection manager
│   │   └── roomDiscovery.ts  # Room discovery via /rooms endpoint
│   └── types.ts              # TypeScript type definitions
├── package.json
├── tsconfig.json
├── Dockerfile
└── README.md
```

### Building

```bash
npm run build
```

### Testing

The service logs all important events to the console. Monitor logs to verify:
- WebSocket connection status
- Room discovery
- Discord message sending
- Stats channel updates

## License

Part of the WorkAdventure project.

