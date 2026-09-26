# Review · product and UX lens · Claude (independent pass) · 2026-09-26

Reviewer brief: product designer who has shipped desktop and mobile chat/voice products; compare against Discord, Slack, Gather, Teams, Meet. Read `README.md` v0 and the scenario data in `mockup.html`.

Note first: the README says chat stays inline-start by default (D4), but the mockup's desktop "Hangout" concept docks it right. Pick one before the cross-model review, or reviewers will answer Q5 against different pictures.

## 1. Q1–Q12

- **Q1** skipped (technical); only product note: any approach where a floating window can be dragged over the map must not steal avatar hotkeys mid-drag.
- **Q2 change.** Phone sheets first is right for pain, but "OS in the browser" is judged on desktop by the people you want off Discord. Ship phase 1 with one desktop fix pulled forward: map resized instead of covered. That is the change everyone notices.
- **Q3 change.** Fixed snaps, but draggable anywhere with snap-on-release, and remember the last snap per surface. Free-height sheets are what Google Maps abandoned; fixed snaps also make the keyboard math predictable.
- **Q4 disagree.** 10% of a 667px viewport minus the notch is ~50px: avatars unreadable, and it becomes a tap target at the worst reach. Use a fixed 96–112px row, camera zoomed out, names on; treat it as a radar, not a viewport.
- **Q5 change.** Move to inline-end. The mockup already argues it (action bar buttons live on the left, mouse rests right, Discord habit). "No change for existing users" is weak: a fork's user base is small and the map is being resized anyway, so everything moves once. Show a one-time "Chat moved, drag it back" toast.
- **Q6 agree.** A second Matrix session means double notifications, typing and read-receipt weirdness; that is a product bug, not an engineering one. But on Firefox/Safari hide the pop-out button rather than show one that does something else.
- **Q7 agree**, with one rule written down: Orbit's own Back stack wins, then "close foremost surface". Otherwise Esc/Back in an Orbit form closes Orbit, which the Quests epic explicitly forbids.
- **Q8 change.** Feature, with non-forgeable chrome: the shell draws the title bar, labels it "from this map" with the script origin, uses a distinct colour, and reserved kinds (chat, cameras, orbit, card) cannot be registered. Same trick browsers use for pop-ups.
- **Q9 change.** Keep exactly two rules (screen share, incoming call), never while typing, always undoable via a toast "Layout: Meeting · Undo". Everything else is a person's action. Silent relayout is the number one reason people say a tool "moves things around on me".
- **Q10 change.** Three presets (Hangout, Meeting, Focus) plus drag. Studio is "what happens when you open a co-website", Builder is "what happens when you open Orbit"; make them rules attached to a surface opening, not menu items. Six named layouts is a settings page nobody reads.
- **Q11 disagree** with it being a preset. Keep Classic as the engineering harness and feature flag, never in the profile menu; a user-visible "old layout" choice becomes permanent.
- **Q12.** Missed: a space/room switcher (Discord's server column; the shell has no navigation between rooms at all); a persistent call/voice state that follows you across surfaces and rooms; screen share as its own surface, not a camera tile; an audio-only mode (phone in pocket, voice on); a notifications inbox with "walk to"; a minimap/locate; a11y focus order for floating windows and screen readers announcing dock changes.

## 2. Where it still feels like a web app

It is a layout engine, not an OS. An OS has always-present chrome, identity for windows, and system-wide notifications. Concretely:

- The dock bar is "hidden when empty". A taskbar that disappears is a toolbar. Keep a slim always-on bar with the map as a chip, mic/cam/status as a tray, and the clock/room name. It is the thing that makes minimising feel safe.
- Alt/Cmd+` cycles surfaces, Cmd+1..9 jumps to them, Cmd+K is the launcher. Without cycling, windows are panels with extra steps.
- Notifications from any surface are toasts that focus the surface on click and restore it if minimised. Today notifications and layout are unrelated.
- Drag-and-drop across surfaces: a person from People onto the map = walk to; a file onto chat or a co-website; a URL onto the map = open co-website. Cross-window drag is the single most "OS" gesture there is.
- Window snapping: drag to an edge to dock half, to a corner to dock quarter. The doc has docks but no snap preview.
- Live titles: a window title carries its state ("Chat · 3 unread", "Cameras · Sara talking"), like Slack's tab title.
- Share a surface into the bubble: "present this window" without the OS picker. Only an OS-in-a-page can do that.

## 3. Against the incumbents

Discord: server/channel column, voice-connected pill that follows you everywhere, mentions inbox, push-to-talk, Go Live, rich presence. Gather: minimap, locate/follow a person, ghost/quiet mode, private areas, spotlight. Slack: huddle as a mini window that survives navigation, unread navigation, search. Meet: companion mode, captions, reactions, "you're muted" nudges.

For a spatial product the ones that matter: the persistent call pill (a bubble you are in must be visible in Focus with mute/leave), locate/follow, minimap, and a notification inbox whose actions are spatial ("walk to").

What this plan can do that they structurally cannot, and should be the headline: **windows in the world**. A co-website, Orbit page or camera grid anchored to a map location, seen by everyone nearby, forming a bubble around it. Discord has no space; Gather has objects but no windows; Slack and Meet have no world. Pop-outs and docks are table stakes; a shared doc on a virtual table that you walk up to is the demo.

## 4. Mobile

The sheet model holds for chat, Orbit and cards. It breaks at:

- **Keyboard.** Tall sheet + keyboard + top strip leaves almost no message list, and "the strip hides while typing" means video vanishes every time you reply. In a call that reads as a drop. Rule: keyboard collapses cameras to bubbles, never hides them.
- **Calls.** Full grid + thumb bar + chat peek handle is three stacked bars. Merge the thumb bar into the grid's bottom controls during a call. Also: backgrounding, screen lock and Safari's own PiP decide whether a call survives; without PWA install, "OS on the phone" is a fiction.
- **Notifications.** No push without an installed PWA and Web Push; badges on the thumb bar do not wake anyone. Phase 1 needs the PWA manifest and push, or mobile users still live in Discord for the ping.
- **One-handed.** The map peek at the top is the drop-the-sheet target and the bubbles are top-right: both unreachable. Drop the sheet by swiping the handle; put bubbles bottom-right above the thumb bar.
- **Safe areas.** 10/10/80 leaves nothing for the notch or the home indicator; budget them before percentages.
- **Landscape phone.** Right dock at 50% plus left rail leaves no map; landscape should be video-first with chat as an overlay.

## 5. Add / cut

Add:
1. Always-on dock bar with tray and map chip: it is what makes windows feel like windows.
2. Persistent call/voice pill across every preset and room: leaving a bubble by accident is the one thing worse than Discord.
3. World-anchored surfaces (a window placed on the map): the only feature Discord cannot copy.

Cut:
1. Six presets to three: Studio and Builder are surface-open rules.
2. Classic as a user-visible preset: keep it as the flag and the Phase 0 harness only.
3. Room `layoutPreset` in v1: rooms rearranging a person's windows is the fastest way to break trust; ship it later as a suggestion toast, not an apply.
