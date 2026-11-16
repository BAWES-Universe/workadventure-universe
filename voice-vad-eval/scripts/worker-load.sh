#!/bin/sh
# The whole voice worker under load, observer off and on, in the worker's own base image with its memory cap.
#   scripts/worker-load.sh <data dir> <out dir> [seconds per run, default 180]
# Needs Docker, the three installs the worker's tests need (voice-worker, bots, messages with ts-proto built) and, for the
# room runs, a livekit-server on 127.0.0.1:7880 with the dev keys the worker's tests use.
# RUNS picks what to run, as path:people[:off|on], path being lane (proximity WebRTC) or room (LiveKit):
#   RUNS="lane:5:on room:20" scripts/worker-load.sh data out/worker-load
set -eu
DATA=$1; OUT=$2; SECONDS_PER_RUN=${3:-180}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=node:22-bookworm-slim
CPUS=${CPUS:-1}
RUNS=${RUNS:-"lane:0 lane:1 lane:5 lane:20 room:5 room:20"}
mkdir -p "$OUT"
docker image inspect --format '{{index .RepoDigests 0}}' $IMAGE > "$OUT/image.txt" 2>/dev/null || docker pull -q $IMAGE > "$OUT/image.txt"
run() { # name observer(0|1) people path
  name=$1; observer=$2; streams=$3; path=$4
  docker rm -f worker-load >/dev/null 2>&1 || true
  docker run -d --name worker-load --network host --memory=512m --memory-swap=512m --cpus="$CPUS" \
    -v "$REPO":/repo:ro -v "$DATA":/data:ro -v "$OUT":/out -w /repo/voice-vad-eval \
    -e VOICE_WORKER_PORT=8830 -e ORT_DISABLE_TELEMETRY=1 -e LOAD_SUMMARY="/out/$name.worker.json" -e LOAD_TRACE="/out/$name.memory.tsv" \
    $( [ "$observer" = 1 ] && echo "-e VOICE_SPEECH_OBSERVER=1 -e VOICE_SPEECH_OBSERVER_MODEL=/data/silero_vad_v6.2.3.onnx -e VOICE_SPEECH_OBSERVER_RUNTIME=/repo/voice-vad-eval/node_modules/onnxruntime-node" ) \
    $IMAGE node --import tsx src/worker-under-load.ts >/dev/null
  for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8830/health >/dev/null 2>&1 && break; sleep 0.5; done
  sleep 3
  # The measured stretch starts once everyone is in and ends before the load does: USR2 starts it and USR1 ends it, for
  # the worker and the load generator at the same moments, so what was heard can be set against what was sent
  if [ "$streams" = 0 ]; then
    docker kill -s USR2 worker-load >/dev/null 2>&1 || true; sleep 20
  else
    : > "$OUT/$name.load.log"
    node --import tsx src/load.ts ws://127.0.0.1:8830 "$DATA" "$streams" "$SECONDS_PER_RUN" "$OUT/$name.load.json" "$path" 2> "$OUT/$name.load.log" &
    LOAD=$!
    for i in $(seq 1 360); do grep -q 'people connected' "$OUT/$name.load.log" && break; sleep 0.5; done
    sleep 5
    docker kill -s USR2 worker-load >/dev/null 2>&1 || true; kill -USR2 $LOAD 2>/dev/null || true
    sleep $((SECONDS_PER_RUN - 20))
    kill -USR1 $LOAD 2>/dev/null || true
  fi
  # A worker that did not last the run (killed for memory, say) leaves no summary; how it ended is kept either way
  docker kill -s USR1 worker-load >/dev/null 2>&1 || true; sleep 1
  [ "$streams" = 0 ] || wait $LOAD || true
  docker inspect worker-load --format 'running={{.State.Running}} oom_killed={{.State.OOMKilled}} exit_code={{.State.ExitCode}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' > "$OUT/$name.container.txt" 2>&1 || true
  docker logs worker-load 2>&1 | grep -v '"name":"lk-rtc"' > "$OUT/$name.worker.log" || true
  docker stop -t 5 worker-load >/dev/null 2>&1 || true
  docker rm -f worker-load >/dev/null 2>&1 || true
  echo "done: $name"
}
cd "$REPO/voice-vad-eval"
for spec in $RUNS; do
  path=${spec%%:*}; rest=${spec#*:}; streams=${rest%%:*}; only=${rest#"$streams"}; only=${only#:}
  prefix=""; [ "$path" = room ] && prefix="room-"
  [ "$only" = on ] || run "${prefix}off-$streams" 0 "$streams" "$path"
  [ "$only" = off ] || run "${prefix}on-$streams" 1 "$streams" "$path"
done
