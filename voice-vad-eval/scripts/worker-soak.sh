#!/bin/sh
# A long run of the BUILT worker image (not the repository's files) under its caps, with the speech observer off and
# on. One worker hears both paths at once: bubbles of several people on their own connections (proximity WebRTC) and
# LiveKit rooms of several people. People talk over each other, leave and come back, lose audio, and one at a time
# stops being heard for a moment (2 s on their own connection, 0.4 s in a room) while the rest of their bubble carries
# on; each bot speaks every ten seconds. At the end the worker is told to close with everyone still connected, and how
# long that took is kept.
#   scripts/worker-soak.sh <data dir> <out dir> [measured seconds, default 1800]
# By default the "on" run is followed by the "off" run on one port. To run them side by side, as the kept results were,
# start it twice into the same out dir:  RUNS=on PORT=8830 ...  and  RUNS=off PORT=8831 ...
# The image is used as built. What is added from outside: the measuring entry file (src/worker-under-load.ts, which
# starts the image's own worker code with scripted speech-to-text), and, for the "off" run, the engineers' off switch,
# VOICE_SPEECH_OBSERVER=0 (the image is on by default). Needs Docker, the image (IMAGE), and a livekit-server on 127.0.0.1:7880 with the worker's test keys.
set -eu
DATA=$1; OUT=$2; MEASURED=${3:-1800}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=${IMAGE:-voice-worker:observer-packaged}
CPUS=${CPUS:-1}; MEMORY=${MEMORY:-512m}
LANE_PEOPLE=${LANE_PEOPLE:-9}; ROOM_PEOPLE=${ROOM_PEOPLE:-6}; PER=${PEOPLE_PER_BUBBLE:-3}; MUTE=${MUTE_EVERY_S:-20}
# In a LiveKit room the mute lasts 0.4 s, not 2 s: today's worker does not hear a room person again when their microphone is
# taken back more than about a second after it was dropped (FOLLOWUP2.md, section 8), and that would leave the rooms half unheard
ROOM_MUTE_MS=${ROOM_MUTE_MS:-400}
RUNS=${RUNS:-"on off"}
# PORT lets two of these run side by side (one "on", one "off") against their own workers
PORT=${PORT:-8830}; NAME=worker-soak-$PORT
mkdir -p "$OUT"; chmod 777 "$OUT"
docker image inspect --format 'image {{.Id}} created {{.Created}}' "$IMAGE" > "$OUT/image-$PORT.txt"
echo "caps: memory $MEMORY, cpus $CPUS; people: $LANE_PEOPLE on their own connections, $ROOM_PEOPLE in LiveKit rooms, $PER to a bubble; measured $MEASURED s" >> "$OUT/image-$PORT.txt"
run() { # name, the switch (or nothing)
  name=$1; shift
  docker rm -f $NAME >/dev/null 2>&1 || true
  docker run -d --name $NAME --network host --memory="$MEMORY" --memory-swap="$MEMORY" --cpus="$CPUS" \
    -v "$REPO/voice-vad-eval/src/worker-under-load.ts":/soak/worker-under-load.mts:ro -v "$OUT":/out \
    -e WORKER_ROOT=/app -e VOICE_WORKER_PORT=$PORT -e VOICE_WORKER_HOST=127.0.0.1 \
    -e LOAD_SUMMARY="/out/$name.worker.json" -e LOAD_TRACE="/out/$name.trace.tsv" -e LOAD_SHUTDOWN="/out/$name.shutdown.json" \
    "$@" "$IMAGE" node --import tsx /soak/worker-under-load.mts >/dev/null
  for i in $(seq 1 60); do curl -fsS http://127.0.0.1:$PORT/health >/dev/null 2>&1 && break; sleep 0.5; done
  sleep 3
  : > "$OUT/$name.lane.load.log"; : > "$OUT/$name.room.load.log"
  LOAD_TAG=a$PORT PEOPLE_PER_BUBBLE=$PER MUTE_EVERY_S=$MUTE node --import tsx src/load.ts ws://127.0.0.1:$PORT "$DATA" "$LANE_PEOPLE" $((MEASURED + 900)) "$OUT/$name.lane.load.json" lane 2> "$OUT/$name.lane.load.log" &
  L1=$!
  LOAD_TAG=b$PORT PEOPLE_PER_BUBBLE=$PER MUTE_EVERY_S=$MUTE MUTE_FOR_MS=$ROOM_MUTE_MS node --import tsx src/load.ts ws://127.0.0.1:$PORT "$DATA" "$ROOM_PEOPLE" $((MEASURED + 900)) "$OUT/$name.room.load.json" room 2> "$OUT/$name.room.load.log" &
  L2=$!
  for i in $(seq 1 360); do grep -q 'people connected' "$OUT/$name.lane.load.log" && grep -q 'people connected' "$OUT/$name.room.load.log" && break; sleep 0.5; done
  sleep 10
  # The measured stretch starts and ends at the same moments for the worker and both generators
  docker kill -s USR2 $NAME >/dev/null 2>&1 || true; kill -USR2 $L1 $L2 2>/dev/null || true
  date -u +"measured from %FT%TZ" > "$OUT/$name.times.txt"
  sleep "$MEASURED"
  kill -USR1 $L1 $L2 2>/dev/null || true; docker kill -s USR1 $NAME >/dev/null 2>&1 || true
  date -u +"measured to %FT%TZ" >> "$OUT/$name.times.txt"
  sleep 2
  # Closing with everyone still connected and still talking
  docker kill -s TERM $NAME >/dev/null 2>&1 || true
  timeout 60 docker wait $NAME > "$OUT/$name.exit.txt" 2>&1 || echo "did not exit within 60 s" > "$OUT/$name.exit.txt"
  date -u +"closed by %FT%TZ" >> "$OUT/$name.times.txt"
  docker inspect $NAME --format 'running={{.State.Running}} oom_killed={{.State.OOMKilled}} exit_code={{.State.ExitCode}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' > "$OUT/$name.container.txt" 2>&1 || true
  docker logs $NAME 2>&1 | grep -v '"name":"lk-rtc"' | tail -200 > "$OUT/$name.worker.log" || true
  kill $L1 $L2 2>/dev/null || true; wait $L1 $L2 2>/dev/null || true
  docker rm -f $NAME >/dev/null 2>&1 || true
  echo "done: $name"
}
cd "$REPO/voice-vad-eval"
for which in $RUNS; do
  if [ "$which" = on ]; then run soak-on -e VOICE_SPEECH_OBSERVER=1; else run soak-off -e VOICE_SPEECH_OBSERVER=0; fi
done
