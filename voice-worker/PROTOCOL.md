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
`room.state` (`connected`, or `closed` / `failed` when the connection ended without being asked to), `user.speech_started`,
`user.partial`, `user.turn` (what the worker heard a person say, see Recognition), `error`.

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

## Recognition

The worker turns a person's permitted microphone audio into words through a swappable recognizer (`src/recognizer.ts`; no
provider is wired, tests use `FakeEars`). It only ever sees the audio of people whose mode listens (`talk`, `speak_and_read`),
on the current path, one person at a time. A stretch of speech starts at the first words and ends at a pause. Messages carry
the person's `participantId`, the path's `epoch`, and a `turnId` that ties one stretch together:

* `user.speech_started`: a person started speaking: sent once per stretch, when it has as much voiced audio as the barge-in setting (`VOICE_BARGE_IN_MS`) or its first words come through, whichever is first. A click or a cough that is neither gets no `user.speech_started`; its stretch still ends with `user.turn` `cleared`.
* `user.partial`: all the words so far, replacing the last. For that person's eyes only: the bot server shows them to that
  person as a private event and to nobody else.
* `user.turn`: how the stretch ended.
  * `final`: every word came through. The bot server hands it back to the person's own game, which sends it as their own
    chat line with the bot and `turnId` named on it (`SpaceMessage.spoken`). The bot answers that line once.
  * `lost`: the words so far did not all come through (`reason`: `cap` the longest stretch was reached, `gap` audio was missing
    from the middle, `path` the connection was dropped or replaced, `stopped` the bot's voice was stopped, `provider` the recognizer
    gave up). They are only offered back to the person (Edit, Send, Discard); nothing is ever sent for them.
  * `cleared`: nothing to keep (no words, or the person stopped being heard on purpose: muted, a mode that does not listen).

The longest stretch is `VOICE_MAX_UTTERANCE_SECONDS` (default 180) of audio. At it the worker stops, offers the words back and
takes nothing more until the person pauses. A `final` that arrives for a path the bot server has since replaced is not sent either:
it is offered back as `lost` with reason `path`. No audio is kept: it goes to the recognizer as it arrives and is dropped.

## Speaking and being talked over

`bot.say` carries one committed segment: the words the bot server has checked and chosen to say (the chat has the reply in
full; this is the spoken version, see `bots/voice/SpokenText.ts`). `maxMs` is the longest it may play; the worker never plays
longer than `VOICE_MAX_REPLY_SECONDS`. Segments play one at a time, in order. `playback.progress` ends each with a `reason`:

* `completed`: all of it was sent. `limit`: it reached its longest time. `retract`, `voice_stop`, `mode`, `lane_loss`, `rejected`: as before.
* `barge_in`: a person the bot hears spoke over it. The segment playing stops within a frame, everything queued behind it is
  dropped (each ends with `barge_in` and `playedMs: 0`), and nothing resumes by itself. This is decided in the worker, from the
  person's permitted microphone audio, with no round trip to the bot server: speech counts after `VOICE_BARGE_IN_MS` of voiced
  audio, so a click or a cough does not stop it. It stops the voice for everyone in the bubble; it cancels nothing but audio.
  The bot server marks the message when `playedMs` is more than zero.

The speech itself comes from a swappable synthesizer (`SpeechSynthesizer` in `src/fakeSpeech.ts`); only a fake is wired.
