# Voice worker

A separate service that gives a voice bot an audio-only connection with each person in its bubble. The bot server
(`bots/`) talks to it over a WebSocket bridge (see `PROTOCOL.md`); it never carries people's own calls to each other.

What it does today (issue #1663, transport only):

* one `werift` peer connection per person, Opus both ways, video and screen refused in the answer;
* bot speech is a generated tone (`src/fakeSpeech.ts`), the microphone is decoded, resampled to 16 kHz and counted
  (`frames_heard`, `heard_ms`) and handed to an `InputSink`; no speech provider, no keys;
* one current connection per person: a newer epoch replaces the older one, anything still addressed to the old one
  is dropped (`stale_dropped`);
* if the worker is down the bot server tells people to disconnect from the bot and the bot stays text-only.

Recognition (#1664) plugs into `InputSink` (`src/transport.ts`); speaking (#1665) replaces `FakeSpeech`. A LiveKit
adapter (a `@livekit/rtc-node` participant per bot session) implements the same `OutputTarget` / `InputSink` pair.

## Run

```
npm ci
npm start          # ws://127.0.0.1:8830/bridge, GET /health, GET /stats
npm test           # unit + integration tests, fake speech, loopback only
npm run typecheck
```

## Settings (environment, all optional)

| Variable | Default | |
|---|---|---|
| `VOICE_WORKER_PORT` | `8830` | |
| `VOICE_WORKER_HOST` | `127.0.0.1` | The Dockerfile sets `0.0.0.0`. |
| `VOICE_WORKER_SECRET` | none | Bearer token the bot server must present. Set it whenever the port is reachable by others. |
| `VOICE_MAX_LANES` | `200` | Audio connections alive at once. Over it, new ones are refused. |
| `VOICE_MAX_SESSIONS_PER_BOT` | `64` | Bubbles one bot may have open. |
| `VOICE_ICE_SERVERS` | Google STUN | JSON list of STUN/TURN servers, like the game's. |
| `VOICE_ICE_PORT_RANGE` | any | `40000-40100`: the UDP ports to open on the host. |
| `VOICE_PUBLIC_IP` | none | Public address(es) of the host when it is behind a NAT. |

The bot server reads `VOICE_WORKER_URL` (default `ws://127.0.0.1:8830`) and the same `VOICE_WORKER_SECRET`.
