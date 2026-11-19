# Changelog

All notable changes to Universe are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers match the `VERSION` file and the [GitHub releases](https://github.com/BAWES-Universe/workadventure-universe/releases), where every release also lists each pull request in full.

Universe is released together with Orbit ([workadventure-universe-admin](https://github.com/BAWES-Universe/workadventure-universe-admin)); see its changelog for the other half.

Everything before Universe's own releases is the WorkAdventure history, kept at the bottom of this file.

## [Unreleased]

Planned for 0.5.0. This section gets its version and date when the release ships.

### Added
- **Bricks for everyone.** "Just you" in the Share list, private answers in a group, everyone's own Brick, more Bricks, delete with Undo, the Brick for guests in Chats, what a Brick remembers and its files, a Brick's page with look, Mind, Voice, Behavior, Permissions and Companion, a Brick that lives in a room and walks beside its person, templates. (#2009, #2010, #2014, #2019 to #2021, #2023, #2049, #2055)
- **Calling a Brick.** The call's rules, bar, walk-up card and button, the private call space, the bot server starting and ending a call, the front joining the call, a meeting holding the call, a quiet stretch, and "On a call" next to a person's status. (#2017, #2024, #2026, #2039, #2040, #2050)
- **Apps.** Lend an App to a universe, the Apps pages, Search apps and Connect another, "Connect your calendar?" in chat, add your own App, Keys for Apps (including keys with text that cannot go in a header), add by link without making it twice, Connect GitHub for Bricks. (#2027 to #2030, #2035, #2042, #2048, #2051, #2058)
- **Goals and tasks.** Reminders from Orbit's due list, a person asks for a reminder and can snooze, pause or stop it, watches, briefings and goals, goals use the owner's Apps and ask on a card, a goal that cannot tell asks once, Goals on a Brick's page and across all Bricks, "Everything Brick did", chat steps with a clock and a time per step. (#2025, #2034, #2047, #2054, #2056, #2057, #2059, #2060, #2062, #2064)
- **Computers.** The model relay and the runner, and computers for every member. (#2015, #2043)
- **Usage.** A Usage row and page, real numbers, extra credit, By bot and Activity receipts, and a Brick's owner can run Instant Apps from chat. (#2016, #2052, #2053)
- **Voice and phone.** Every bot hears voice notes, a locked-phone push opens with the Brick's news, and wokas at the screen edges stay visible when zoomed out. (#2032, #2065, #2018)

### Changed
- "Didn't work?" is removed, and a refunded task shows why it took nothing. (#2066)
- Free bot greetings are text only. (#1989)
- PostHog gets usage numbers only, nothing people say, and players by Orbit id and never email. (#2045, #1842, #1843)

### Fixed
- Voice bots reconnect a lost audio line, and a bot hears a LiveKit person again. (#1990, #2012)
- The Play build no longer runs the runner out of memory. (#2037)

## [0.4.3] - 2026-11-10

### Added
- Voice with many more companies: bots can hear and speak with their owner's own key from Async, Bland, CAMB.AI, fal, Gladia, Gradium, Groq, Hume, Meta, Mistral, Neuphonic, Resemble AI, Rime, Sarvam AI, Smallest AI, Speechify, Speechmatics, Together AI, OpenAI, NVIDIA, MiniMax, xAI, Google, Zoom, AWS and Azure AI Speech. (#1885)
- Bots hear voice notes in direct messages and nearby chat, and you can hold the mic to record a voice note on phones.
- Voice in a group: pause when a friend joins, tap-only voice options, and "Stop speaking" and "Stop listening" in chat.

### Changed
- A voice bot only answers when addressed, in bubbles and meeting rooms, and "stop" sticks.
- A bot's Off voice state is just the switch.

### Fixed
- Text keeps working when spoken replies run out.
- A summoned bot goes back when its person walks away.
- Nova Sonic ends the session cleanly when a reply is whole.
- Typed stop or change interrupts a voice bot again, and a few smaller voice fixes (cut-off WAV, Meta key rejection).

## [0.4.2] - 2026-11-08

### Fixed
- The bot reconnects when voice is switched on or off, and keeps its voice-bot tag.

## [0.4.1] - 2026-11-08

### Added
- Voice with many more companies: hear and speak with Deepgram, Cartesia, ElevenLabs, Soniox, AssemblyAI and Fish Audio.
- Talk live through OpenAI, xAI, Azure OpenAI, Google, AWS, Inworld, Ultravox and Zoom, with the bot's Mind still answering.
- Hear and speak on your own speech server, at an https address. (#1874)
- One key for listening and speaking, and "Hear this voice say hello" on the bot voice page.

### Changed
- Every current ElevenLabs model is spoken the way ElevenLabs serves it.
- The daily listening limit also applies to group chatter, and a bot is told its name so a name said in Arabic is spelled as written.

### Fixed
- iPhone: sounds follow distance and every volume slider works.
- A Deepgram bot waits through a pause in the middle of a sentence.

## [0.4.0] - 2026-11-06

### Added
- **Voice bots.** Bots join a bubble's audio, hear you with a live draft only you see, speak their answers and stop when you talk. A Voice button with four ways to talk, a voice worker that picks each bubble's hearing and speaking company, and voice replies inside the same 5-hour allowance. (#1664 to #1670, #1746 to #1752)
- **Bots ask first.** Approval cards in direct messages, question cards before a big job, a card with the total before a bot makes more than its limit, and "allow more" with who is allowed more now. (#1656 to #1662)
- Bots see their own artifacts, and another bot's only when pointed at.
- A bot's mood and work as an emoji beside its Woka. (#1667)
- New player and bot visit cards, and the real Woka in People search. (#1790)
- One status dot on every direct chat's woka. (#1731)

### Changed
- A bot's tool calls show whole, once, and as they finish.
- Bot page Tools: one row per server, and a server page with four headings.
- Look around names an object's button after what a click does. (#1739)

### Fixed
- iPhone: object sounds fade with distance, and the camera access card shows steps that work. (#1744)
- Pusher no longer sends email addresses in member replies.

## [0.3.0] - 2026-10-08

Highlights, moved here from the README:

- **A new look.** The game and Orbit now share one dark Universe style.
- **Edit your room on the map.** Objects, areas and bots, on a computer or a phone. ([Map editor](https://bawes.net/features/map-editor))
- **Look around the map.** See the whole room and its places, then walk there.
- **Broadcast.** Send a message or a voice note to a room or a world, or go live. ([Broadcasting](https://bawes.net/features/broadcasting))
- **Raise your hand** in a call.
- **Chat.** Reactions and replies nearby, and drop files into chat or onto the map.
- **Bots** keep to their own area and come over to people.
- **Orbit.** See who is live, answer invitations, your passport, and recent visitors to the places you manage.
- **Safer.** Only the right people can kick, edit maps or change bots, and emails stay private.

Full list: [v0.3.0 release notes](https://github.com/BAWES-Universe/workadventure-universe/releases).

Full list: [v0.3.0 release notes](https://github.com/BAWES-Universe/workadventure-universe/releases/tag/v0.3.0). Later 0.3.x releases are on the [releases page](https://github.com/BAWES-Universe/workadventure-universe/releases).

[Unreleased]: https://github.com/BAWES-Universe/workadventure-universe/compare/v0.4.3...universe-develop
[0.4.3]: https://github.com/BAWES-Universe/workadventure-universe/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/BAWES-Universe/workadventure-universe/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/BAWES-Universe/workadventure-universe/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/BAWES-Universe/workadventure-universe/compare/v0.3.31...v0.4.0
[0.3.0]: https://github.com/BAWES-Universe/workadventure-universe/releases/tag/v0.3.0

---

## WorkAdventure history (before Universe)

The entries below come from the upstream WorkAdventure changelog. They are kept as they were, so their headings still say "Version" and they do not follow the format above.

## Version develop

### Updates
- Added multi Co-Website management

### Bugfix
- Moving a discussion over a user will now add this user to the discussion
- Being in a silent zone new forces mediaConstraints to false (#1508)
- Fixes for the emote menu (#1501)
- Fixing chat message attributed to wrong user (#1507 #1528)

## Version 1.5.0
### Updates
- Added support for login with OpenID Connect
- New scripting library available to extend WorkAdventure: see [Scripting API Extra](https://github.com/workadventure/scripting-api-extra/)
- New menu design!
- New `openTab` property (#1419)
- Possible integration with Posthog (#1458)

### Bugfix
- Fixing layers flattened several times (#1427 @Lurkars)
- Fixing CSS of video elements
- Chat now scrolls to bottom when opened (#1450)
- Fixing silent zone not respected when exiting from Jitsi (#1456)
- Fixing "yarn install" failing because of missing rights on some Docker installs (#1457)
- Fixing audio not shut down when exiting a room (#1459)

### Misc
- Finished migrating "Build your map" documentation into the "/docs" directory of this repository (#1417 #1385)
- Refactoring documentation (dedicated page for variables) (#1414)
- Front container code is now completely linted (#1413)

## Version 1.4.15

### Updates
- New scripting API features :
  - Use `WA.ui.registerMenuCommand(commandDescriptor: string, options: MenuOptions): Menu` to add a custom menu or an iframe to the menu.
- New `jitsiWidth` parameter to set the width of Jitsi and Cowebsite (#1398 @tabascoeye)
- Refactored the way videos are displayed to better cope for vertical videos (on mobile)
- Fixing reconnection issues after 5 minutes of an inactive tab on Google Chrome
- Changes performed in `WA.room.setPropertyLayer` now have a real-time impact (#1395)

### Bugfixes
- Fixing streams in bubbles sometimes improperly muted when there are more than 2 people in the bubble (#1400 #1402)
- Properly displaying carriage returns in popups (#1388)
- `WA.state` now answers correctly to "in" keyword (#1393)
- Variables can now be nested in group layers (#1406)

## Version 1.4.14

### Updates
- New scripting API features :
  - Use `WA.room.loadTileset(url: string) : Promise<number>` to load a tileset from a JSON file.
- Rewrote the way authentification works: the auth jwt token can now contains an email instead of an uuid
- Added an OpenId login flow than can be plugged to any OIDC provider.
- You can send a message to all rooms of your world from the console global message (user with tag admin only).

## Version 1.4.11

### Updates

- Added the ability to have animated tiles in maps #1216 #1217
- Enabled outlines on actionable item again (they were disabled when migrating to Phaser 3.50) #1218
- Enabled outlines on player names (when the mouse hovers on a player you can interact with) #1219
- Migrated the admin console to Svelte, and redesigned the console #1211
- Layer properties (like `exitUrl`, `silent`, etc...) can now also used in tile properties #1210 (@jonnytest1)
- New scripting API features :
  - Use `WA.onInit(): Promise<void>` to wait for scripting API initialization
  - Use `WA.room.showLayer(): void` to show a layer
  - Use `WA.room.hideLayer(): void` to hide a layer
  - Use `WA.room.setProperty() : void` to add, delete or change existing property of a layer
  - Use `WA.player.onPlayerMove(): void` to track the movement of the current player
  - Use `WA.player.id: string|undefined` to get the ID of the current player
  - Use `WA.player.name: string` to get the name of the current player
  - Use `WA.player.tags: string[]` to get the tags of the current player
  - Use `WA.room.id: string` to get the ID of the room
  - Use `WA.room.mapURL: string` to get the URL of the map
  - Use `WA.room.mapURL: string` to get the URL of the map
  - Use `WA.room.getMap(): Promise<ITiledMap>` to get the JSON map file
  - Use `WA.room.setTiles(): void` to add, delete or change an array of tiles
  - Use `WA.ui.registerMenuCommand(): void` to add a custom menu
  - Use `WA.state.loadVariable(key: string): unknown` to retrieve a variable
  - Use `WA.state.saveVariable(key: string, value: unknown): Promise<void>` to set a variable (across the room, for all users)
  - Use `WA.state.onVariableChange(key: string): Observable<unknown>` to track a variable
  - Use `WA.state.[any variable]: unknown` to access directly any variable (this is a shortcut to using `WA.state.loadVariable` and `WA.state.saveVariable`)
- Users blocking now relies on UUID rather than ID. A blocked user that leaves a room and comes back will stay blocked.
- The text chat was redesigned to be prettier and to use more features :
  - The chat is now persistent between discussions and always accessible
  - The chat now tracks incoming and outcoming users in your conversation
  - The chat allows your to see the visit card of users
  - You can close the chat window with the escape key
- Added a 'Enable notifications' button in the menu.
- The exchange format between Pusher and Admin servers has changed. If you have your own implementation of an admin server, these endpoints signatures have changed:
  - `/api/map`: now accepts a complete room URL instead of organization/world/room slugs
  - `/api/ban`: new endpoint to report users
  - as a side effect, the "routing" is now completely stored on the admin side, so by implementing your own admin server, you can develop completely custom routing

## Version 1.4.3 - 1.4.4 - 1.4.5

## Bugfixes

- Fixing the generation of @workadventure/iframe-api-typings

## Version 1.4.2

## Updates

- A script in an iframe opened by another script can use the IFrame API.

## Version 1.4.1

### Bugfixes

- Loading errors after the preload stage should not crash the game anymore

## Version 1.4.0

### BREAKING CHANGES

- Scripting API:
  - Changed function names: `restorePlayerControl` => `restorePlayerControls`, `disablePlayerControl` => `disablePlayerControls`.
    Please keep in mind that the scripting API is still experimental. Some breaking changes can occur in it until we mark it as stable.

### Updates

- Added the emote feature to WorkAdventure. (@Kharhamel, @Tabascoeye)
  - The emote menu can be opened by clicking on your character.
  -  Clicking on one of its element will close the menu and play an emote above your character.
  -  This emote can be seen by other players.
- Player names were improved. (@Kharhamel)
  - We now create a GameObject.Text instead of GameObject.BitmapText
  - now use the 'Press Start 2P' font family and added an outline
  - As a result, we can now allow non-standard letters like french accents or chinese characters!

- Added the contact card feature. (@Kharhamel)
  - Click on another player to see its contact info.
  - Premium-only feature unfortunately. I need to find a way to make it available for all.
  - If no contact data is found (either because the user is anonymous or because no admin backend), display an error card.

- Mobile support has been improved
  - WorkAdventure automatically sets the zoom level based on the viewport size to ensure a sensible size of the map is visible, whatever the viewport used
  - Mouse wheel support to zoom in / out
  - Pinch support on mobile to zoom in / out
  - Improved virtual joystick size (adapts to the zoom level)
- Redesigned intermediate scenes
  - Redesigned Select Companion scene
  - Redesigned Enter Your Name scene
    - Added a new `DISPLAY_TERMS_OF_USE` environment variable to trigger the display of terms of use
- New scripting API features:
  - Use `WA.loadSound(): Sound` to load / play / stop a sound


### Bug Fixes

- Pinch gesture does no longer move the character

## Version 1.3.0

### New Features

* Maps can now contain "group" layers (layers that contain other layers) - #899 #779 (@Lurkars @moufmouf)

### Updates


### Bug Fixes
