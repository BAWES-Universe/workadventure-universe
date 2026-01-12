# Interactive Bot Map Editor

A world-class interactive map-based bot management system with real-time visualization of bot positions, radius overlays, patrol waypoints, and drag-and-drop placement.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Sidebar UI Layer                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ BotEditor   │  │  BotList    │  │    BotDetailView        │  │
│  │  .svelte    │  │  .svelte    │  │      .svelte            │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Svelte Stores                                │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │botEditorModeStore│  │selectedBotStore  │  │botPreviewsStore│  │
│  └────────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │
└───────────┼────────────────────┼────────────────────┼───────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Phaser Game Layer                             │
│  ┌─────────────────┐                                            │
│  │  BotEditorTool  │ ◄─── Extends MapEditorTool                 │
│  └────────┬────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   BotPreview    │──│  RadiusOverlay  │  │  WaypointPath   │  │
│  │   (Woka + UI)   │  │  (Circle)       │  │  (Patrol route) │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. BotPreview (`phaser/BotPreview.ts`)

A Phaser game object that renders each bot on the map:

**Visual Elements:**
- Woka sprite at the bot's `assignedSpace.center` position
- Circular radius overlay showing `assignedSpace.radius`
- Behavior-specific color coding:
  - **Idle**: Blue tint (stationary indicator)
  - **Patrol**: Green tint with animated pulse
  - **Social**: Purple tint with conversation radius ring
- Selection highlight with glow effect
- Resize handles when selected

**Interactions:**
- Click to select
- Drag to reposition
- Hover for tooltip with bot name

### 2. RadiusOverlay (`phaser/RadiusOverlay.ts`)

Interactive circular overlay component:

**Visual Elements:**
- Filled circle with behavior-specific color (30% opacity)
- Dashed stroke outline for clarity
- 8 resize handles around the perimeter when selected
- Radius value label during resize

**Interactions:**
- Drag handles to resize radius
- Hold Shift to snap to grid (32px increments)
- Real-time sync with sidebar inputs

### 3. WaypointPath (`phaser/WaypointPath.ts`)

Patrol route visualization system:

**Visual Elements:**
- Connected line segments showing patrol route
- Numbered waypoint markers (circles with index)
- Directional arrows on path segments
- Ghost Woka animation preview

**Interactions:**
- Click waypoint to select
- Drag waypoint to reposition
- Click on path segment to insert new waypoint
- Right-click waypoint to delete
- Double-click to add waypoint at end

### 4. BotEditorTool (`phaser/BotEditorTool.ts`)

Map editor tool extending the existing `MapEditorTool` pattern:

```typescript
class BotEditorTool extends MapEditorTool {
    // Manages all bot previews on the map
    private botPreviews: Map<string, BotPreview>;
    
    // Currently selected bot
    private selectedBot: BotPreview | undefined;
    
    // Current interaction mode
    private mode: "select" | "place" | "waypoint";
    
    // Key methods:
    // - activate(): Show all bot previews
    // - deactivate(): Hide previews, clear selection
    // - handlePointerDown(): Select or place bot
    // - handlePointerMove(): Drag preview
    // - handlePointerUp(): Confirm placement
}
```

### 5. BotEditorStore (`stores/BotEditorStore.ts`)

Svelte stores for UI-Phaser coordination:

```typescript
// Editor mode state
export type BotEditorMode = "list" | "detail" | "placing" | "waypoint-edit";
export const botEditorModeStore = writable<BotEditorMode>("list");

// Selected bot for editing
export const selectedBotPreviewStore = writable<BotData | undefined>();

// All bots on the current map
export const botPreviewsStore = writable<Map<string, BotData>>(new Map());

// Waypoint being edited (index) for patrol bots
export const editingWaypointIndexStore = writable<number | undefined>();

// Placement cursor position (for new bot placement)
export const placementCursorStore = writable<{x: number, y: number} | undefined>();
```

## User Experience Flows

### Creating a New Bot

```
1. User clicks "Create Bot" in sidebar
   └─► Modal appears for name + texture selection

2. User submits modal
   └─► Sidebar shows "Click on map to place bot"
   └─► Cursor changes to crosshair
   └─► Ghost preview follows cursor

3. User clicks on map
   └─► Bot appears at click position
   └─► Default radius circle shown
   └─► Bot is auto-selected

4. User adjusts radius by dragging handles
   └─► Circle resizes in real-time
   └─► Sidebar radius input updates

5. User clicks "Save" or clicks elsewhere
   └─► Bot is saved
   └─► Returns to list view
```

### Editing Existing Bot

```
1. User clicks bot on map OR selects from list
   └─► Bot shows selection highlight
   └─► Radius overlay appears with handles
   └─► Sidebar shows detail view

2. User drags bot to new position
   └─► Bot follows cursor
   └─► Position inputs update in sidebar

3. User drags radius handle
   └─► Circle resizes
   └─► Radius input updates

4. User modifies sidebar fields
   └─► Map visualization updates in real-time
```

### Setting Patrol Waypoints

```
1. User selects patrol bot
   └─► Bot selected with radius overlay

2. User clicks "Edit Waypoints" button
   └─► Mode changes to "waypoint-edit"
   └─► Existing waypoints shown as numbered circles
   └─► Path lines connect waypoints

3. User clicks on map
   └─► New waypoint added at position
   └─► Path updates to include new point

4. User drags waypoint
   └─► Waypoint follows cursor
   └─► Path redraws in real-time

5. User right-clicks waypoint
   └─► Waypoint deleted
   └─► Path redraws

6. User clicks "Done Editing"
   └─► Returns to normal selection mode
   └─► Waypoints saved
```

## Visual Design

### Color Scheme by Behavior

| Behavior | Fill Color | Stroke Color | Opacity |
|----------|------------|--------------|---------|
| Idle     | `#3B82F6` (Blue) | `#1D4ED8` | 30% |
| Patrol   | `#22C55E` (Green) | `#15803D` | 30% |
| Social   | `#A855F7` (Purple) | `#7C3AED` | 30% |

### Selection States

| State | Visual Effect |
|-------|---------------|
| Normal | Base opacity, no outline |
| Hovered | +20% opacity, thin highlight |
| Selected | Full opacity, glow, handles visible |
| Dragging | Slight transparency, drop shadow |

### Waypoint Markers

- Circle with white fill and colored stroke
- Number centered in circle (1, 2, 3...)
- Size: 24px diameter
- Selected waypoint: Larger (32px), pulsing animation

## File Structure

```
play/src/front/external-modules/bots/
├── index.ts                    # Extension entry point
├── BotEditor.svelte            # Main editor component
├── types.ts                    # Type definitions
│
├── stores/
│   └── BotEditorStore.ts       # NEW: Editor state stores
│
├── components/
│   ├── BotList.svelte          # UPDATE: Map integration
│   ├── BotCard.svelte          # UPDATE: Hover highlights
│   ├── BotDetailView.svelte    # UPDATE: Placement mode
│   ├── BotBehaviorEditor.svelte
│   ├── BotInstructionsEditor.svelte
│   ├── BotTexturePicker.svelte
│   └── CreateBotModal.svelte
│
└── phaser/
    ├── BotEditorTool.ts        # NEW: Map editor tool
    ├── BotPreview.ts           # NEW: Bot visualization
    ├── RadiusOverlay.ts        # NEW: Radius circle
    └── WaypointPath.ts         # NEW: Patrol route
```

## Implementation Phases

### Phase 1: Core Visualization [COMPLETED]
- [x] Create `BotEditorStore.ts` with mode and selection stores
- [x] Create `BotPreview.ts` with Woka sprite rendering
- [x] Create `RadiusOverlay.ts` with static circle display
- [x] Update `index.ts` to show previews when tool active

### Phase 2: Interactivity [COMPLETED]
- [x] Add drag-and-drop for bot positioning
- [x] Add radius resize handles with drag interaction
- [x] Sync position/radius changes to sidebar stores
- [x] Add selection highlighting and hover effects

### Phase 3: Waypoint System [COMPLETED]
- [x] Create `WaypointPath.ts` for patrol visualization
- [x] Add waypoint editing mode toggle
- [x] Implement add/move/delete waypoint interactions
- [x] Add path preview with directional arrows

### Phase 4: Polish and UX [COMPLETED]
- [x] Add behavior-specific color coding
- [x] Add "Locate Bot" button to pan camera
- [x] Add keyboard shortcuts (Delete, Escape, etc.)
- [ ] Add undo/redo support via command pattern (future enhancement)
- [ ] Add mini-map overview widget (future enhancement)

## Technical Notes

### Integration with Existing Systems

The bot editor integrates with WorkAdventure's existing map editor:

1. **Tool Registration**: `BotEditorTool` follows the same pattern as `EntityEditorTool` and `AreaEditorTool`

2. **Store Pattern**: Uses Svelte stores for reactive UI updates, same as `mapEditorSelectedEntityStore`

3. **Command Pattern**: Bot modifications can use the existing undo/redo system via `FrontCommand`

4. **Graphics**: Uses Phaser's Graphics API for circles/lines, same as `AreaPreview`

### Performance Considerations

- Bot previews are only rendered when the bot editor tool is active
- Radius overlays use simple circle graphics (not textures)
- Waypoint paths use line graphics updated only on change
- Large maps: Consider spatial partitioning for many bots

### Accessibility

- All interactive elements have keyboard alternatives
- Color coding is supplemented with icons/shapes
- Screen reader support for sidebar controls

