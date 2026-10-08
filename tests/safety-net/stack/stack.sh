#!/usr/bin/env bash
# Docker-free local game stack for the safety-net suite.
# It runs the game from GAME_DIR (a checkout of the build you want to check) and writes nothing inside it
# except the usual generated files (proto, i18n). Logs, pids and vite caches go to STATE_DIR.
#
# Usage: GAME_DIR=/path/to/checkout stack.sh setup|start|stop|restart|status|wait [service]
#
# Ports: gateway 8000 (open the game here), front (vite) 8080, maps 8081, back 8090 + 50051 (grpc),
#        map-storage 3000 + 50053 (grpc), pusher 3002 (http) + 3003 (ws).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$(cd "${GAME_DIR:-$HERE/../../..}" && pwd)"
STATE_DIR="${STATE_DIR:-${TMPDIR:-/tmp}/safety-net-stack}"
LOGS="$STATE_DIR/logs"
RUN="$STATE_DIR/run"
mkdir -p "$LOGS" "$RUN" "$STATE_DIR/maps-store"

SECRET="safety-net-local-only-not-a-secret"
MS_TOKEN="safety-net-local-only"
START_MAP="${START_MAP:-/_/global/localhost:8081/tests/E2E/empty.json}"
BIN="$GAME_DIR/node_modules/.bin"

cmd_maps() {
    cd "$GAME_DIR/maps" && exec "$HERE/../node_modules/.bin/http-server" "$GAME_DIR/maps" -p 8081 -a 127.0.0.1 --cors -c-1
}

cmd_back() {
    cd "$GAME_DIR/back" && exec env \
        NODE_ENV=development \
        PLAY_URL=http://localhost:8000 \
        SECRET_KEY="$SECRET" \
        ENABLE_TELEMETRY=false \
        HTTP_PORT=8090 \
        GRPC_PORT=50051 \
        MAX_PER_GROUP=4 \
        ENABLE_MAP_EDITOR=true \
        MAP_STORAGE_URL=127.0.0.1:50053 \
        PUBLIC_MAP_STORAGE_URL=http://localhost:3000 \
        INTERNAL_MAP_STORAGE_URL=http://127.0.0.1:3000 \
        STORE_VARIABLES_FOR_LOCAL_MAPS=true \
        ENABLE_CHAT=true \
        ENABLE_CHAT_UPLOAD=false \
        "$BIN/tsx" src/server.ts
}

cmd_map_storage() {
    cd "$GAME_DIR/map-storage" && exec env \
        NODE_ENV=development \
        ESBK_TSCONFIG_PATH=tsconfig-node.json \
        TSX_TSCONFIG_PATH=tsconfig-node.json \
        API_URL=127.0.0.1:50051 \
        STORAGE_DIRECTORY="$STATE_DIR/maps-store" \
        ENABLE_BASIC_AUTHENTICATION=true \
        AUTHENTICATION_USER=john.doe \
        AUTHENTICATION_PASSWORD=password \
        ENABLE_BEARER_AUTHENTICATION=true \
        AUTHENTICATION_TOKEN=123 \
        MAP_STORAGE_API_TOKEN="$MS_TOKEN" \
        PUSHER_URL=http://localhost:8000 \
        WHITELISTED_RESOURCE_URLS="" \
        SECRET_KEY="$SECRET" \
        PATH_PREFIX="" \
        "$BIN/tsx" ./src/index.ts
}

cmd_pusher() {
    cd "$GAME_DIR/play" && exec env \
        NODE_ENV=development \
        TSX_TSCONFIG_PATH=tsconfig-pusher.json \
        SECRET_KEY="$SECRET" \
        API_URL=127.0.0.1:50051 \
        PUSHER_HTTP_PORT=3002 \
        PUSHER_WS_PORT=3003 \
        PUSHER_URL=http://localhost:8000 \
        FRONT_URL=http://localhost:8000 \
        VITE_URL=http://localhost:8080 \
        ALLOWED_CORS_ORIGIN='*' \
        START_ROOM_URL="$START_MAP" \
        ENABLE_MAP_EDITOR=true \
        MAP_EDITOR_ALLOW_ALL_USERS=true \
        MAP_STORAGE_API_TOKEN="$MS_TOKEN" \
        PUBLIC_MAP_STORAGE_URL=http://localhost:3000 \
        INTERNAL_MAP_STORAGE_URL=http://127.0.0.1:3000 \
        ENABLE_CHAT=true \
        ENABLE_CHAT_UPLOAD=false \
        DISABLE_NOTIFICATIONS=true \
        MAX_PER_GROUP=4 \
        UPLOADER_URL=/uploader-not-running \
        ICON_URL=/icon-not-running \
        FEATURE_FLAG_BROADCAST_AREAS=true \
        "$BIN/tsx" ./src/server.ts
}

vite_config() {
    sed -e "s|__GAME_DIR__|$GAME_DIR|g" -e "s|__STATE_DIR__|$STATE_DIR|g" "$HERE/$1" >"$STATE_DIR/$1"
    echo "$STATE_DIR/$1"
}

cmd_front() {
    cd "$GAME_DIR/play" && exec node node_modules/vite/bin/vite.js --config "$(vite_config vite.front.config.mts)"
}

cmd_iframe_api() {
    cd "$GAME_DIR/play" && node node_modules/vite/bin/vite.js build --config "$(vite_config vite.iframe-api.config.mts)"
}

cmd_gateway() {
    exec env STATE_DIR="$STATE_DIR" GAME_DIR="$GAME_DIR" node "$HERE/gateway.mjs"
}

ALL="maps back map-storage pusher front gateway"

is_running() {
    local pidf="$RUN/$1.pid"
    [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null
}

start_one() {
    local name="$1" fn="cmd_${1//-/_}"
    if is_running "$name"; then
        echo "$name already running (pid $(cat "$RUN/$name.pid"))"
        return
    fi
    echo "=== $(date -Is) start $GAME_DIR" >>"$LOGS/$name.log"
    # setsid: own process group, so stop can kill the whole tree (tsx / vite children)
    setsid bash -c "$(declare -f "$fn" vite_config); HERE='$HERE'; GAME_DIR='$GAME_DIR'; STATE_DIR='$STATE_DIR'; BIN='$BIN'; SECRET='$SECRET'; MS_TOKEN='$MS_TOKEN'; START_MAP='$START_MAP'; $fn" \
        >>"$LOGS/$name.log" 2>&1 </dev/null &
    echo $! >"$RUN/$name.pid"
    echo "started $name (pid $!), log: $LOGS/$name.log"
}

stop_one() {
    local name="$1" pidf="$RUN/$1.pid"
    if is_running "$name"; then
        local pid
        pid="$(cat "$pidf")"
        kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
        for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
        kill -KILL -- "-$pid" 2>/dev/null || true
        echo "stopped $name"
    else
        echo "$name not running"
    fi
    rm -f "$pidf"
}

# One-off preparation of GAME_DIR: generated proto + i18n files, the iframe API bundle, the WAM test maps.
setup() {
    if [ ! -d "$GAME_DIR/node_modules" ]; then
        echo "Run 'npm ci' in $GAME_DIR first"; exit 1
    fi
    # (Re)generate when missing or when a .proto changed since (e.g. after checking out another build).
    local generated="$GAME_DIR/libs/messages/src/ts-proto-generated/messages.ts"
    if [ ! -f "$generated" ] || [ -n "$(find "$GAME_DIR/messages/protos" -name '*.proto' -newer "$generated")" ]; then
        echo "Generating proto files"
        (cd "$GAME_DIR/messages" && { [ -x node_modules/.bin/protoc-gen-ts_proto ] || npm ci --ignore-scripts --no-audit --no-fund; } \
            && { python3 -m grpc_tools.protoc --version >/dev/null 2>&1 || python3 -m pip install -q grpcio-tools; } \
            && python3 -m grpc_tools.protoc --plugin=./node_modules/.bin/protoc-gen-ts_proto \
                --ts_proto_out=../libs/messages/src/ts-proto-generated --ts_proto_opt=outputServices=grpc-js \
                --ts_proto_opt=oneof=unions --ts_proto_opt=esModuleInterop=true -I ./protos protos/*.proto \
            && sed -i '1i\//@ts-nocheck' ../libs/messages/src/ts-proto-generated/*.ts) || exit 1
    fi
    (cd "$GAME_DIR/play" && npm run --silent typesafe-i18n >/dev/null) || exit 1
    echo "Building the iframe API bundle"
    cmd_iframe_api >"$LOGS/iframe-api.log" 2>&1 || { echo "iframe API build failed, see $LOGS/iframe-api.log"; exit 1; }
    echo "setup done"
}

# WAM maps go into map-storage under universe/world (e2e/tests), as the game requires.
load_maps() {
    local zip="$STATE_DIR/assets.zip"
    rm -f "$zip"
    # The checkout is restored whether or not the archive step works, so the game directory is never left modified.
    local ok=0
    (cd "$GAME_DIR/map-storage/tests/assets" && find . -type f -name "*.wam" -exec sed -i "s|http://play.workadventure.localhost|http://localhost:8000|g" {} \; \
        && python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1][:-4], 'zip', '.')" "$zip") || ok=1
    git -C "$GAME_DIR" checkout -- map-storage/tests/assets
    [ "$ok" = 0 ] || return 1
    curl -sf -u john.doe:password -F "file=@$zip" -F "directory=/e2e/tests" http://localhost:3000/upload >/dev/null \
        && echo "WAM maps loaded under /~/e2e/tests/maps/"
}

wait_up() {
    for _ in $(seq 1 180); do
        if curl -sf -o /dev/null http://localhost:8000/ && curl -sf -o /dev/null http://localhost:8080/ \
            && [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)" != "000" ]; then
            echo "stack up"; return 0
        fi
        sleep 2
    done
    echo "stack did not come up; see $LOGS"; return 1
}

targets() { if [ "${2:-all}" = all ]; then echo "$ALL"; else echo "$2"; fi; }

case "${1:-status}" in
    setup) setup ;;
    start) for s in $(targets "$@"); do start_one "$s"; done ;;
    stop) for s in $(targets "$@"); do stop_one "$s"; done ;;
    restart) for s in $(targets "$@"); do stop_one "$s"; start_one "$s"; done ;;
    wait) wait_up && load_maps ;;
    status)
        echo "GAME_DIR=$GAME_DIR (commit $(git -C "$GAME_DIR" rev-parse --short HEAD 2>/dev/null))"
        for s in $ALL; do
            if is_running "$s"; then echo "$s: running (pid $(cat "$RUN/$s.pid"))"; else echo "$s: stopped"; fi
        done
        ;;
    *) echo "usage: GAME_DIR=... $0 setup|start|stop|restart|wait|status [all|${ALL// /|}]"; exit 1 ;;
esac
