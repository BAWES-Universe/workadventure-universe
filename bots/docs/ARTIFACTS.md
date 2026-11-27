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

With an Orbit that keeps files in bot chats (#1508), `list_artifacts` leaves the tool list and `find_files` finds artifacts
instead, along with files, a page at a time: this chat's, and the person's own from any chat with any bot. A history
that still calls `list_artifacts` keeps working.

The tools go to Orbit with the person (`signedIn`, `identifier`, `name`) and the chat the message came in. Orbit runs the same
access check as `/api/bots/:id/access`, so someone who cannot chat with the bot makes nothing. Tool results hold no file
address and no code the bot would paste (read excepted), so the media interceptors never send them as media. Bot chat
telemetry works as for any chat text: a bot that hides its chats sends none of it to PostHog or Sentry.

## A file is not an artifact (`ai/MakeFileTool.ts`)

An artifact lives in the chat window: a mini app, a page, a Doc (`kind: markdown`) or a drawing. A person who asks for a *file*
("send me a markdown", "give me a sheet") gets a real one from `make_file`, which sends the normal chat file card (it opens beside
the map and has Download); `make_artifact`'s description says so, while `make_file` is offered, and the Brick rules say a Doc is
"a Doc in this chat" and a file is "a Markdown file (.md)" or "a spreadsheet file (.xlsx)".

| Tool | What |
| --- | --- |
| `make_file` | `name`, `format` (`md`, `csv`, `xlsx`), then `content` (md), `rows` (csv, or xlsx with one tab) or `sheets: [{ name, rows }]` (xlsx, one tab each). |

- Offered where the bot has a chat to send in (a bubble or a direct message) and the uploader is set up (`UPLOADER_URL` and
  `BOT_SERVICE_TOKEN`). It is the owner's: a visitor's turn on someone's Brick is neither offered it nor runs it. It needs no Orbit call. The file goes to the uploader and is sent as a file the person asked for, so it is
  on their list of files like any file the bot sends (made with `make_file`).
- Cells are plain text, never formulas: in an `.xlsx` every cell is typed as text, and in a `.csv` a cell that begins with `=`, `+`,
  `-` or `@` gets a leading quote so a sheet app does not run it. A CSV starts with a byte order mark and ends rows with CRLF, so
  Arabic and accents open right.
- Tab names are made valid: no `\ / ? * [ ] :`, 31 characters at most, no apostrophe at either end after the cut, "History" renamed
  (`History 1`), unique without regard to case, a blank one becomes `Sheet N`.
- Limits: 8 MB a file (under the uploader's 10 MB), 250,000 cells, 50 tabs, 32,767 characters a cell. Over them the model is told it is
  too big for a chat file and to offer to split it; a failure says nothing was sent. The result never holds the file's address.
- Made once a turn: the same call twice, or the turn asked again, sends one file.

## The card

A made or changed artifact puts a card in the chat the message came from:

- **Nearby chat** carries text only. The line is `::artifact:<id>:<version>:<kind>::<title>` (`artifactMarker`). The game draws it as
  a card (APP badge, title, "Mini app · Version N · Tap to open"); any other reader sees the title.
- **Direct message** (Matrix): an `m.text` message whose body is "Title · Mini app · Version N" and whose `universe.artifact`
  field is `{ id, version, title, kind, maker }`, as `universe.room_link` does for a room. It is sent after the reply text.

The chat Orbit stores with the artifact is `{ kind: "nearby", ref: <the bubble's space name> }` or
`{ kind: "dm", ref: <the Matrix room id> }`; the game names the same refs when it asks Orbit who may open it.
