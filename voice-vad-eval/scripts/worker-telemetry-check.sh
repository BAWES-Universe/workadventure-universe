#!/usr/bin/env bash
# Does the whole worker reach anywhere new when the observer is on? The worker runs under strace (every thread), with no
# proxy in its environment, hears one person over a real peer connection, then idles. Observer off and on are traced the
# same way, so anything the "on" run reaches that the "off" run does not is the observer's doing. (The worker's WebRTC
# library looks up a STUN server for each peer connection by itself; that is today's behaviour and shows in both runs.)
#   scripts/worker-telemetry-check.sh <data dir> [seconds of audio, default 20] [idle seconds, default 75]
set -uo pipefail
cd "$(dirname "$0")/.."
DATA="$1"; TALK="${2:-20}"; IDLE="${3:-75}"; OUT="${OUT:-out/telemetry}"; PORT=8831; mkdir -p "$OUT"
run() { # name, extra env...
    local name="$1"; shift
    env -i PATH="$PATH" HOME="$(mktemp -d)" ORT_DISABLE_TELEMETRY=1 VOICE_WORKER_PORT=$PORT VOICE_ICE_SERVERS='[]' \
        LOAD_SUMMARY="$OUT/$name.summary.json" "$@" \
        strace -f -qq -s 256 -e trace=connect,sendto,sendmsg,sendmmsg -o "$OUT/$name.full.strace" \
        node --import tsx src/worker-under-load.ts > "$OUT/$name.log" 2>&1 &
    local tracer=$! worker=""
    for _ in $(seq 1 120); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
    worker=$(pgrep -P "$tracer" | head -1)
    npx tsx src/load.ts "ws://127.0.0.1:$PORT" "$DATA" 1 "$TALK" "$OUT/$name.load.json" > /dev/null 2>&1
    sleep "$IDLE"
    kill -USR1 "$worker"; sleep 1
    kill -TERM "$worker"; wait "$tracer"
    # What is kept: every network call that is not to this machine itself (loopback, or an address of its own
    # interfaces), and what was written to a connected socket (that is where a name lookup shows the name it asks for)
    local own; own=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep . | sed 's/\./\\./g' | paste -sd'|')
    grep -aE 'AF_INET6?|sendto\([0-9]+, .*, NULL, 0\)' "$OUT/$name.full.strace" | grep -avE "inet_addr\(\"(127\.[0-9.]+|0\.0\.0\.0${own:+|$own})\"\)|inet_pton\(AF_INET6, \"(::1|::ffff:127\.[0-9.]+)\"" > "$OUT/$name.strace" || true
    local total outside asked names summary
    total=$(grep -acE 'AF_INET6?' "$OUT/$name.full.strace" || true)
    outside=$(grep -acE 'AF_INET6?' "$OUT/$name.strace" || true)
    asked=$(grep -aoE '\\[0-9]{1,3}[a-z0-9-]+(\\[0-9]{1,3}[a-z0-9-]+)+\\0' "$OUT/$name.strace" | sed -E 's/\\[0-9]{1,3}/./g; s/^\.//; s/\.$//' | sort | uniq -c | sed -E 's/^ +//' | paste -sd',' || true)
    names=$(grep -aoiE '(microsoft|visualstudio|applicationinsights|events\\[0-9]+data)[a-z0-9.\\-]*' "$OUT/$name.full.strace" | sort -u | tr '\n' ' ' || true)
    summary=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const o=s.observerWork;console.log(`observer: ${o?`${o.status}, ${o.windows} windows, ${o.errors} errors`:"none"}; frames heard: ${s.heard.frames}`)' "$OUT/$name.summary.json" 2>/dev/null || echo "summary missing")
    echo "$name: network calls=$total, of them to anywhere but this machine=$outside; names looked up: ${asked:-none}; microsoft names seen in traffic: ${names:-none}; $summary"
    rm -f "$OUT/$name.full.strace"
}
run worker-observer-off
run worker-observer-on VOICE_SPEECH_OBSERVER=1 VOICE_SPEECH_OBSERVER_MODEL="$DATA/silero_vad_v6.2.3.onnx" VOICE_SPEECH_OBSERVER_RUNTIME="$PWD/node_modules/onnxruntime-node"
