# Quest proof comparison

This standalone review harness imports the actual `QuestProof.svelte` player component. Its surrounding world, residents, navigation and busy surfaces are visual fixtures. They do not run Phaser, LiveKit, chat or Orbit. Do not count a harness screenshot as a game integration or hardware test.

From the repository root, after the usual play dependencies are installed:

```sh
node play/node_modules/vite/bin/vite.js --config design/quests-proof-alternative/vite.config.mts
```

Open the printed local URL. To inspect the real development game mount, use the normal game URL with `?questProof=1` instead. Production ignores that query.

## Try these moments

1. Accept the invitation, choose Meet, open the tracker, and use its practice preview. Sending a hello alone must not complete the quest. Playing a reply does.
2. Say Not now, then reload. The invitation stays gone; the Quests launcher still opens the log.
3. Open Chat, Video, Express or Typing in this harness. Automatic quest UI gets out of the way. These buttons simulate suppression; they do not test the underlying game systems.
4. Use Proof controls, then Interactive proof, to try no host, an area host, no targets, participant departure, reconnect and appointment arrival.
5. Leave an unfocused tracker for 60 seconds. It becomes a 48px dot at the same position. It keeps an accessible objective label.
6. Try widths 320px, 390px and landscape, with browser text enlarged to 200%. The card scrolls inside its available height.

The map backdrop is rendered from this repository's `maps/starter/map.json` and its existing tilesets. It is not a live map or a new production room. The fixture labels and resident shapes do not resolve runtime hosts or targets.

## Before merging to a real-player branch

Keep this proof development-only. The owner must still check the full game on desktop, Android Chrome and iPhone Safari: held movement then quest open/close; chat keyboard; call/video; Express; editor; doors/reconnect; pinch zoom; browser Back. Also verify layering and clearance against the current game action bar. The component and mount boundaries are documented in `play/src/front/Quests/Proof/README.md`.
