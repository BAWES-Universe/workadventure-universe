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
use two different providers at once. Only the test engine is built in: `FakeSpeech` (registered as `fake`, and what a bubble
that names nothing gets) and the scripted `FakeEars` for tests. No real provider is wired yet; each one is a later change.

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
* the key arrives as a `Secret` and is never logged, counted, or sent anywhere.

## Run

```
npm ci
npm start          # ws://127.0.0.1:8830/bridge, GET /health, GET /stats
npm test           # unit + integration tests, fake speech, loopback only
npm run typecheck
```

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
| `VOICE_WORKER_SECRET` | none | Bearer token the bot server must present. Set it whenever the port is reachable by others. |
| `VOICE_MAX_LANES` | `200` | Audio connections alive at once. Over it, new ones are refused. |
| `VOICE_MAX_SESSIONS_PER_BOT` | `64` | Bubbles one bot may have open. |
| `VOICE_MAX_UTTERANCE_SECONDS` | `180` | The longest stretch of one person's speech taken, in seconds of audio. Past it the words are offered back to them, never sent. |
| `VOICE_MAX_REPLY_SECONDS` | `60` | The longest one spoken reply plays, whatever the bot server asks (it asks for its own, up to this). |
| `VOICE_SPEECH_TIMEOUT_SECONDS` | `15` | The longest a speech provider may go without sending the next piece of a reply's audio before the call counts as failed. |
| `VOICE_BARGE_IN_MS` | `100` | Speech this long, from a person the bot hears, stops the bot's voice. A click or a cough is shorter. |
| `VOICE_ICE_SERVERS` | Google STUN | JSON list of STUN/TURN servers, like the game's. |
| `VOICE_ICE_PORT_RANGE` | any | `40000-40100`: the UDP ports to open on the host. |
| `VOICE_PUBLIC_IP` | none | Public address(es) of the host when it is behind a NAT. |

The bot server reads `VOICE_WORKER_URL` (default `ws://127.0.0.1:8830`) and the same `VOICE_WORKER_SECRET`.
