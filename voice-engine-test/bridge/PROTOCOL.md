# Voice bridge protocol v1

This is the swap point. A "bot server" (the brain) talks to a "voice engine" through this protocol only.
Both test engines (Pipecat, thin TypeScript) implement the engine side. `src/brain.ts` is the shared fake brain.
The JSON schema is `schema.json` (JSON Schema 2020-12). The fake brain checks every message in both
directions against it and counts violations. A run with violations is INVALID.

## Transport

* One WebSocket per session (a session is one bubble: one bot and one or more humans). Text frames, one JSON object each.
* The engine connects to the brain: `ws://<brain>/bridge`. The engine sends `session.start` first.
* The brain never opens media. Audio never goes over this socket. Humans reach the engine over WebRTC (the test uses a tiny signaling server, see `../signaling/`).
* Every message has `type`, `sessionId` and (optional but always sent by the test code) `ts` in epoch milliseconds.

## Words used

* **lane**: one human audio path (one WebRTC peer) inside a session. Three humans in one bubble = three lanes, one bot.
* **segment**: one piece of bot speech with its own `segmentId`.
* **committed**: the brain has decided this text is final. The engine speaks only committed text.

## Messages

Engine to brain:

| type | fields | meaning |
|---|---|---|
| `session.start` | sessionId, bubbleId, participants[{participantId, lane}], mode, engine{id, kind: pipecat or ts, turnEnd: local or provider} | First message. The engine accepted the first human of a session. |
| `participant.join` | participantId, lane, rejoin | A human's media is connected. `rejoin:true` if the same participantId came back inside the grace period. |
| `participant.leave` | participantId, lane, reason: closed, failed, left | The human's media is gone. |
| `user.speech_started` | lane, participantId, whileBotSpeaking, turnId | Voice activity detection heard the person start. Sent only for lanes whose mode listens to the mic. |
| `user.turn` | lane, participantId, turnId, text, partial, droppedAudioMs, incomplete, speechMs, endReason, speechStartedAt, turnEndedAt | The person's words. `partial:true` = interim text (same `turnId` will be replaced). `partial:false` = final for this turn. `droppedAudioMs` = audio the engine knows did not arrive. `incomplete:true` on a final turn when `droppedAudioMs > 0`, so the UI can say "some words may be missing". |
| `playback.progress` | segmentId, playedMs, totalMs, finished, interrupted, reason | How much audio of the segment was sent. See "Playback is not hearing". |
| `engine.status` | engineId, voice: active or stopped, mode, lanes[{participantId, lane, healthy, mode}], counters{} | Every second and on change. Counters: frames, packets, bytes, bot audio generated / completed / cancelled, queue age, etc. |
| `error` | code, message | Something the brain should log. |

Brain to engine:

| type | fields | meaning |
|---|---|---|
| `mode.set` | mode, participantId (optional) | Change mode for one person, or for every lane if `participantId` is omitted. No reconnect. |
| `bot.say` | segmentId, text, committed:true, lang | Speak this. `committed` must be `true`. The engine answers `playback.progress{finished:true, reason:"rejected"}` and plays nothing if it is not. |
| `bot.retract` | segmentId | Withdraw a segment. Unplayed audio is dropped. Audio already sent stays sent. |
| `voice.stop` | reason: allowance_ended or other | Stop listening and speaking now. The session stays open (the brain keeps answering in text). Later `bot.say` is rejected. |
| `session.end` | | Close the session. |

Chat path to brain (an engine never sends this):

| type | fields | meaning |
|---|---|---|
| `user.text` | participantId, text, messageId | A typed chat message during a voice session. It is in the schema so the brain has ONE ordered inbound log for voice turns and typed text. The voice engine is not involved. |

## Modes

| mode | engine listens to this person's mic | engine plays bot audio to this person | note |
|---|---|---|---|
| `talk` | yes | yes | both ways |
| `listen_only` | no | yes | bot speaks, person types |
| `type_and_listen` | no | yes | same engine behaviour as `listen_only`. The names differ only in UI wording (consensus section 14.1 calls this "Type and listen"). |
| `speak_and_read` | yes | no | extra value, not required by the issue. Person talks, reads the bot's text. |
| `off` | no | no | |

Mode is per lane. `mode.set` without `participantId` sets every lane. Changing mode never reconnects. When a lane stops
playing audio, the engine stops sending audio to it at once. When a lane stops listening, its VAD, turn and speech state are reset
and an open turn is finished with `endReason:"mode_change"` only if it already has text, otherwise dropped.

## Rules the engine must follow (each has an automated check)

1. **Only committed segments are spoken.** `committed:true` is required by the schema; anything else is rejected.
2. **Playback is not hearing.** The brain keeps the full committed text of a segment. `playback.progress` carries only `playedMs`, `totalMs`,
   `finished`, `interrupted`. The engine never reports words. Nobody may infer "the person heard words N to M" from it. At best: "audio for about X ms was sent to the listener".
3. **Barge-in is local.** When a lane that listens to the mic starts speaking while the bot speaks, the engine stops audio at once, without waiting for the brain, then reports `user.speech_started{whileBotSpeaking:true}` and `playback.progress{interrupted:true, reason:"barge_in"}` for the current segment. Queued segments after it are cancelled and reported the same way (`playedMs:0`). The brain decides what to say next. A barge-in must not cancel anything the brain owns (jobs, drafts).
4. **No stale audio.** After a stop (barge-in, `voice.stop`, retract, mode change) no audio of the stopped segment may leave the engine more than one frame (20 ms) later; audio already in the network is not counted.
5. **Fixed audio maths.** Chunk bytes = sample_rate x channels x bytes_per_sample x duration. Real-time pacing is 1x. 24 kHz mono s16 gives 960 bytes per 20 ms. Never 1920.
6. **A dropped lane never duplicates output.** If a human reconnects with the same `participantId` inside the grace period (8 s), the session continues. Segments that already finished are not replayed. A segment in flight continues once, on the new connection.
7. **Turn end has two sources**, chosen per engine process at start (`turnEnd`): `local` = the engine's own VAD plus Smart Turn v3; `provider` = the (fake) speech provider says the turn ended after a silence (default 500 ms) and the engine does not run Smart Turn. Both produce the same `user.turn` message.

## Typical sequences

Walk up (S1): `session.start` (engine) -> brain sends `mode.set talk` and `bot.say "Hi, I am Robo..."` -> audio flows -> `playback.progress ... finished:true`.

Talk over (S2): bot speaking -> human talks -> engine stops audio (rule 3) -> `user.speech_started{whileBotSpeaking:true}` -> `playback.progress{interrupted:true, playedMs:N, reason:"barge_in"}` -> later `user.turn{partial:false}` -> brain replies with a new `bot.say`.

Voice runs out (S6): brain sends `voice.stop{allowance_ended}` mid sentence -> engine stops audio within 1 s, ignores mic, answers `playback.progress{interrupted:true, reason:"voice_stop"}` and `engine.status{voice:"stopped"}` -> brain keeps answering typed `user.text` in text.

## Test-only side channels (not part of the product protocol)

* `fake.clip` goes from the load generator to the engine through the signaling server: "participant P is now playing clip C". The fake STT uses it to know the transcript. A real STT would hear the audio instead.
* `GET /stats` on each engine returns JSON counters for the test harness (CPU is measured from outside with /proc).
