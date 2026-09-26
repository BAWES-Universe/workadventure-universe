# Review · compatibility and hackability · Claude (independent pass) · 2026-09-26

Reviewer brief: map builder and integrator who scripts WorkAdventure maps heavily and runs Orbit; verify the compatibility table against the real API surface.

## 1. Q1–Q12

- **Q1 agree.** Geometry only. Beyond iframe reload, script identity is bound to the node: `registerIframe(iframe, id)` (`play/src/front/Api/IframeListener.ts:639`) and Orbit's auth bridge checks `event.source === get(modalIframeWindowStore)` (`play/src/front/external-modules/admin-api/index.ts:63`).
- **Q2 agree.** Today's phone modal is 80%/400px with a dead map sliver (`Components/Modal/Modal.svelte:141`); nothing on desktop hurts that much.
- **Q3 change.** Tall draggable, snap on release; a fixed 80% fights the keyboard on 320px screens.
- **Q4 change.** Fixed 96px row, zoomed out. 10% of a 568px phone is 57px, under one tile row; proximity is invisible.
- **Q5 agree.** Keep inline-start; `ChatSidebar` and every builder screenshot assume it.
- **Q6 agree,** with a rule: iframe surfaces re-run their handshake after pop-out (Orbit's `modalIframeWindowStore` must be re-set or auth silently dies).
- **Q7 change.** Dockable is fine, but `initializeAdminIntegration` auto-opens Orbit after 1500ms (`admin-api/index.ts:159`), which breaks "no auto-open"; and a dock without backdrop means C/U/1–6 (`Phaser/UserInput/GameSceneUserInputHandler.ts:34-70`) fire while Orbit is visible but unfocused. The focus model must own that.
- **Q8 feature,** with the constraints in section 4.
- **Q9 change.** Keep rules, but a script `place()` pins the layout until released; otherwise a builder's scripted Studio is stomped by the screen-share rule.
- **Q10 change.** v1: Hangout, Meeting, Focus, Classic, no drag. Builder is a room `layoutPreset`, not a global preset.
- **Q11 agree.** Classic is the e2e oracle for phase 0.
- **Q12:** see section 2, items 1–4.

## 2. Missing from the compatibility table

1. **`WA.room.website` embedded websites** (`Api/Iframe/website.ts`, `Api/Events/EmbeddedWebsiteEvent.ts`): iframes in map coordinates with `origin: player|map` and `scale`. They follow the Phaser camera, so they depend on `mapRect` and zoom, not the viewport. Not listed.
2. **`WA.camera.set(x,y,width,height,lock)` / `followPlayer` / `onCameraUpdate`** → `wasCameraUpdated {x,y,width,height,zoom}` (`Api/Events/CameraSetEvent.ts`, `WasCameraUpdatedEvent.ts`, `Phaser/Game/GameScene.ts:2730-2820`). Docking changes canvas size, so `width/height` and the zoom needed to fit a rect change on every drag. Needs a row and a debounce.
3. **`WA.ui.openPopup(targetObject…)`** anchors to a Tiled rectangle in map space (`docs/.../api-ui.md`); projection must use `mapRect`.
4. **`WA.ui.registerMenuCommand({iframe})` + `Menu.open()`** (`Api/Iframe/Ui/Menu.ts`, `Api/Events/Ui/MenuEvents.ts`): a script iframe inside the menu surface, listed under the action bar row but it is a `menu` surface.
5. **`WA.controls.disableWheelZoom/restoreWheelZoom`, `disablePlayerControls`** (`Api/Iframe/controls.ts`, `GameScene.ts:2918`): the keyboard/zoom contract; the focus store must consult them.
6. **`WA.iframeId`** (`GameScene.ts:3015`, `Components/UI/Website/UIWebsiteLayer.svelte:24`): `getById(WA.iframeId)` works only because the layer registers the iframe with its id. `registerSurface` iframes must register the same way.
7. **Hotkeys E, R, Ctrl+D** (`GameSceneUserInputHandler.ts:42-88`) are absent from the hotkeys row.
8. **`openWebsiteHideUrl` / `hideUrl`** (`Chat/Utils.ts:26`): the per-co-website URL bar must survive the tab strip move.
9. **`modalCloseTrigger` / `closeCallback`** (`IframeListener.ts:578,1084`): define whether minimise fires it (it should not).
10. **Docs are already wrong**: `api-ui.md` says UI websites are "positioned relative to the browser window", but `UiWebsiteContainer` lives inside `#main-layout` (`Components/MainLayout.svelte:216`), which is inside `#game` and padded by chat width (`MainLayout.svelte:106,120`). They are already map-relative and already shift with chat.
11. **§3.4 is wrong about `.screen-blocker`**: only `Chat/ChatSidebar.svelte`, `Components/ActionBar/ResponsiveActionBar.svelte` and `Components/Video/VideoMediaBox.svelte` carry it. UI websites are ignored by the camera today; adding them as surfaces changes camera behaviour.
12. Side bug: `UIWebsiteSizeInternal.width` getter returns `this._height` (`Api/Iframe/Ui/UIWebsite.ts`). Any facade that reads size back through the API inherits it.

## 3. Behaviour changes with unchanged signatures

- **`openCoWebSite` `position`** is a number today (a slot index; `Stores/CoWebsiteStore.ts:7` `add(coWebsite, position)` honours it even though `Chat/Utils.ts:30` drops it). The table silently retypes it to `right|left|bottom|float|full`. Not acceptable: keep the number as order, add a named `region` in a new options object.
- **`widthPercent`** is documented as "of the viewport, max 70%" (`api-nav.md`). Say explicitly it stays viewport-relative when it becomes dock size.
- **`lazy` honoured**: `await open` then `getIframe()` or postMessage now hits an unmounted iframe. Acceptable with a docs note.
- **UI websites**: `%` sizes resolve against the map rect, `vw/vh` do not, so a `50vw` website beside a 40% dock clips. Acceptable; recommend `%` in docs.
- **Modal `allowFullScreen`** is a no-op today (`Modal.svelte:35`, "not implemented yet"); mapping it to region `full` makes it work. Acceptable, visible.
- **Modal center on phone** is fullscreen today (`Modal.svelte:63`); as a sheet it must default to snap `full`, not peek.
- **`WA.chat.close()`** with a third state (minimised): keep close = unmounted, and `PeopleCardReturn.sidebarCoversMap` becomes false on desktop docks, so the card-return rule stops firing. Acceptable.
- **Orbit auto-open** plus a per-room Builder preset means Orbit opens twice. Not acceptable; remove the timer.

## 4. `WA.ui.layout` critique

- **Shape**: `onChange()` should return an rxjs `Observable` like `WA.camera.onCameraUpdate()` and `WA.ui.onRemotePlayerClicked`, not `Subscription<…>`. Event should carry `{reason: "user"|"rule"|"script"|"resize", preset, mapRect, freeRect, surfaces}`.
- **Missing queries**: `getSurfaces()`, `getMapRect()`/`onMapRectChange()`, `getDeviceClass()`. The map rect is the one number every HUD script and popup needs and `BiggestAvailableAreaStore` never exposes.
- **Missing handle**: `registerSurface` should return an object mirroring `UIWebsite`: `place()`, `minimise()`, `focus()`, `close()`, `visible`, `title` and `badge` setters, `onFocus/onClose/onResize`. It also needs `allowApi`, `allowPolicy`, `closable` like every other iframe primitive.
- **Capabilities**: `allows` is a request; the shell must return the effective set clamped by device class and policy (no `popout` on phones).
- **Q8 recommendation**: a feature, gated. (a) Shell-drawn chrome only: title is plain text, kind is always `script`, chip shows the script origin, so nothing can look like chat. (b) Scripts may `place()` only surfaces they registered, plus `chat` and their own co-websites; `orbit`, `menu`, `modal`, `map` are not addressable. (c) `applyPreset` and region `full` require a user gesture or the room `layoutPreset` property. (d) Cap at four script surfaces, same `allowApi` gate as UI websites. (e) Orbit is opened only by the extension module, never by script, matching "Orbit runs only inside Universe".

## 5. Hackability wins

1. `registerSurface` with live `badge`/`title` setters so a scoreboard or quest tracker docks, minimises to a chip with a count, and pops out like chat.
2. `WA.ui.layout.definePreset({...rules})` plus the room `layoutPreset` property, so a map ships its own "Arena" layout with a screen-share rule.
3. `getMapRect()`/`onMapRectChange()` with `freeRect`, so HUD scripts and `openPopup` anchors stay clear of docks without DOM scanning.
