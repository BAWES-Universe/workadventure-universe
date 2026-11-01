# The voice worker as its own service. Build from this folder: docker build -t voice-worker .
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY schema.json ./
COPY src ./src

USER node
ENV VOICE_WORKER_HOST=0.0.0.0
EXPOSE 8830
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.VOICE_WORKER_PORT || 8830) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
