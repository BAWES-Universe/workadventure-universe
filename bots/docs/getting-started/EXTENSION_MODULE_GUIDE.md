# Extension Module Guide

## Overview

The bot system is built as an **independent extension** using WorkAdventure's ExtensionModule system. This allows you to add bot functionality without modifying any upstream WorkAdventure code.

## How Extension Modules Work

WorkAdventure automatically loads extension modules from:
```
play/src/front/external-modules/{module-name}/index.ts
```

When a module is registered in the room metadata (via Admin API):
```json
{
  "metadata": {
    "modules": ["bots"]
  }
}
```

## Architecture

```
┌─────────────────────────────────────────┐
│  WorkAdventure (Upstream - Unchanged)   │
│  ┌───────────────────────────────────┐  │
│  │ Extension Module System            │  │
│  │  Loads: external-modules/bots/    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
              │
              │ (Extension Module)
              ▼
┌─────────────────────────────────────────┐
│  Bot Extension (Your Code)              │
│  ┌───────────────────────────────────┐  │
│  │ play/src/front/external-modules/  │  │
│  │   bots/                           │  │
│  │  - index.ts (Extension Module)    │  │
│  │  - BotEditor.svelte (UI)          │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
              │
              │ (REST API)
              ▼
┌─────────────────────────────────────────┐
│  Bot Server (Standalone Service)        │
│  ┌───────────────────────────────────┐  │
│  │ bots/server/                      │  │
│  │  - BotManager.ts                  │  │
│  │  - BotRegistry.ts                 │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Setup

### 1. Create Extension Module Structure

The extension module should be placed directly in WorkAdventure's external-modules directory:

```
play/src/front/external-modules/bots/
├── index.ts                    # Extension module entry point
├── BotEditorButton.svelte      # Button to open editor
├── BotEditorModal.svelte       # Main editor modal
└── components/
    ├── BotPropertiesEditor.svelte
    ├── BotBehaviorEditor.svelte
    └── BotAIConfigEditor.svelte
```

**Note**: The extension module lives in WorkAdventure's directory structure, but all other bot code (server, client, behaviors) remains in the `bots/` directory as standalone components.

### 2. Directory Structure

```
workadventure-universe/
├── bots/                      # Independent bot system
│   ├── server/                # Bot server (standalone)
│   ├── client/                # Bot clients (standalone)
│   ├── behaviors/             # Behaviors (standalone)
│   └── docs/                  # Documentation
└── play/src/front/external-modules/bots/  # Extension module (in WorkAdventure)
    ├── index.ts
    ├── BotEditorButton.svelte
    └── components/
        └── ...
```

This approach:
- ✅ No symlinks or copy scripts needed
- ✅ Works directly with WorkAdventure's module loader
- ✅ Only UI extension code in WorkAdventure's structure
- ✅ All server/client code stays independent in `bots/`

### 3. Register Module in Admin API

Your Admin API's `/api/room/access` endpoint should return:

```json
{
  "metadata": {
    "modules": ["bots"]
  }
}
```

WorkAdventure will automatically load the module from `play/src/front/external-modules/bots/index.ts`.

## Extension Module Implementation

### Basic Structure

```typescript
// play/src/front/external-modules/bots/index.ts
import type { ExtensionModule, ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import BotEditorButton from "./BotEditorButton.svelte";

const botExtensionModule: ExtensionModule = {
    id: "workadventure-bots",
    calendarSynchronised: false,
    todoListSynchronized: false,

    init(roomMetadata: unknown, options: ExtensionModuleOptions) {
        // Initialize extension
        // Inject UI components
    },

    destroy() {
        // Cleanup
        // Remove UI components
    }
};

export default botExtensionModule;
```

### Injecting UI Components

```typescript
// Add button to action bar
options.externalSvelteComponent.addComponentToZone(
    "actionBarAppsMenu",
    "bot-editor-btn",
    BotEditorButton,
    {
        onOpenEditor: () => {
            // Open editor
        }
    }
);
```

### Available Zones

- `actionBarAppsMenu` - Apps menu in action bar
- `mapEditorSidebar` - Map editor sidebar (if available)
- Other zones as defined by WorkAdventure

## Development Workflow

### 1. Development

```bash
# Work directly in WorkAdventure's external-modules directory
cd play/src/front/external-modules/bots

# Make changes to extension module...

# Test in WorkAdventure
cd ../../../../..
npm run dev
```

**Note**: The extension module code lives directly in WorkAdventure's directory structure. All other bot code (server, client, behaviors) remains in the `bots/` directory as standalone components.

### 2. Testing

1. Start WorkAdventure
2. Ensure module is registered in Admin API (`modules: ["bots"]`)
3. Load a room with bot module enabled
4. Check browser console for initialization
5. Test UI components

### 3. Production

```bash
# Build WorkAdventure (extension module included automatically)
cd play
npm run build
```

The extension module is part of WorkAdventure's build process, so no separate build step is needed.

## Integration Points

### 1. Extension Module Options

The `ExtensionModuleOptions` interface provides:

- `externalSvelteComponent` - Inject UI components
- `userAccessToken` - User authentication token
- `roomId` - Current room URL
- `adminUrl` - Admin API URL (if configured)
- `openCoWebSite` - Open iframe/modal
- And more...

### 2. Bot Server Communication

The extension module communicates with the bot server via:

- REST API calls
- WebSocket (if needed)
- Admin API (for configuration)

### 3. Data Storage

- **Public Data**: Stored in WAM files (via map-storage)
- **Sensitive Data**: Stored in Admin API
- **Runtime State**: Managed by bot server

## Best Practices

1. **Keep Server Code Independent**: Bot server, client, and behaviors stay in `bots/` directory
2. **Extension Module in WorkAdventure**: Only the UI extension module lives in WorkAdventure's structure
3. **Use ExtensionModule System**: Leverage provided APIs, don't modify WorkAdventure core
4. **Handle Errors Gracefully**: Extension failures shouldn't break WorkAdventure
5. **Clean Up**: Always remove components in `destroy()`
6. **Test Thoroughly**: Test with and without module enabled

## Troubleshooting

### Module Not Loading

- Check Admin API returns `modules: ["bots"]`
- Verify file exists at `play/src/front/external-modules/bots/index.ts`
- Check browser console for errors

### UI Not Appearing

- Verify component is added to correct zone
- Check component props are correct
- Ensure user is authenticated (if required)

### Extension Errors

- Check browser console
- Verify all imports are correct
- Ensure WorkAdventure version compatibility

## Next Steps

1. Create extension module structure
2. Implement basic extension module
3. Add UI components
4. Integrate with bot server
5. Test and iterate

See [Implementation Plan](./IMPLEMENTATION_PLAN.md) for detailed steps.

