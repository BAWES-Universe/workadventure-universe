#!/usr/bin/env bash
# Does the runtime try to reach the outside by itself? Each case runs alone under strace (every thread and child), with
# no proxy in its environment, so any name lookup or connection it makes is its own. An attempt that fails still counts.
#   scripts/telemetry-check.sh <model> [idle seconds]
set -uo pipefail
cd "$(dirname "$0")/.."
INVALID=0
MODEL="$1"; IDLE="${2:-75}"; OUT="${OUT:-out/telemetry}"; mkdir -p "$OUT"
run() { # name, runtime, extra env...
    local name="$1" runtime="$2"; shift 2
    env -i PATH="$PATH" HOME="$(mktemp -d)" "$@" strace -f -qq -s 256 -e trace=connect,sendto,sendmsg,sendmmsg -o "$OUT/$name.strace" \
        node --import tsx src/telemetry-probe.ts "$MODEL" "$runtime" "$IDLE" > "$OUT/$name.log" 2>&1
    local status=$?
    local inet names
    inet=$(grep -E 'connect\(' "$OUT/$name.strace" | grep -cE 'AF_INET6?' || true)
    names=$(grep -aoE '(mobile|events|data|microsoft|visualstudio|applicationinsights)[a-z0-9.\\-]*' "$OUT/$name.strace" | sort -u | tr '\n' ' ' || true)
    # The probe ends with "<runtime>: done" when it ran the whole stretch; without it (strace failed, the probe crashed) the count
    # of connects is a count of nothing, so the case is not a result
    if [ "$status" -ne 0 ] || [ "$(tail -1 "$OUT/$name.log")" != "$runtime: done" ]; then
        echo "$name: INVALID (strace or the probe ended with exit $status, and its log does not end with \"$runtime: done\"): $(tail -1 "$OUT/$name.log")"
        INVALID=1
        return
    fi
    echo "$name: network connects=$inet; microsoft names seen in traffic: ${names:-none}; exit log: $(tail -1 "$OUT/$name.log")"
}
run native-default native
run native-disabled native ORT_DISABLE_TELEMETRY=1
run wasm wasm
exit "$INVALID"
