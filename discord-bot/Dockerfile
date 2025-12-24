# Build stage
FROM node:20.18-bullseye-slim AS builder

WORKDIR /usr/src/app

    # Copy package files and install all dependencies (including dev)
    COPY package.json package-lock.json ./
    RUN npm ci

# Copy source and build
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

# Production stage
FROM node:20.18-bullseye-slim

WORKDIR /usr/src/app

    # Copy package files and install only production dependencies
    COPY package.json package-lock.json ./
    RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /usr/src/app/dist ./dist

# Health check (simple process check)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

USER node

CMD ["npm", "start"]

