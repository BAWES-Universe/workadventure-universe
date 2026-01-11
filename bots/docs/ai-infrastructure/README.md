# AI Infrastructure Documentation

This folder contains documentation for the AI provider infrastructure, including architecture, implementation plans, and requirements for both the bot server and Admin API.

## Documents

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Overall architecture and design decisions
- **[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)** - Step-by-step implementation guide
- **[ADMIN_API_REQUIREMENTS.md](./ADMIN_API_REQUIREMENTS.md)** - Admin API endpoints and data structures needed
- **[BOT_SERVER_REQUIREMENTS.md](./BOT_SERVER_REQUIREMENTS.md)** - Bot server implementation requirements
- **[STREAMING.md](./STREAMING.md)** - Streaming implementation details
- **[SECURITY.md](./SECURITY.md)** - Security considerations and best practices
- **[PROVIDERS.md](./PROVIDERS.md)** - AI provider implementations (LMStudio, OpenAI, etc.)

## Current Status

🚧 **Planning Phase** - We're brainstorming and refining the architecture before implementation.

## Key Decisions

1. **Mode**: Direct mode (bot server makes AI calls) with credential delegation from Admin API
2. **Streaming**: Full streaming support for better UX and thinking models
3. **Security**: Credentials stored in Admin API, fetched by bot server with service token
4. **Scalability**: Designed to handle thousands of concurrent bot conversations

## Next Steps

1. Review and refine architecture
2. Define Admin API endpoints
3. Plan bot server implementation
4. Design streaming protocol
5. Create provider implementations

