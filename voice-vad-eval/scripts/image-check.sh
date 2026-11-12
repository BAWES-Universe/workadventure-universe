#!/usr/bin/env bash
# Checks on the BUILT worker image, started by its own command (src/main.ts), with the speech observer switched off,
# switched on, and switched off again:
#   1. the detector as the image holds it answers with no network at all (speech-observer/check.mts);
#   2. where the whole worker reaches on the network, off and on, traced from outside the container with strace on
#      every thread from before node starts: anything the "on" run reaches that the "off" run does not is the observer's;
#   3. the switch: on = started with VOICE_SPEECH_OBSERVER=1, off = started without it. Off, the worker has no observer,
#      no observer counters, and the runtime's native library is not even loaded into the process;
#   4. the safety catch: switched on but with the runtime's reporting not suppressed, the worker runs as today and the
#      observer stays off;
#   5. with YIELD=1, the limited owner rollout of the pause: on with VOICE_YIELD_BOTS naming every load bot, then the
#      switch-off procedure (the same container settings without VOICE_YIELD_BOTS, restarted): no pause counters move.
# Each run hears two people on their own connections and two in a LiveKit room for a while, then idles.
#   scripts/image-check.sh <data dir> <out dir> [seconds of audio, default 20] [idle seconds, default 75]
# Needs Docker, the image (IMAGE), strace, root, and a livekit-server on 127.0.0.1:7880 with the worker's test keys.
set -uo pipefail
cd "$(dirname "$0")/.."
DATA="$1"; OUT="$2"; TALK="${3:-20}"; IDLE="${4:-75}"; IMAGE="${IMAGE:-voice-worker:observer-packaged}"; PORT=8832
mkdir -p "$OUT/go"; chmod 777 "$OUT" "$OUT/go"
docker image inspect --format 'image {{.Id}} created {{.Created}}' "$IMAGE" > "$OUT/image.txt"
echo "== 1. the detector in the image, no network"
docker run --rm --network none "$IMAGE" node --import tsx speech-observer/check.mts | tee "$OUT/detector-check.json"
run() { # name, extra docker args...
    local name="$1"; shift
    rm -f "$OUT/go/now"; docker rm -f image-check >/dev/null 2>&1
    # The container waits for a file before it becomes the image's own command, so the trace starts before node does
    docker run -d --name image-check --network host --memory=512m --memory-swap=512m --cpus=1 -v "$OUT/go":/go:ro \
        -e VOICE_WORKER_HOST=127.0.0.1 -e VOICE_WORKER_PORT=$PORT "$@" --entrypoint sh "$IMAGE" \
        -c 'while [ ! -e /go/now ]; do sleep 0.1; done; exec node --import tsx src/main.ts' >/dev/null
    local pid; pid=$(docker inspect -f '{{.State.Pid}}' image-check)
    strace -f -qq -s 256 -e trace=connect,sendto,sendmsg,sendmmsg -o "$OUT/$name.full.strace" -p "$pid" 2> "$OUT/$name.strace.err" &
    local tracer=$!
    sleep 1; touch "$OUT/go/now"
    for _ in $(seq 1 120); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
    LOAD_TAG=x PEOPLE_PER_BUBBLE=2 npx tsx src/load.ts "ws://127.0.0.1:$PORT" "$DATA" 2 "$TALK" "$OUT/$name.lane.load.json" lane > /dev/null 2>&1 &
    local lane=$!
    LOAD_TAG=y PEOPLE_PER_BUBBLE=2 npx tsx src/load.ts "ws://127.0.0.1:$PORT" "$DATA" 2 "$TALK" "$OUT/$name.room.load.json" room > /dev/null 2>&1 &
    local room=$!
    wait "$lane" "$room" 2>/dev/null
    sleep "$IDLE"
    curl -fsS "http://127.0.0.1:$PORT/stats" > "$OUT/$name.stats.json" 2>/dev/null || echo '{}' > "$OUT/$name.stats.json"
    # Whether the runtime's native library is in the worker's memory at all
    local loaded; loaded=$(grep -c 'onnxruntime' "/proc/$pid/maps" 2>/dev/null || true)
    docker logs image-check > "$OUT/$name.log" 2>&1
    docker stop -t 10 image-check >/dev/null 2>&1; wait "$tracer" 2>/dev/null; docker rm -f image-check >/dev/null 2>&1
    # What is kept: every network call that is not to this machine itself (loopback, or an address of its own
    # interfaces), and what was written to a connected socket (that is where a name lookup shows the name it asks for).
    # Media packets on connected sockets are in there too, so only strings shaped like a host name count as names
    local own; own=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep . | sed 's/\./\\./g' | paste -sd'|')
    grep -aE 'AF_INET6?|sendto\([0-9]+, .*, NULL, 0\)' "$OUT/$name.full.strace" | grep -avE "inet_addr\(\"(127\.[0-9.]+|0\.0\.0\.0${own:+|$own})\"\)|inet_pton\(AF_INET6, \"(::1|::ffff:127\.[0-9.]+)\"" > "$OUT/$name.strace" || true
    local total outside asked names summary
    total=$(grep -acE 'AF_INET6?' "$OUT/$name.full.strace" || true)
    outside=$(grep -acE 'AF_INET6?' "$OUT/$name.strace" || true)
    asked=$(grep -aoE '\\[0-9]{1,3}[a-z0-9-]+(\\[0-9]{1,3}[a-z0-9-]+)+\\0' "$OUT/$name.strace" | sed -E 's/\\[0-9]{1,3}/./g; s/^\.//; s/\.$//' | grep -E '^([a-z0-9-]+\.)+[a-z]{2,}$' | sort | uniq -c | sed -E 's/^ +//' | paste -sd',' || true)
    names=$(grep -aoiE '(microsoft|visualstudio|applicationinsights|events\\[0-9]+data)[a-z0-9.\\-]*' "$OUT/$name.full.strace" | sort -u | tr '\n' ' ' || true)
    summary=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const c=s.counters??{};const o=Object.keys(c).filter((k)=>k.startsWith("observer_"));const y=Object.keys(c).filter((k)=>k.startsWith("yield_")&&c[k]);console.log(`observer in /stats: ${s.speechObserver?JSON.stringify(s.speechObserver):"none"}; observer counters: ${o.length}${o.length?` (loaded ${c.observer_loaded??0}, could not load ${c.observer_unavailable??0}, windows kept ${c.observer_windows_accepted??0}, errors ${c.observer_errors??0})`:""}; pause counters moved: ${y.length?y.map((k)=>`${k.slice(6)} ${c[k]}`).join(", "):"none"}; frames heard: ${c.frames_heard??0}`)' "$OUT/$name.stats.json" 2>/dev/null || echo "stats missing")
    echo "$name: traced threads and processes=$(cut -d' ' -f1 "$OUT/$name.full.strace" | sort -u | wc -l); network calls=$total, of them to anywhere but this machine=$outside; names looked up: ${asked:-none}; microsoft names seen in traffic: ${names:-none}; runtime library lines in the process's memory map: ${loaded:-0}; $summary" | tee "$OUT/$name.summary.txt"
    rm -f "$OUT/$name.full.strace"
}
echo "== 2 and 3. traced runs: off, on, off again"
run 1-off
run 2-on -e VOICE_SPEECH_OBSERVER=1
run 3-off-again
echo "== 4. switched on without the runtime's reporting suppressed"
run 4-on-without-reporting-switch -e VOICE_SPEECH_OBSERVER=1 -e ORT_DISABLE_TELEMETRY=
if [ "${YIELD:-0}" = 1 ]; then
    echo "== 5. the pause for the load's bots, then switched off by removing VOICE_YIELD_BOTS and restarting"
    run 5-pause-on -e VOICE_SPEECH_OBSERVER=1 -e VOICE_YIELD_BOTS=botx0,botx1,boty0,boty1
    run 6-pause-removed -e VOICE_SPEECH_OBSERVER=1
fi
rm -rf "$OUT/go"
