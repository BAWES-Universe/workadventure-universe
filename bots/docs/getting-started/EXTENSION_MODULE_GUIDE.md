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
│  │ bots/editor/extension/            │  │
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

```
bots/editor/extension/
├── index.ts                    # Extension module entry point
├── BotEditorButton.svelte      # Button to open editor
├── BotEditorModal.svelte       # Main editor modal
└── components/
    ├── BotPropertiesEditor.svelte
    ├── BotBehaviorEditor.svelte
    └── BotAIConfigEditor.svelte
```

### 2. Link to WorkAdventure

**Option A: Symlink (Development)**
```bash
ln -s ../../bots/editor/extension play/src/front/external-modules/bots
```

**Option B: Copy Script (Production)**
```bash
# Create copy script
cp -r bots/editor/extension play/src/front/external-modules/bots
```

**Option C: Build Script**
```json
// bots/package.json
{
  "scripts": {
    "link-extension": "ln -sf ../../bots/editor/extension ../play/src/front/external-modules/bots",
    "copy-extension": "cp -r editor/extension ../play/src/front/external-modules/bots"
  }
}
```

### 3. Register Module in Admin API

Your Admin API's `/api/room/access` endpoint should return:

```json
{
  "metadata": {
    "modules": ["bots"]
  }
}
```

## Extension Module Implementation

### Basic Structure

```typescript
// bots/editor/extension/index.ts
import type { ExtensionModule, ExtensionModuleOptions } from "../../../play/src/front/ExternalModule/ExtensionModule";
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
# Work in bots/editor/extension/
cd bots/editor/extension
# Make changes...

# Link to WorkAdventure
npm run link-extension

# Test in WorkAdventure
cd ../../play
npm run dev
```

### 2. Testing

1. Start WorkAdventure
2. Ensure module is registered in Admin API
3. Load a room with bot module enabled
4. Check browser console for initialization
5. Test UI components

### 3. Production

```bash
# Copy extension to WorkAdventure
npm run copy-extension

# Build WorkAdventure
cd play
npm run build
```

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

1. **Keep It Independent**: Don't modify WorkAdventure code
2. **Use ExtensionModule System**: Leverage provided APIs
3. **Handle Errors Gracefully**: Extension failures shouldn't break WorkAdventure
4. **Clean Up**: Always remove components in `destroy()`
5. **Test Thoroughly**: Test with and without module enabled

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

