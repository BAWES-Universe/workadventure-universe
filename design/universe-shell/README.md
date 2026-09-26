> **Superseded.** The plan of record is now the living doc [Universe Shell: next-gen layout plan](https://claude.ai/code/artifact/c019fa8a-666d-41b5-ac6b-35663575bc43) (v0.1, with round-1 review consensus). This file is the v0 draft the reviews in `reviews/` were written against; it is kept unchanged so their line references still make sense.

# Universe Shell: next-gen layout concepts

**Status:** v0 draft for cross-model review (Claude, GPT, Hermes, Codex). Nothing here is decided until the Decisions table says so.
**Companion:** `mockup.html` in this folder is an interactive mockup of every layout described below, today's and proposed. Open it locally or through the shared artifact link.
**Scope:** the game front end in `play/src/front/`. Orbit (`workadventure-universe-admin`) is touched only where the Quests & Orbit epic (#508) already plans to.

## 1. The question

Chat and Express (#436) made the chat panel noticeably better, and it is still a panel: a web app with a sidebar. The bar we want to clear is "an operating system in the browser": chats, cameras, shared documents and Orbit are windows you can dock left or right, shrink to a strip, pop out onto a second monitor, or stack as sheets on a phone, and the map stays alive underneath all of it. Discord is the reference people will compare us to, and Discord is a fixed three-column app whose only pop-out is a stream.

The constraint is the one every Universe epic carries: nothing that works today may stop working, including the scripting API map builders rely on, extension modules, zone properties, hotkeys, guests, multiple tabs of the same account, RTL and all locales.

## 2. What the code does today

This is from a scan of the current `universe` branch. File references are exact so reviewers can check them.

- **There is no layout system.** `Components/MainLayout.svelte` is a stack of absolutely and fixed-positioned layers. The only true split is map versus co-website in `Components/App.svelte:252` (landscape: right; portrait: on top), which resizes the Phaser canvas through `CoWebsiteStore.ts:83` and `WaScaleManager.applyNewSize()`.
- **Chat is an overlay, not a column.** `Chat/ChatSidebar.svelte:109` is `position:absolute; z-index:2000` with a drag bar (200px to half the viewport). The map is not resized; `MainLayout.svelte:106` pads everything else by the chat width, so cameras and cards squeeze into what is left. Under 768px the panel is forced to 100% width (`ChatSidebar.svelte:143`, `style/chat.scss:25`).
- **Cameras have one layout.** `EmbedScreens/Layouts/PresentationLayout.svelte`: a strip over the top of the map, then a pinned person below. `VideoLayoutStore.ts:53` switches between one line and a grid from movement, conversation, pin and picture-in-picture. `LayoutMode.VideoChat`, `embedScreenLayoutStore`, `ChangeLayoutMenuItem.svelte` and the two `layout-*.svg` images are dead scaffolding.
- **The Phaser camera avoids UI by scanning the DOM.** `Stores/BiggestAvailableAreaStore.ts:139` reads every `.screen-blocker` rectangle (chat, action bar, video boxes) and centres the camera in the biggest free box. `GameScene.reposition()` must be called by hand after any change.
- **Orbit is a script modal.** `external-modules/admin-api/index.ts:102` opens it through `modalIframeStore` with `position:"right"`: 33% width, backdrop, Esc closes (`Components/Modal/Modal.svelte:128`). On phones, 80% width up to 400px, with an unusable sliver of map behind the backdrop.
- **Twenty hard-coded z-indexes and no registry.** From 10 (MainLayout) through 301 (action bar), 2000 (chat, modal, map editor), 3000 (floating UI) to 999999999 (refresh prompt).
- **Three phone definitions coexist.** The Tailwind `mobile` variant (small and coarse pointer), `windowSize.width < 768`, and `isMediaBreakpointUp("md")`, which means "at or below 991" despite its name.
- **The scripting API already promises more than the UI delivers.** `WA.nav.openCoWebSite` accepts `position` and `lazy` and drops both (`Chat/Utils.ts:20`). `WA.ui.website.open` is the one free-positioning primitive (3×3 grid, size, margin). `WA.ui.modal` accepts left, right and center.
- **Persistence is partial.** `chatSideBarWidth` and `cameraContainerHeight` are saved in `LocalUserStore`; the co-website ratio, chat open state, tab, pin and any layout mode are not.
- **One piece of the code already reasons about layout.** `Chat/Stores/PeopleCardReturn.ts` asks "does the chat panel leave room for the map" (`sidebarCoversMap`) and closes chat so a card can open. It is a pure state machine with tests, and the pattern (pure module, thin Svelte component, vitest) is the one the shell should copy.

## 3. Design of record (proposed)

1. **Surfaces, not components.** Everything that takes screen space registers with one shell as a surface: id, kind, preferred and minimum size, and the moves it allows (dock, float, pop out, full, sheet). Today's surfaces: chat, cameras, co-websites (one per co-website, sharing a tab strip), Orbit, person card and visit card, script modals, map editor, menu.
2. **The map is a surface too.** It can be the whole window, a cell in a grid, or a peek window in a corner, and it always stays live: proximity, bubbles and movement keep working while it is small.
3. **Geometry, not DOM moves.** A surface keeps one DOM node for its whole life; the shell changes where that node is drawn. Moving an `<iframe>` between parents reloads it, which would break Jitsi, BBB, docs and Orbit. Docks are computed rectangles, not containers surfaces are re-parented into.
4. **One free rectangle.** The shell publishes the map's free rectangle as a store. The Phaser camera reads it instead of scanning `.screen-blocker`. The class stays as a fallback for script-added UI websites until they are surfaces too.
5. **One layer registry.** `map < docks < floating < sheets < modal < system < toast`. Every component asks the registry for its layer instead of carrying a number.
6. **Phones get sheets and strips.** Bottom sheets with snap points (peek 30%, tall 80%, full), a video strip that can sit at the top, above the thumb bar, or collapse into bubbles, and a map peek that stays live.
7. **Desktop gets docks and windows.** Left, right, top and bottom docks; floating windows; pop-outs into real OS windows through the Document Picture-in-Picture API the camera code already uses; a dock bar for minimised surfaces.
8. **Presets first, freedom second.** Named layouts cover most people. Dragging a surface elsewhere is for the rest, and is remembered per device class.
9. **Every hook keeps working.** Scripting calls, zone properties, extension module calls, hotkeys and `data-testid`s map onto shell intents. The shell adds a layout API; it replaces nothing.
10. **Quiet by default, same as Quests.** The shell never relayouts on its own while someone is typing, in a call or editing. Automatic changes (a screen share arriving, a bubble forming) apply the preset's rule and nothing more.
11. **Nothing is removed.** Every surface, action and setting that exists today has a home in the shell. A pull request that removes a row from the compatibility table in section 8 is rejected.

## 4. The model

```
DeviceClass   = phone | tablet | desktop            (one decision, one store; replaces the three phone tests)
Region        = left | right | top | bottom | center | float | popout | full | sheet | hidden
SurfaceKind   = chat | cameras | cowebsite | orbit | card | modal | mapEditor | menu | map
Surface       = { id, kind, title, min: {w,h}, preferred: {w,h}, allows: Region[], state: open | minimised | closed }
Placement     = { surfaceId, region, size?, position?, snap?: peek | tall | full, order }
Layout        = { deviceClass, placements: Placement[], mapRegion: Region }
Preset        = { id, name, layouts: Record<DeviceClass, Layout>, rules: Rule[] }
Rule          = onScreenShare | onBubbleJoin | onBubbleLeave | onKeyboard | onCall  → Placement changes
ShellState    = { deviceClass, preset, layout (preset + user overrides), freeRect, focus: surfaceId | map }
```

The engine is pure: `resolveLayout(shellState, viewport) → { rects: Record<surfaceId, Rect>, mapRect, freeRect, layers }`. It lives beside `ChatLayout.ts` and is unit-tested the same way. Svelte components subscribe to their own rectangle and draw themselves there with `position: fixed` and `inset`. No component decides where it goes.

**Docks** are ordered lists of placements on one edge. A dock's size is the largest preferred size of its surfaces, clamped to the viewport; users drag the dock edge, and the value is saved per device class (today's `chatSideBarWidth` becomes the left dock width).

**Floating** placements have a position, a size and an order; the last focused one is on top. They are clamped to the viewport on resize.

**Pop-outs** move the surface's DOM into a Document Picture-in-Picture window (Chromium, Edge, Opera today). The window shares the page's JavaScript, so the popped-out chat uses the same Matrix client and the same stores; there is no second login and nothing to sync. Where the API is missing (Firefox, Safari), the surface floats inside the page and the "pop out" button says so. An iframe surface (co-website, Orbit) reloads when popped out; Orbit restores its page through the bridge from Quests 1B, co-websites simply reload.

**Sheets** are the phone shape of a dock: one surface, bottom edge, snap points. Only one sheet is open at a time, except a small card sheet on top of the chat sheet.

**Minimised** surfaces stay mounted and hidden; the dock bar shows a chip with the surface's badge (unread count, "Sara is talking", "2 in the call"). Closing a surface unmounts it, as today.

**Focus** is one surface or the map. Keyboard shortcuts go to the focused surface; hotkeys that walk the avatar work only when the map is focused, which is today's `inputFormFocusStore` rule generalised.

## 5. Desktop

- **Default preset "Hangout":** chat docked left (today's edge, so nothing moves for existing users), cameras as a top strip that expands to a grid when you stand still, map center. Identical to today except that the map is resized instead of covered.
- **Docks:** drag a surface's title bar to any edge to dock it there; the dock highlights. Two surfaces in one dock split it. Drag the dock edge to resize; double-click to reset.
- **Floating windows:** drag a surface off a dock to float it. Windows have a title bar with minimise, dock-back, pop-out and close.
- **Pop-outs:** the title bar's pop-out button moves the surface to an OS window. Chat threads, the People tab, cameras and Orbit are the first candidates. A popped-out surface's chip stays in the dock bar so you can pull it back.
- **Dock bar:** a slim bar at the bottom center listing minimised and popped-out surfaces with live badges. Hidden when it is empty, so the idle map looks as it does now.
- **Command palette:** Ctrl/Cmd+K lists surfaces, presets, people ("walk to Sara"), rooms and Orbit pages. It reuses the People search and the Orbit bridge; it is the keyboard's dock bar.
- **Map peek:** when a surface takes the center (a document, a meeting grid), the map shrinks to a live peek window in a corner. Click it to swap back. The Phaser canvas is resized, not scaled, so the camera keeps following you.
- **Rules per preset:** a screen share arriving applies "Meeting" if the preset says so (today's forced `LayoutMode.Presentation` becomes a rule). A rule never fires while a text field has focus.

## 6. Phone

The example from the brief, "chat takes the bottom 80% and the videos the top 10%", is the phone "Hangout" preset:

```
┌──────────────┐
│ ▣ Sara ▣ Omar│  video strip · 10% · top dock
│ ~~ map ~~ ~~ │  map · 10% · live, tap to drop the sheet
├──────────────┤
│ ═══  handle  │
│ Chats People │  chat sheet · tall · 80%
│ Sara: walk…  │
│ You: on my…  │
│ [Message…  ] │
└──────────────┘
```

- **Sheets:** chat, Orbit, co-websites and cards are bottom sheets. Snap points: peek (30%), tall (80%), full (100%). Drag the handle or swipe; tap the map peek to drop to peek. Full has a Back row; Back closes only the foremost surface (the Quests rule).
- **Video strip:** top (10%, above the map peek), above the thumb bar, bubbles (round faces top-right, stacked, with a talking ring; tap to expand), or full grid with the chat sheet at peek under it. Pin is a tap on a tile.
- **Thumb bar:** the action bar's phone shape, always at the bottom: chat, people, mic, camera, Orbit, menu, Express. It stays under peek and tall sheets and hides under full.
- **Keyboard:** the sheet moves up with the keyboard; the page never scrolls (`ViewportGuard` already holds it still). The video strip hides while typing if space runs out, and comes back on blur.
- **Landscape phones and tablets:** sheets become a right dock at 50% width; the strip becomes a left rail. This is the "tablet" device class.
- **Map peek is live.** Proximity, bubbles and Say bubbles keep working in the 10% strip; a newcomer walking up is visible without leaving the chat.

## 7. Presets

| Preset | Desktop | Phone | When |
| --- | --- | --- | --- |
| Hangout (default) | chat left, cameras top strip, map center | chat sheet tall, strip top, map peek | social spaces, today's behaviour |
| Meeting | cameras center grid, chat right, map peek | cameras full, chat peek | applied by rule on screen share, or by choice |
| Studio | co-website center, chat left, cameras right rail, map peek | co-website sheet 60%, cameras bubbles | docs, boards, Jitsi, BBB |
| Focus | everything minimised, map full, dock bar with badges | everything hidden, thumb bar badges | walking, building, events |
| Builder | Orbit left dock, chat and cameras floating, map center | Orbit sheet tall, map peek | owners setting up quests, rooms, bots |
| Classic | today's layout exactly, overlays included | today's layout exactly | the escape hatch during rollout |

Presets are chosen in the profile menu and by command palette. A room can suggest a preset through a new map property (`layoutPreset`), which a person can override; the override is remembered per room.

## 8. Compatibility map

Every hook that touches layout today, and what it does under the shell. Nothing in the left column changes its signature.

| Today | Under the shell |
| --- | --- |
| `WA.nav.openCoWebSite(url, allowApi, allowPolicy, widthPercent, position, closable, lazy)` | Opens a co-website surface. `position` is finally honoured: `right` (default, today's split), `left`, `bottom`, `float`, `full`. `widthPercent` sets the dock size. `lazy` defers mounting until the surface is shown. |
| `WA.nav.closeCoWebSite`, `getCoWebSites`, `CoWebsite.close()` | Unchanged. |
| Tiled `openWebsite*`, `jitsi*`, area properties, entities, BBB | Unchanged; they call the same opener. |
| Co-website tab strip, fullscreen toggle, drag bar | Inside the surface; fullscreen is region `full`. |
| `WA.ui.modal.openModal({position: left|right|center, allowFullScreen…})` | `center` stays a centred modal on the modal layer. `left`/`right` become a docked surface with a backdrop-free option: new optional `mode: "modal" | "window"` (default `modal`, today's look). |
| `WA.ui.website.open({position, size, margin})` | A floating surface positioned on the same 3×3 grid, relative to the map surface. Setters unchanged. |
| `WA.ui.banner`, `displayActionMessage`, `openPopup`, bottom popup stack | Unchanged; they live on the system and toast layers. |
| `WA.ui.actionBar.addButton`, `registerMenuCommand` | Unchanged; the action bar and thumb bar are the same store. |
| `WA.chat.open()`/`close()`, `openChat(source)`, `navChat.*`, `showComponentInChat` | Open the chat surface in its current placement; tabs unchanged. |
| `WA.controls.*` | Unchanged. |
| Zone "open chat", Matrix room areas, `chatBand`, external component zones | Unchanged. |
| Hotkeys C, U, Enter, Ctrl+Enter, 1–6, Esc | Unchanged. Esc closes the foremost surface. |
| `chatVisibilityStore`, `chatSidebarWidthStore`, `coWebsites`, `modalIframeStore`, `highlightedEmbedScreen`, `highlightFullScreen` | Kept as facades over shell state, so existing subscribers keep working while call sites migrate. |
| `.screen-blocker` and `BiggestAvailableAreaStore` | The store reads the shell's free rectangle first and falls back to the DOM scan for anything not yet a surface. |
| Picture-in-picture (`PictureInPicture.svelte`) | Becomes the cameras surface's `popout` region. |
| Person card, visit card, `PeopleCardReturn` | Card surface; the return rule becomes the shell's "restore the surface below". |
| `LocalUserStore` keys `chatSideBarWidth`, `cameraContainerHeight`, `allowPictureInPicture` | Read once as defaults for the migrated layout, then superseded by the layout preference. |
| Extension modules (`ExtensionModule.ts`) | Gain `shell.openSurface(...)`; existing calls keep working. |
| Multiple tabs (clones) | Placement and open state are per tab and in memory. Only presets, dock sizes and floating positions are shared through `localUserStore` and Orbit. |

**New scripting API (additive):**

```ts
WA.ui.layout.applyPreset(id: string): Promise<void>
WA.ui.layout.getPreset(): Promise<string>
WA.ui.layout.place(surfaceId: string, placement: { region, size?, snap? }): Promise<void>
WA.ui.layout.onChange(): Subscription<LayoutChangedEvent>
WA.ui.layout.registerSurface({ id, title, url, allows, preferred, min }): Promise<Surface>   // an iframe as a first-class window
```

The last call is the hackability win: a map builder can register their own window (a scoreboard, a whiteboard, a game) and it docks, floats and pops out like chat does.

## 9. Persistence and sync

- **Per device class**, in `localUserStore` under one key, `layout:v1:{deviceClass}`: preset id, dock sizes, floating positions, per-surface overrides. Existing `chatSideBarWidth` and `cameraContainerHeight` seed the first value.
- **Per room override** of the preset, keyed by room id, capped to the last 50 rooms.
- **Orbit sync** through the preference endpoint from Quests 1A, so a signed-in person gets their layout on another device. Guests keep it in the browser only.
- **Never persisted:** which surfaces are open, the active tab, pins, focus. Same rule as today and as the Chat and Express epic: per tab, in memory.

## 10. Code shape

```
play/src/front/Shell/
  ShellStore.ts           deviceClass, preset, layout, focus            (Svelte stores, facades for the old ones)
  LayoutEngine.ts         resolveLayout(), snap(), clamp(), dock math   (pure, vitest)
  LayerRegistry.ts        the seven layers as constants and a helper
  FreeRectStore.ts        derived: map rect minus docks and sheets      (feeds BiggestAvailableAreaStore)
  Presets.ts              the six presets and their rules
  Surfaces/               registerSurface(), one module per kind
  Components/
    Dock.svelte           draws a dock edge and its resize handle
    Sheet.svelte          phone sheet with snap points
    FloatingWindow.svelte title bar, drag, minimise, pop out
    DockBar.svelte        chips with badges
    Popout.ts             Document PiP helper, generalised from PictureInPicture.svelte
    CommandPalette.svelte
```

`MainLayout.svelte` keeps rendering everything it renders now. Migration is a strangler: each surface moves under the shell in its own pull request, and until it does, the shell reserves its rectangle from the DOM scan as today. The `Classic` preset renders exactly today's placements through the shell, which is how we test that the engine reproduces the current behaviour before changing it.

## 11. Phases

Each phase is its own feature branch and epic, same rules as #436 and #508: nothing merges into `universe-develop` until the owner has tested it on real devices, guests keep everything, two tabs of the same account are part of every manual check, `npm run typecheck`, `svelte-check`, `lint`, `pretty-check` and `npm test -- --run` pass in `play/`, e2e specs updated in the same pull request when a `data-testid` moves.

| Phase | What ships | Visible change | Size |
| --- | --- | --- | --- |
| 0. Foundation | `Shell/` with the engine, layer registry, device class store, free-rect store feeding `BiggestAvailableAreaStore`; `Classic` preset reproduces today; analytics for surface opens and sizes | none | S |
| 1. Phone sheets and strips | chat, Orbit, co-website and card as sheets with snap points; video strip top/bottom/bubbles; thumb bar; map peek | the brief's example, on phones | M |
| 2. Desktop docks | chat, cameras, co-website and Orbit as dockable surfaces; `openCoWebSite` honours `position`; map resized instead of covered; dock resize persisted | desktop feels like columns, not overlays | M–L |
| 3. Windows and presets | floating windows, dock bar with badges, minimise, six presets, preset switcher, room `layoutPreset` property | the OS feel | M |
| 4. Pop-outs and palette | Document PiP pop-outs for chat, people, cameras, Orbit; fallback floats; command palette | second-monitor chat, keyboard everything | M |
| 5. API and sync | `WA.ui.layout.*`, `registerSurface`, Orbit preference sync, extension module hook | hackability | M |

Phase 1 comes before desktop because phones are where today's layout hurts most (chat covers everything) and because sheets are a smaller surface area than docks. Phase 0 has no visible change on purpose: it is the proof that the engine reproduces the current layout.

## 12. Risks

- **Iframe reparenting reloads iframes.** Handled by principle 3 (geometry, not DOM moves). Pop-outs are the exception and reload by design; the button says so for iframe surfaces.
- **The Phaser camera contract.** `BiggestAvailableAreaStore` keeps its DOM scan as a fallback through every phase; the free-rect store only adds the surfaces the shell knows. Every phase's manual check includes "the camera keeps you in view beside every open surface", the rule PR #519 fixed.
- **Canvas resizes are not free.** Docking and sheets resize the Phaser canvas the way co-websites already do. Debounce during drags (draw the surface immediately, resize the canvas on release), and measure on a low-end Android.
- **Document Picture-in-Picture support.** Chromium only. Fallback is a floating window; nothing depends on the API.
- **WebRTC video elements.** They keep their `srcObject` when their node is moved to a PiP window (the camera code does this today). Inside the page they are never moved.
- **iOS keyboard and viewport.** Sheets must not fight `ViewportGuard`. Test at 320px and 200% font as the Quests epic requires.
- **RTL.** Docks are `inline-start`/`inline-end`, never left/right, so Arabic mirrors correctly. The mockup uses left/right for brevity only.
- **E2E tests.** `data-testid="chat"`, `closeChatButton`, `close-modal-button` and the co-website tab ids stay on the same elements.
- **Map builders' UI websites.** Positioned relative to the map surface rather than the viewport. A builder who positioned a website "bottom right" gets it bottom right of the map, which is what they meant.
- **Scope creep.** The dock bar, palette and presets are small individually and can each be cut without hurting the rest. Phases 1 and 2 are the product; the rest is polish that can wait.

## 13. Open questions for reviewers

Please answer each with a verdict (agree, disagree, change) and one line of reasoning. Disagreements are recorded in the Decisions table, not resolved by majority.

- **Q1. Geometry over DOM moves (principle 3).** Is one fixed-position node per surface with computed rects the right base, or should docks be real containers with a special case for iframes?
- **Q2. Phones first (phase 1 before 2).** Agree that phone sheets ship before desktop docks?
- **Q3. Snap points.** Peek 30% / tall 80% / full. Should tall be user-draggable to any height, or fixed?
- **Q4. Map peek minimum.** 10% of the height on phones. Is a 10% live strip useful, or should the peek be a fixed 96px row with the camera zoomed out?
- **Q5. Chat default edge on desktop.** Keep left (no change for existing users) or move to right (thumb and mouse ergonomics, Discord familiarity)?
- **Q6. Pop-outs through Document PiP** with in-page floating fallback, versus `window.open` with a message bridge that works everywhere but needs a second Matrix session.
- **Q7. Orbit as a dockable surface** rather than a modal. Does this conflict with anything in the Quests epic (persistent shell, Back everywhere, keyboard contract)?
- **Q8. `WA.ui.layout.registerSurface`**: is exposing windows to map scripts a feature or an attack surface (a script that opens a window pretending to be chat)?
- **Q9. Rules that relayout automatically** (screen share → Meeting). Keep, or make every layout change a person's action?
- **Q10. Presets versus free layout.** Six presets plus drag, or fewer presets and no drag in v1?
- **Q11. Classic preset.** Keep it for one release as the escape hatch, or ship without it and rely on the feature flag?
- **Q12. What did we miss?** The most useful answer is a surface, hook or user we forgot.

## 14. Decisions

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D1 | Surfaces with computed geometry; one DOM node per surface | proposed | Q1 |
| D2 | Phase order 0 → 1 (phone) → 2 (desktop) → 3 → 4 → 5 | proposed | Q2 |
| D3 | Snap points 30 / 80 / 100 | proposed | Q3 |
| D4 | Chat stays on the inline-start edge by default | proposed | Q5 |
| D5 | Pop-outs use Document PiP, fallback floats | proposed | Q6 |
| D6 | Orbit becomes a surface; its opening policy stays with Quests 0B/4B | proposed | Q7 |
| D7 | Additive scripting API under `WA.ui.layout` | proposed | Q8 |
| D8 | `Classic` preset kept through the first release | proposed | Q11 |

## 15. Review pack

Paste sections 3, 4, 8, 11 and 13 into the other models with this instruction:

> You are reviewing a layout architecture proposal for a WorkAdventure fork (Svelte front end, Phaser map, Matrix chat, WebRTC cameras, iframes for co-websites and an admin app called Orbit). Answer Q1 to Q12 with a verdict and one line each. Then list the three highest-risk assumptions in the plan and, for each, the cheapest experiment that would test it. Do not restate the plan.

Record each model's answers in `reviews/<model>-<date>.md` in this folder. The Decisions table is updated only from those files.

## Appendix: file map

| Concern | Files |
| --- | --- |
| Root split, canvas size | `Components/App.svelte:252`, `Stores/CoWebsiteStore.ts:83`, `Phaser/Services/WaScaleManager.ts:66` |
| Layer stack | `Components/MainLayout.svelte`, `Components/GameOverlay.svelte:90` |
| Camera avoidance | `Stores/BiggestAvailableAreaStore.ts:139`, `Phaser/Game/GameScene.ts:1509`, `Phaser/Game/CameraManager.ts:405` |
| Chat panel | `Chat/ChatSidebar.svelte`, `Chat/ChatSidebarWidthStore.ts`, `Stores/ChatStore.ts`, `Chat/Components/ChatLayout.ts`, `Chat/Stores/PeopleCardReturn.ts` |
| Cameras | `Components/EmbedScreens/Layouts/PresentationLayout.svelte`, `Components/EmbedScreens/CamerasContainer.svelte`, `Stores/VideoLayoutStore.ts`, `Stores/HighlightedEmbedScreenStore.ts`, `Components/Video/PictureInPicture.svelte`, `WebRtc/LayoutManager.ts` |
| Co-websites | `Components/EmbedScreens/CoWebsitesContainer.svelte`, `Stores/CoWebsiteStore.ts`, `Chat/Utils.ts:20` |
| Modals | `Components/Modal/Modal.svelte`, `Stores/ModalStore.ts`, `Components/Modal/MainModal.svelte`, `Components/Modal/Popup.svelte` |
| Orbit | `external-modules/admin-api/index.ts`, `Stores/MenuStore.ts:324`, `Components/ActionBar/MenuIcons/OrbitMenuItem.svelte` |
| Action bar | `Components/ActionBar/ActionBar.svelte`, `Components/ActionBar/ResponsiveActionBar.svelte`, `Stores/MenuStore.ts:334` |
| Scripting API | `Api/Iframe/nav.ts`, `Api/Iframe/Ui/Modal.ts`, `Api/Iframe/Ui/UIWebsite.ts`, `Api/Iframe/chat.ts`, `Api/IframeListener.ts`, `packages/iframe-api-typings/` |
| Breakpoints | `libs/tailwind/tailwind.config.js:79`, `Utils/BreakpointsUtils.ts:51`, `style/breakpoints.scss` |
| Persistence | `Connection/LocalUserStore.ts:765-800` |
