# MCP Servers for Bots

WorkAdventure bots can call external tools via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) over Streamable HTTP transport. This lets a bot's AI query databases, create tickets, fetch live data — anything your own MCP server exposes as a tool.

## How it works

- A bot has a list of configured MCP servers (zero or more).
- On startup and every hour after, the bot sends a `tools/list` request to each server and caches the discovered tool definitions.
- When the AI chooses to call one of those tools during a conversation, the bot sends a `tools/call` request to the correct server and feeds the result back to the AI.
- Each player talking to the bot gets their own initialized MCP session, so your server can distinguish between users.

## Registering an MCP server

Open your bot's settings in the in-game bot editor (the Svelte UI). Under **MCP Servers**, you can add, edit, test, and remove servers.

Each server needs:

| Field | Description |
|-------|-------------|
| **Name** | A label for your server (e.g. "Knowledge Base"). |
| **Server URL** | Full URL of your MCP-over-HTTP endpoint (e.g. `https://mcp.example.com/mcp`). |
| **Auth type** | `None`, `Bearer Token`, or `API Key`. |
| **Auth config** | The token or key value (stored encrypted). |
| **Headers** | Optional custom headers sent with every request. |

After saving, click **Test Connection** to verify the server responds to `tools/list` and confirm which tools it exposes.

## Transport contract

The bot communicates with your server via [MCP Streamable HTTP](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/streamable-http/).

### Initialize

Before any method call, the bot sends a standard MCP `initialize` request:

```json
{
  "jsonrpc": "2.0",
  "id": "init",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "workadventure-mcp-bot",
      "version": "1.0.0",
      "player_id": "<player-uuid>"  // null on initial tool discovery
    }
  }
}
```

**`player_id`** — stable UUID identifying the player the bot is talking to. Your server can use this to key per-player conversation state, user context, or rate limits. Servers that don't need it can ignore it.

During initial tool discovery (before any player conversation), the bot sends `player_id: null`. Your `initialize` handler should accept `null` — it means "this is a discovery check, not a player session."

If your server returns an `Mcp-Session-Id` header in the initialize response, the bot includes it in all subsequent requests via the `Mcp-Session-Id` header — allowing your server to maintain session state across multiple tool calls.

### tools/list

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/list"
}
```

Expected response:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "tools": [
      {
        "name": "my_tool",
        "description": "What this tool does",
        "inputSchema": {
          "type": "object",
          "properties": {
            "arg1": { "type": "string" }
          }
        }
      }
    ]
  }
}
```

### tools/call

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/call",
  "params": {
    "name": "my_tool",
    "arguments": {
      "arg1": "value"
    }
  }
}
```

Expected response follows the MCP specification's content block format.

### Auth headers

Depending on the server configuration, the bot sends either:

- `Authorization: Bearer <token>` for bearer auth
- `X-API-Key: <key>` for API key auth
- Custom headers if configured in the editor

### Timeout

All requests have a 10-second timeout. If your server takes longer, the call is discarded and the AI receives an error result.

## Session lifecycle

Each player gets their own cached MCP session (keyed by server URL, auth config, and `player_id`). Sessions expire after 1 hour of inactivity, meaning each player triggers one `initialize` round-trip (50–200ms) before their first tool call, then reuses that session for subsequent calls within the hour.

The tool list returned by `tools/list` is cached for 1 hour across all players. Tool changes on your server may take up to 1 hour to propagate unless the bot is restarted.

## Testing your server

Use the **Test Connection** button in the bot editor. It sends a `tools/list` request and displays confirmed connectivity and which tools it found. No need to open a map or talk to the bot.

## Example

A minimal MCP server exposing a single tool (`my_query`) using Node.js:

```typescript
import express from 'express';

const app = express();
app.use(express.json());

app.post('/mcp', (req, res) => {
  const { method, params } = req.body;

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id: req.body.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'example-mcp', version: '1.0.0' },
      },
    });
  }

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id: req.body.id,
      result: {
        tools: [
          {
            name: 'my_query',
            description: 'Query knowledge about a topic',
            inputSchema: {
              type: 'object',
              properties: {
                topic: { type: 'string' },
              },
            },
          },
        ],
      },
    });
  }

  if (method === 'tools/call') {
    const result = `You asked about: ${params.arguments.topic}`;
    return res.json({
      jsonrpc: '2.0',
      id: req.body.id,
      result: {
        content: [{ type: 'text', text: result }],
      },
    });
  }

  res.status(400).json({
    jsonrpc: '2.0',
    id: req.body.id,
    error: { message: 'Unknown method' },
  });
});

app.listen(3000);
```

Deploy this behind a public URL, register it in your bot's MCP Servers settings, and the bot can now call `my_query` through natural conversation.
