# Review · engineering feasibility · Claude (independent pass) · 2026-09-26

Reviewer brief: senior front-end engineer on this codebase; verify the v0 README against the code. Paths relative to `play/src/front/`.

## 1. Q1–Q12

- **Q1 agree**, with one condition: the fixed-position nodes must hang off a viewport-level root. Today `MainLayout` and `ChatSidebar` are children of `#game` (`Components/App.svelte:257-259` → `Components/GameOverlay.svelte:95-103`), whose box is set to the canvas size by `Phaser/Services/WaScaleManager.ts:70-73`. Every `absolute` overlay (notifications `MainLayout.svelte:168`, card column `:239`, explorer/express `:256`, UI websites, the `@container/main-layout` query `:116,307`) is framed by the map, so a "map peek" would shrink the whole overlay stack into the corner.
- **Q2 change**: ship the desktop chat dock first. It is one store swap (`MainLayout.svelte:106` padding → map rect) on a width that is already persisted; phone sheets need the same canvas-resize pipeline plus peek zoom, thumb bar and the mobile e2e spec, so they are not the smaller surface.
- **Q3 change**: free drag while held, persist as the nearest snap. `ChatSidebarWidthStore.ts:16-29` shows arbitrary sizes need thresholds (action bar hides under 285px).
- **Q4 change**: neither option fixes the real problem. `HdpiManager.ts:33-38` returns `game = real` when the canvas has fewer than 640×480 real pixels (`WaScaleManager.ts:199`), so a 390×84 CSS strip at dpr 3 renders at zoom 1/3: avatars about 10 CSS px. The peek needs its own `setZoomModifier`/`setFocusTarget` policy; height alone is irrelevant.
- **Q5 agree**: keep inline-start; the code is already logical-direction (`MainLayout.svelte:120`, `ChatSidebar.svelte:27,37`), so moving later is cheap.
- **Q6 agree** on Document PiP, but the doc misses two costs: no Android/iOS support, so phones never pop out; and 21 call sites in `Chat/` use `svelte-modals`/floating-ui portals that render in the opener document (`EmojiButton.svelte`, `RoomMenu.svelte`, `ChatHeaderNewMenu.svelte`, `AccessSecretStorageDialog.svelte`). That, not Matrix sessions, is the work.
- **Q7 agree**, provided the surface keeps `Modal.svelte:31-33` (`modalIframeWindowStore`, `registerIframe`) and the window-global Esc (`:23-27, :66`) is replaced by the focus rule, otherwise Esc in a chat field closes Orbit.
- **Q8 change**: allow it. `WA.ui.website.open` already lets a script draw an iframe anywhere over the map (`Components/UI/Website/UIWebsiteLayer.svelte:37-54`); the new surface just needs a visible origin in the title bar and no `chat`/`orbit` kind.
- **Q9 change**: keep exactly one automatic rule (screen share → highlight) since it exists today as `highlightedEmbedScreen` + `isOnOneLine` (`Stores/VideoLayoutStore.ts:52-69`); everything else opt-in and gated on `inputFormFocusStore` (`MainLayout.svelte:67-93`).
- **Q10 change**: three presets (Hangout, Meeting, Focus) and dock-edge drag in v1; floating windows bring clamp, z-order and focus systems for little product value.
- **Q11 agree**: Classic is the phase-0 test oracle, not only an escape hatch; keep until the DOM-scan fallback is deleted.
- **Q12 missed**: the map editor sidebar (a right dock with its own width store, `Components/MapEditor/MapEditor.svelte:29-46`, `MainLayout.svelte:107-110`, `LocalUserStore.ts:790-800`); Calendar/TodoList (`GameOverlay.svelte:107-112`); `highlightFullScreen` at z-310 (`MainLayout.svelte:126-130`); the `{#key $forceRefreshChatStore}` remount that destroys chat and MainLayout together (`GameOverlay.svelte:99`); the `mobile:` variant flipping the action bar top/bottom (`MainLayout.svelte:134`); e2e ids `cameras-container`, `resize-handle`, `tab1` (`tests/tests/mobile/mobile.spec.ts:47-110`).

## 2. Factual errors and stale claims

- `ChatSidebar.svelte:109` has no positioning; it comes from `style/chat.scss:240-248` (`position:absolute; top:0; height:100dvh; z-index:2000`). Drag max is `vw - 50` (`ChatSidebar.svelte:39,58`), not half the viewport; double-click toggles full width (`:77-87`). Under 768px is right (`:146-150`, `breakpoints.scss:35-50`).
- `openCoWebSite.position` is a numeric slot index (`Api/Events/OpenCoWebsiteEvent.ts:8`, `Api/Iframe/nav.ts:81`, `docs/developer/map-scripting/references/api-nav.md:66-69`). The compatibility table remaps it to `right|left|bottom|float|full`, which changes the signature the table promises not to change. It is dropped at `Chat/Utils.ts:20-31` as stated.
- "Today's forced `LayoutMode.Presentation` becomes a rule": `embedScreenLayoutStore` is written at `Stores/StreamableCollectionStore.ts:187` but its only subscriber is commented out (`GameScene.ts:2372-2374`). The live rule is `highlightedEmbedScreen`.
- `BiggestAvailableAreaStore.ts:144-158` mixes canvas-local `gameSize` with viewport `getBoundingClientRect` blockers; correct only while the canvas origin is (0,0), which is false in portrait co-website mode today and in every docked layout tomorrow. `CameraManager.ts:405-411` assumes canvas-local.
- Section 12 "UI websites positioned relative to the viewport": they are already map-relative because `UIWebsiteContainer` is inside `#main-layout` inside `#game`.
- z-indexes: about 60 distinct values, not twenty; the 999999999 is `Chat/Components/RefreshChat.svelte:27`.
- `Modal.svelte:128` is `<style>`; Esc is `:23-27`. The 80%/400px rule is `@media (max-width: 991px)` (`:141`), tablets included.
- `mapEditorSideBarWidth` is also persisted and missing from the migration row.

## 3. Highest-risk assumptions and cheapest experiments

1. **"Map resized instead of covered" is a store change.** It is a DOM restructure (see Q1). Experiment: in `Stores/CoWebsiteStore.ts:83` subtract `$chatSidebarWidthStore` from `canvasSize` when chat is visible and delete the padding at `MainLayout.svelte:120`; open chat and watch the action bar, notifications, visit card and `biggestAvailableAreaStore` offsets.
2. **A 10% live map peek is usable.** Experiment, zero code: portrait phone, `WA.nav.openCoWebSite(url, false, "", 90)` (or set `coWebsiteRatio` to 0.9) gives a 10% map today via `CoWebsiteStore.ts:95-99`; then try `waScaleManager.setZoomModifier(3)` from the console. Files: `WaScaleManager.ts`, `HdpiManager.ts`.
3. **Chat pops out with nothing to sync.** Experiment: console script that calls `documentPictureInPicture.requestWindow`, reuses `copySteelSheet` (`PictureInPicture.svelte:44-62`) and appends `#chat`; then open the emoji picker, room menu and the requires-login modal.

## 4. Phase plan

- Phase 0 cannot be "no visible change" and also feed the free rect: it must hoist `MainLayout`/`ChatSidebar` out of `#game` and fix the coordinate space, both visible-risk work; that is precisely where Classic-through-shell earns its keep.
- Phase 1 underestimates sheets: they need the resize pipeline, a peek zoom policy, ActionBar restructuring for the thumb bar, and `mobile.spec.ts` updates. Desktop docks are closer to today.
- Phase 2 "openCoWebSite honours position" is an API semantics change and belongs with phase 5 plus `packages/iframe-api-typings`.
- Phase 4 depends on the portal problem from Q6 and never applies to phones.
- Any per-frame drag resize goes `applyNewSize` → `scene.onResize` → `reposition(true)` → DOM scan (`WaScaleManager.ts:90-95`, `GameScene.ts:1478-1481`); debounce is mandatory, not a nicety.

## 5. One addition

A viewport-level `ShellRoot.svelte` mounted in `#main-container` (`App.svelte:252`) that owns `MainLayout`, `ChatSidebar` and the map cell, with `canvasSize` rewritten as a derived facade of the shell's `mapRect`. Today's co-website split then becomes the first dock through the same mechanism, the only canvas-resize path (`App.svelte:232-239` → `WaScaleManager.ts:36,122`) stays untouched, and `findBiggestAvailableArea` (already pure, `BiggestAvailableAreaStore.ts:8`) becomes the engine's free-rect function with surface rects as blockers.
