# Voice worker

A separate service that gives a voice bot an audio-only connection with each person in its bubble. The bot server
(`bots/`) talks to it over a WebSocket bridge (see `PROTOCOL.md`); it never carries people's own calls to each other.

What it does today (issue #1663, transport only):

* one `werift` peer connection per person, Opus both ways, video and screen refused in the answer;
* bot speech is a generated tone (`src/fakeSpeech.ts`) unless the bubble names a speech provider (see Providers); the microphone
  is decoded, resampled to 16 kHz and counted (`frames_heard`, `heard_ms`) and handed to an `InputSink`;
* one current connection per person: a newer epoch replaces the older one, anything still addressed to the old one
  is dropped (`stale_dropped`);
* in a LiveKit bubble, one `@livekit/rtc-node` participant per bot session (`src/roomTransport.ts`) behind the same
  `OutputTarget` / `InputSink` pair: it joins with the token the game made for the bot's own identity (microphone
  only), with automatic subscription off, subscribes only to the microphone of the people the bot server names, and
  publishes one microphone track with the bot's voice;
* one authoritative path: every path (a person's connection or the room) has an epoch from one counter, the newest
  wins. A room replaces every older connection, a newer connection replaces an older room;
* if the worker is down the bot server tells people to disconnect from the bot and the bot stays text-only; when it is
  back the bot server asks the people who were connected for a new offer and re-joins the room.

Known limit: the bot's voice in a LiveKit room is one track that everyone in the room can hear. The worker cannot hold
it back from one listener (a media-server token cannot limit what a participant subscribes to, so it is the worker
that limits what the bot subscribes to).

Recognition (#1664) plugs into `InputSink` (`src/transport.ts`) through `src/recognition.ts` and a recognizer (`src/recognizer.ts`) made per bubble.

### Providers (#1747)

A bubble names its own hearing and speaking provider in `session.open` (`recognition`, `speech`, `expression`; see
`PROTOCOL.md`, Providers). The worker looks each adapter name up in a registry (`src/connectors.ts`), so two bubbles can
use two different providers at once. Built in: the test engine, `FakeSpeech` (registered as `fake`, and what a bubble
that names nothing gets) and the scripted `FakeEars` for tests, plus these real providers (#1748, one change each):

* `soniox` (hearing, `src/soniox.ts`): one real-time WebSocket stream per stretch of speech to
  `wss://stt-rt.soniox.com/transcribe-websocket` (or the profile's `endpoint`), the key in the `Authorization` header only,
  16 kHz mono `s16le`, the profile's `model`, and its `language` (the plain code, "ar" for "ar-KW") as the only language
  hint when it fixes one. A model Soniox has retired or deprecated (`stt-rt-v5`, removed 15 Dec 2026, its alias
  `stt-rt-v4`, and older) listens with the current `stt-rt-v6`. Soniox's own end-of-speech detection is on, with the
  starting point Soniox recommends for voice AI (`max_endpoint_delay_ms` 1500, latency level 2, sensitivity 0.3; the last
  two from v5 on): when it hears the person finish (its `<end>` token) the stretch ends at once, and the worker's own
  quiet timer waits 1.8 s instead of 0.8 s as a fallback, so a mid-sentence pause is not cut. Partial words
  are the final tokens so far plus the latest guesses; when the stretch ends an empty text frame ends the audio and the
  words are final on Soniox's `finished`. A refused key (401/403), an error answer (its `error_code`), a dropped stream or
  no `finished` within `VOICE_RECOGNITION_FINAL_TIMEOUT_SECONDS` (default 10) fails the turn with the words heard so far.
* `elevenlabs` (speaking, `src/elevenlabs.ts`): one connection per reply to `https://api.elevenlabs.io` (or the profile's
  `endpoint`), the key in the `xi-api-key` header only, raw 24 kHz PCM that plays as it arrives. How each model is asked
  comes from one table of ElevenLabs' documented models (`ELEVENLABS_MODELS`, #1847). The superseded Turbo v2 ids speak
  with the Flash model ElevenLabs replaced them with. The real-time v3 and v4 models (`eleven_v4_turbo`,
  `eleven_v3_conversational`) are served only over the Text to Dialogue WebSocket (`/v1/text-to-dialogue/stream-input`):
  the socket is opened and set up (voice, settings) as soon as someone in the bubble starts talking, kept alive while it
  waits and closed after 45 s unused, so the reply does not wait for a connection; the reply is the whole text then
  `close_socket`, which flushes it, and the socket closes at once when the reply is no longer wanted. Text normalization is
  on there, so numbers, dates and amounts are read as words (the reply's text is also what the chat shows). Every other
  model streams over `POST /v1/text-to-speech/{voiceId}/stream?output_format=pcm_24000`. The reply's language goes
  as `language_code` to every model but the old ones that refuse it (multilingual v1/v2 and the English-only ones); a
  model newer than the table gets it too, since ElevenLabs ignores a code a model cannot use. Expression: `restrained`
  sends stability 0.75, `expressive` 0.3 (on v3, which takes only 0, 0.5 or 1: 1 Robust and 0 Creative), `natural`
  nothing (the voice's saved settings). A refusal fails with ElevenLabs' status (a WebSocket error answer maps its id to
  the status the same failure has over HTTP); an unreachable server or a dropped stream fails without one.
* `cartesia` (speaking, `src/cartesia.ts`): one streamed `POST /tts/bytes` per reply to `https://api.cartesia.ai` (or the
  profile's `endpoint`), the key in the `Authorization: Bearer` header only, `Cartesia-Version` from `VOICE_CARTESIA_VERSION`,
  the profile's `model` as `model_id` and voice as `voice.id`, asking for raw `pcm_s16le` at 24 kHz, which plays as it arrives.
  The reply's language goes as `language` (base code, such as `ar`). Expression: `restrained` sends `generation_config.emotion`
  `calm` (Sonic 3 and newer only); `natural` and `expressive` send nothing, so Cartesia reads the emotion from the words. A
  refusal fails with Cartesia's status; an unreachable server or a dropped stream fails without one.
* `fish` (speaking, `src/fish.ts`): one streamed `POST /v1/tts` per reply to `https://api.fish.audio` (or the profile's
  `endpoint`), the key in the `Authorization: Bearer` header only, the profile's `model` in the `model` header (`s2.1-pro`, or
  the free `s2.1-pro-free`) and its voice as `reference_id`, asking for `pcm` at 24 kHz with `latency: balanced`, which plays as it
  arrives. A 44-byte WAV header at the start of the stream, if Fish sends one, is skipped. The reply's language goes as `language`
  (base code, such as `ar`; Fish uses it only to read numbers and dates aloud). No expression is sent. A refusal fails with Fish's
  status (401 a wrong key, 402 no credit, 429 too many at once); an unreachable server or a dropped stream fails without one.
* `deepgram` (hearing, `src/deepgram.ts`): one real-time WebSocket stream per stretch of speech to
  `wss://api.deepgram.com/v1/listen` (or the profile's `endpoint`), the key in the `Authorization` header only
  (`Token <key>`), 16 kHz mono `linear16`, the profile's `model` (`nova-3` when it names none) and its `language` when it
  fixes one (otherwise Deepgram's own default applies). Deepgram's own end-of-speech cutting is off: the worker decides where
  speech ends. Partial words are the final segments so far plus the latest guess; when the person pauses a `CloseStream`
  message ends the audio and the words are final once Deepgram has sent its last answer (`Metadata`) or closed the stream
  normally. A refused key (401/403), an `Error` answer, a stream closed any other way or no last answer within
  `VOICE_RECOGNITION_FINAL_TIMEOUT_SECONDS` (default 10) fails the turn with the words heard so far.

To add a provider, write one file that implements a connector and register it by its lowercase adapter name:

```ts
// src/connectors/elevenlabs.ts (example)
export const elevenlabs: SpeechConnector = {
    // Yield 24 kHz mono s16 audio in chunks, as the provider produces it. Throw ProviderError(message, httpStatus?) on failure.
    async *speak({ text, settings, lang, expression, signal }) { /* fetch with settings.key.reveal(), pass `signal`, yield chunks */ },
};
// registry.registerSpeech('elevenlabs', elevenlabs);
```

A `RecognitionConnector` has `listen(settings, events)` and returns a `Recognizer` (push 16 kHz audio, `finish()`, `close()`), answering
through `events.partial`, `events.final` and `events.failed(text, { status })`.

What the worker does around a connector, so it does not have to:

* speech is played as it arrives (the first chunk plays at once), barge-in, the reply's `maxMs` and `VOICE_MAX_REPLY_SECONDS` still
  apply, and the provider call is aborted through `signal` when the reply is cut;
* an unknown adapter, a throw, a dropped stream or a provider that goes quiet ends that turn in text with reason `provider`;
* each call's outcome goes back to the bot server as `provider.ok` / `provider.failed` (`part`, `adapter`, the HTTP `status` when
  there was one, `rejected: true` when the key itself was refused), for it to forward to Orbit's health endpoint;
* the key arrives as a `Secret` and is never logged, counted, or put in a report; it is sent only to the provider it belongs to, in that provider's request.

## Run

```
npm ci
npm start          # ws://127.0.0.1:8830/bridge, GET /health, GET /stats
npm test           # unit + integration tests, fake speech, loopback only
npm run typecheck
```

`GET /stats` (behind `VOICE_WORKER_SECRET`) gives `connections`, `sessions`, `lanes` (audio connections, a LiveKit
room counting as one), `maxLanes` (`VOICE_MAX_LANES`), `peakLanes` (since the worker started), `cpuPercent` (this
process's share of one core, averaged over the last minute; reading it changes nothing), `memoryMb`, `uptimeSeconds` and the `counters`, among them
`lanes_refused` and `sessions_refused` for those turned away because the worker was full. The bot server reads it every
minute for its load events and warnings (game #1751).

### LiveKit tests

`test/livekit.test.ts` runs against a real local `livekit-server` and is skipped when none answers on
`LIVEKIT_HTTP_URL` (default `http://127.0.0.1:7880`; keys `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, default `devkey` /
`secret-secret-secret-secret-12345`):

```
GOBIN=$PWD/bin go install github.com/livekit/livekit-server/cmd/server@v1.8.4
printf 'port: 7880\nbind_addresses: ["127.0.0.1"]\nrtc:\n  tcp_port: 7881\n  udp_port: 7882\n  use_external_ip: false\n  node_ip: 127.0.0.1\nkeys:\n  devkey: secret-secret-secret-secret-12345\n' > livekit.yaml
./bin/server --config livekit.yaml &
npm test
```

## Settings (environment, all optional)

| Variable | Default | |
|---|---|---|
| `VOICE_WORKER_PORT` | `8830` | |
| `VOICE_WORKER_HOST` | `127.0.0.1` | The Dockerfile sets `0.0.0.0`. |
| `VOICE_WORKER_SECRET` | none | Bearer token the bot server must present. Required whenever `VOICE_WORKER_HOST` is not a loopback address (the Docker image listens on `0.0.0.0`): the worker refuses to start without it. |
| `VOICE_MAX_LANES` | `200` | Audio connections alive at once. Over it, new ones are refused. |
| `VOICE_MAX_SESSIONS_PER_BOT` | `64` | Bubbles one bot may have open. |
| `VOICE_MAX_UTTERANCE_SECONDS` | `180` | The longest stretch of one person's speech taken, in seconds of audio. Past it the words are offered back to them, never sent. |
| `VOICE_MAX_REPLY_SECONDS` | `60` | The longest one spoken reply plays, whatever the bot server asks (it asks for its own, up to this). |
| `VOICE_SPEECH_TIMEOUT_SECONDS` | `15` | The longest a speech provider may go without sending the next piece of a reply's audio before the call counts as failed. |
| `VOICE_RECOGNITION_FINAL_TIMEOUT_SECONDS` | `10` | The longest a hearing provider may take for a person's last words after they paused before the call counts as failed. |
| `VOICE_BARGE_IN_MS` | `100` | Speech this long, from a person the bot hears, stops the bot's voice. A click or a cough is shorter. |
| `VOICE_CARTESIA_VERSION` | `2026-08-14` | The `Cartesia-Version` every Cartesia request names. Change it only together with `src/cartesia.ts`. |
| `VOICE_ICE_SERVERS` | Google STUN | JSON list of STUN/TURN servers, like the game's. |
| `VOICE_ICE_PORT_RANGE` | any | `40000-40100`: the UDP ports to open on the host. |
| `VOICE_PUBLIC_IP` | none | Public address(es) of the host when it is behind a NAT. |

The bot server reads `VOICE_WORKER_URL` (default `ws://127.0.0.1:8830`) and the same `VOICE_WORKER_SECRET`.
