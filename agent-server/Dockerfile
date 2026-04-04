# ── Build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace config
COPY package.json package-lock.json ./

# Copy workspace packages
COPY shared/ shared/
COPY agent-server/ agent-server/

# Copy Prisma schema (needed for prisma generate)
COPY prisma/ prisma/
COPY prisma.config.ts ./

# Install all workspace deps
RUN npm ci --workspace=shared --workspace=agent-server

# Generate Prisma client
RUN npx prisma generate

# Build agent-server
WORKDIR /app/agent-server
RUN npx tsc

# ── Production stage ──────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Copy root workspace config
COPY package.json package-lock.json ./
COPY shared/ shared/
COPY agent-server/package.json agent-server/package.json

# Install production deps only
RUN npm ci --workspace=shared --workspace=agent-server --omit=dev

# Copy Prisma schema + generated client
COPY prisma/ prisma/
COPY prisma.config.ts ./
RUN npx prisma generate

# Copy built code
COPY --from=builder /app/agent-server/dist agent-server/dist

ENV NODE_ENV=production
ENV PORT=4001

EXPOSE 4001

CMD ["node", "agent-server/dist/server.js"]
