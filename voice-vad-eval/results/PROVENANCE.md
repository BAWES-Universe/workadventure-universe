# What produced the older result files, and what they do not say

These notes were written on 19 Nov 2026, after the results were taken. Nothing here was regenerated (that needs Docker,
the data set and a livekit-server, none of which were available when the notes were written), and no number in any
result file was edited. Each line says what the repository's history shows and where it stops. Where a file does not say
which build made it, the nearest evidence is named as evidence, not as a fact.

From the next run on, the tools write what these files lack (see "What new runs record" at the end).

## `room-rehear.jsonl` and `room-rehear-with-fix.jsonl`

- Neither file records the worker build. `src/room-rehear.ts` ran the repository's own `voice-worker/` files in a test rig
  (no image), so there is no `image.txt` for them either.
- `room-rehear.jsonl` was committed in 9844632e8 (11 Nov 2026, 13:23 UTC). `voice-worker/src/roomTransport.ts` at that commit
  has no re-subscribe handling (no `room_resubscribe_*` counters). The file is the "without the fix" side.
- `room-rehear-with-fix.jsonl` was committed in 3a0c82e6a (11 Nov 2026, 14:03 UTC, "hear a LiveKit person again", #2011), the
  commit that added the re-subscribe handling to `voice-worker/src/roomTransport.ts`. It is the "with the fix" side. That the
  records were made with exactly the files of that commit is the likely reading of the history, but the files themselves do not
  prove it.
- Both predate the fields `workerResubscribeRetries` and `workerResubscribeGaveUp` (the worker's `room_resubscribe_retries`
  and `room_resubscribe_gave_up` counters). They are not in any record of these two files. "Subscribed again" and the seconds
  heard are measured; how many re-subscribe tries the worker made, and whether it gave up, are not recorded.

## `worker-load/`

Written with `src/worker-under-load.ts` as it was in 3e6a768dd (11 Nov 2026) for the files named below: the `heard` object of
these files has exactly the keys that version wrote (`frames`, `speechTurns`, `lanesConnected`, `lanesClosed`). The later
versions (6ecffb2e9 and on) also write `heard.ms`, `heard.bargeIns`, `heard.roomsConnected` and `heard.roomsClosed`.

- `off-1.worker.json`: the older shape. It has no `ms`, `bargeIns`, `roomsConnected` or `roomsClosed`, and no key says which
  harness revision wrote it. A proximity-WebRTC run has no room connections, so no room figures are missing in substance, but
  `heard.ms` and `heard.bargeIns` were not recorded.
- `room-off-5.worker.json`, `room-off-10.worker.json`: the older shape too. Their `lanesConnected` and `lanesClosed` are 0
  because these are room runs; the room counts (`roomsConnected`, `roomsClosed`) were not recorded, and 0 lane counts must not
  be read as room counts. `heard.ms` and `heard.bargeIns` are missing as well.
- Every `*.worker.json` in `worker-load/` and in `worker-load-first-build/` (checked: all 12 and all 8) has the older shape,
  so the gap is the same for all of them. The table script (`scripts/worker-load-table.py`) now lists the runs whose measured
  stretch is not on record.
- `room-on-10.worker.json` against `room-on-10.load.json`: the worker's `heard.frames` is 158,767 and the generator's
  `measured.sent` is 158,342, a difference of 425 frames (about 4.25 s of 10 ms frames). The worker and the generator each
  count over a stretch they mark for themselves (SIGUSR2 starts it and SIGUSR1 ends it). In the script that made these files,
  the worker was signalled first at the start (`docker kill`, then the generator) and the generator first at the end (then the
  worker), and the files record no start or end time for either process. So the two stretches are not known to be the same.
  **Heard and sent are not directly comparable for these older runs**, which is also why several room rows show heard above
  100% of sent. The cause of the 425 frames is not established by these records.

## `worker-soak/`

- `soak-off.shutdown.json` and `soak-on.shutdown.json` keep `closeMs`, `sessionsAtClose`, `lanesAtClose` and the observer's
  state. The worker is told to close (TERM) while the load generators are still running. The number of sessions and of own
  (proximity) connections open at that moment is recorded; **the connection state of each person in a LiveKit room at that
  moment is not**. The old table label "closing with everyone still connected" claimed more than that and has been changed.

## What new runs record

- `src/room-rehear.ts`: every record has `workerBuild` (the commit of the repository, how many files under `voice-worker/` differ
  from it, and the image id when `WORKER_BUILD` names one), `workerResubscribeRetries` and `workerResubscribeGaveUp`.
- `scripts/worker-load.sh` and `scripts/worker-soak.sh` pass `HARNESS_REVISION` (the commit, with `+changes` when files under
  `voice-vad-eval/` or `voice-worker/` differ from it); it is written into the worker's summary and the generators' files.
- The worker's summary has `measuredFrom` and `measuredTo`, and each generator's `measured` has `from` and `to` (UTC). The
  table script says in which runs the two stretches are not on record or differ by more than a second.
- The soak table label and the comment in `scripts/worker-soak.sh` say what is recorded: sessions and own connections open when
  the close began, not each room person's state.
