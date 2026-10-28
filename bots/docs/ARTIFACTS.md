# Live artifacts (game #1422, Orbit #622)

Bots make mini apps, pages, Markdown documents and SVG drawings for the person they are talking to, change them with small
edits, and read them back. Orbit keeps the list, every version and who may open or change each one (see
`docs/bots/ARTIFACTS.md` in the Orbit repo); the bot server only calls Orbit and puts a card in the chat.

## Turning it on

Off unless `BOT_ARTIFACTS_ENABLED=true` on the bot server (and Orbit set up with `ARTIFACTS_S3_*`). Off, a bot answers in
words as before. Turn it on once Orbit and the game have the artifact release, so a card is never sent to a game that
cannot draw it.

## Tools (`ai/ArtifactTools.ts`)

| Tool | What |
| --- | --- |
| `make_artifact` | `title`, `kind` (`app`, `page`, `markdown`, `svg`), `content`, `summary?`. Version 1. |
| `change_artifact` | `id`, `edits: [{ old, new, all? }]` or `content`, `summary?`, `title?`, `baseVersion?`. A new version. |
| `read_artifact` | `id`, `version?`. The text, as data (never instructions). |
| `list_artifacts` | The artifacts made in this chat, plus the asking person's own from their other chats, newest change first. How a bot finds the one a later message means. |

The tools go to Orbit with the person (`signedIn`, `identifier`, `name`) and the chat the message came in. Orbit runs the same
access check as `/api/bots/:id/access`, so someone who cannot chat with the bot makes nothing. Tool results hold no file
address and no code the bot would paste (read excepted), so the media interceptors never send them as media. Bot chat
telemetry works as for any chat text: a bot that hides its chats sends none of it to PostHog or Sentry.

## The card

A made or changed artifact puts a card in the chat the message came from:

- **Nearby chat** carries text only. The line is `::artifact:<id>:<version>:<kind>::<title>` (`artifactMarker`). The game draws it as
  a card (APP badge, title, "Mini app · Version N · Tap to open"); any other reader sees the title.
- **Direct message** (Matrix): an `m.text` message whose body is "Title · Mini app · Version N" and whose `universe.artifact`
  field is `{ id, version, title, kind, maker }`, as `universe.room_link` does for a room. It is sent after the reply text.

The chat Orbit stores with the artifact is `{ kind: "nearby", ref: <the bubble's space name> }` or
`{ kind: "dm", ref: <the Matrix room id> }`; the game names the same refs when it asks Orbit who may open it.
