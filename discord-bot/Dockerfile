# Build stage
FROM node:20.18-bookworm-slim AS builder

WORKDIR /usr/src/app

    # Copy package files and install all dependencies (including dev)
    COPY package.json package-lock.json ./
    RUN npm ci

# Copy source, build and test (the tests also check the report's emoji files)
COPY src ./src
COPY assets ./assets
COPY tsconfig.json ./
RUN npm run build
RUN npm test

# Production stage
FROM node:20.18-bookworm-slim

WORKDIR /usr/src/app

    # Copy package files and install only production dependencies
    COPY package.json package-lock.json ./
    RUN npm ci --omit=dev

# Copy compiled output from builder, and the emoji the report adds to the Discord app (emoji.ts)
COPY --from=builder /usr/src/app/dist ./dist
COPY assets ./assets

# Health check (simple process check)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Baked release identity (RELEASE_VERSION). Deliberately the last thing before USER/CMD:
# a build arg invalidates the layer cache from its first use and this value changes on every
# release, so anything placed after it would be rebuilt every time.
ARG RELEASE_VERSION=""
ENV RELEASE_VERSION=$RELEASE_VERSION

USER node

CMD ["npm", "start"]

