# Voice bridge v1

The contract between the bot server and the voice worker. `schema.json` is the exact shape (JSON Schema 2020-12);
the worker checks every message it receives against it, and the integration test checks every message in both
directions. `src/protocol.ts` and `bots/voice/protocol.ts` mirror it as TypeScript types.

## Transport

* The bot server connects to `ws://<worker>/bridge?botId=<id>`, with `Authorization: Bearer <secret>` when the worker has a secret.
* One socket per bot. Text frames, one JSON object each. Every message has `type` and `sessionId` (and `ts`, epoch ms).
* A session is one bot in one bubble. Sessions live and die with the socket: when it closes, everything it owned is closed.
* Audio never goes over this socket. People reach the worker over WebRTC; the setup data (offer, answer, ICE
  candidates) is relayed through it, from the game's own private events.

## Words

* **lane**: one person's audio connection in a session. Two people in a bubble are two lanes of one session.
* **epoch**: a number the bot server gives each path it starts, from one counter for the whole bot: a connection with
  a person, or the room. All messages about that path carry it. The worker keeps only the newest; anything with an older
  epoch is stale and dropped.
* **room**: the bot's own LiveKit participant for a bubble that the game moved to LiveKit. One per session.

## Messages

Bot server to worker: `session.open`, `lane.open`, `lane.signal` (the person's offer or candidates), `lane.close`,
`mode.set`, `bot.say`, `bot.retract`, `voice.stop`, `session.end`, and for LiveKit `room.join` (the address and the token the
game made for the bot's identity), `room.people` (whose microphone the bot may subscribe to, with their modes; replaces the
earlier list) and `room.leave`.

Worker to bot server: `session.start` (session accepted), `participant.join` (audio is connected both ways),
`participant.leave`, `lane.signal` (the answer), `playback.progress`, `engine.status` (with `room` while in a room),
`room.state` (`connected`, or `closed` / `failed` when the connection ended without being asked to), `error`.

Errors that name a lane (`participantId`, `epoch`): `stale_epoch` (message for an old or unknown lane, dropped),
`at_capacity` (too many connections: the bot server hangs up that person), plus `invalid_message`, `no_session`, `internal`.
Errors with no lane and no room (`at_capacity` on `session.open`, `no_session`) are about the whole session: the bot server
forgets that session, tells whoever was waiting on it to disconnect, and the next start opens a new one.

## Modes (per lane)

| mode | worker takes the person's microphone | worker plays the bot to the person |
|---|---|---|
| `talk` | yes | yes |
| `listen_only`, `type_and_listen` | no | yes |
| `speak_and_read` | yes | no |
| `off` | no | no |

A microphone packet that is not permitted is dropped before it is decoded (`frames_gated`). Changing the mode never reconnects.

## Rules

1. Only committed segments are spoken (`committed: true` is required).
2. Playback is not hearing: `playback.progress` says how much audio was sent, never which words were heard.
3. One current path. A newer epoch closes the old path first and the old path receives and sends nothing from then on:
   a newer lane replaces the person's older lane, `room.join` replaces every older lane (`participant.leave` with reason
   `superseded`), and `lane.open` replaces an older room.
4. Audio only. The worker answers the audio of an offer and rejects video (an offer with no audio line is answered too, and the person is asked to add one with a transceiverRequest and offer again, so they can hear the bot with no microphone); it ignores whatever else a person sends. In a
   room it publishes one microphone track and subscribes to nothing but the microphone of the people in `room.people`
   (never a camera, a screen, screen-share audio, or a bot's track).
5. Fixed audio maths: 24 kHz mono s16 is 960 bytes per 20 ms, never 1920. Real-time pacing, one frame at a time, nothing buffered ahead.
6. If the worker is down or refuses, people's own calls are untouched; only the bot's voice is missing.

Reserved for recognition (#1664): `user.speech_started`, `user.turn`.
