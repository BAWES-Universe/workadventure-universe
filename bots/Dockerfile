# protobuf build
FROM node:20.18-bullseye-slim AS proto-builder
WORKDIR /usr/src
COPY messages/package-lock.json messages/package.json ./
RUN npm ci
COPY messages .
COPY libs ./../libs
RUN npm run tag-version && npm run ts-proto

# main stage
FROM node:20.18-bullseye-slim

WORKDIR /usr/src/app

# Copy root package files
COPY package.json package-lock.json ./

# Copy all workspace package.json files (needed for npm to recognize workspaces)
COPY play/package.json play/package.json
COPY back/package.json back/package.json
COPY map-storage/package.json map-storage/package.json
COPY bots/package.json bots/package.json
COPY libs/messages/package.json libs/messages/package.json
COPY libs/map-editor/package.json libs/map-editor/package.json

# Copy libs (needed for workspace dependencies to resolve)
COPY libs ./libs

# Copy generated protobuf files from proto-builder
# The proto files are generated in ../libs/messages/src/ts-proto-generated (relative to /usr/src)
COPY --from=proto-builder /usr/libs/messages/src/ts-proto-generated ./libs/messages/src/ts-proto-generated

# Install all workspace dependencies (this resolves workspace:* protocol)
# We install with dev dependencies to get ts-node for running TypeScript
RUN npm ci

# Copy bots source
COPY bots ./bots
COPY bots/tsconfig.json ./bots/tsconfig.json

WORKDIR /usr/src/app/bots

# Expose REST API port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start bot server using ts-node (runs TypeScript directly)
# Install ts-node globally or use npx
RUN npm install -g ts-node
CMD ["ts-node", "--transpile-only", "server/index.ts"]
