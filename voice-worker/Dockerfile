# The voice worker as its own service. Build from this folder: docker build -t voice-worker .
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# The speech observer's detector (speech-observer/README.md): in the image and on, with the pause for every bot; the
# engineers' off switch is VOICE_SPEECH_OBSERVER=0. Its own lockfile; no install scripts; only the two packages and this machine's native library are kept.
COPY speech-observer ./speech-observer
RUN cd speech-observer \
  && echo "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3  silero_vad_v6.2.3.onnx" | sha256sum -c - \
  && npm ci --omit=dev --ignore-scripts --cache /tmp/speech-observer-npm \
  && rm -rf /tmp/speech-observer-npm node_modules/.bin node_modules/.package-lock.json node_modules/onnxruntime-node/script \
  && find node_modules -mindepth 1 -maxdepth 1 ! -name onnxruntime-node ! -name onnxruntime-common -exec rm -rf {} + \
  && find node_modules/onnxruntime-node/bin/napi-v6 -mindepth 2 -maxdepth 2 ! -path "*/linux/$(node -p process.arch)" -exec rm -rf {} + \
  && find node_modules/onnxruntime-node/bin/napi-v6 -mindepth 1 -maxdepth 1 -type d -empty -delete \
  && test -f "node_modules/onnxruntime-node/bin/napi-v6/linux/$(node -p process.arch)/onnxruntime_binding.node"
# The runtime's native library reports usage to its maker unless this is set before it starts; the loader refuses without it
ENV ORT_DISABLE_TELEMETRY=1 \
    VOICE_SPEECH_OBSERVER_MODEL=/app/speech-observer/silero_vad_v6.2.3.onnx \
    VOICE_SPEECH_OBSERVER_RUNTIME=/app/speech-observer/node_modules/onnxruntime-node

COPY schema.json ./
COPY src ./src

USER node
ENV VOICE_WORKER_HOST=0.0.0.0
EXPOSE 8830
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.VOICE_WORKER_PORT || 8830) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
