# Lumo self-hosted image (LUM-1028). Used by docker-compose.yml; see
# docs/self-hosting/README.md.
#
#   docker build -t lumo-app \
#     --build-arg NEXT_PUBLIC_APP_URL=https://lumo.example.com .
#
# NEXT_PUBLIC_* values are inlined into the browser bundle by `next build`,
# so they are BUILD arguments: changing one means rebuilding the image.
# Everything else is read at runtime from the container environment.
#
# Auth (LUM-1043): the image signs users in with Better Auth, the only
# provider (Clerk was removed, LUM-1077); the runtime needs BETTER_AUTH_SECRET
# (>= 32 chars). AUTH_PROVIDER stays a build argument and runtime value for
# compatibility; only "better-auth" is accepted.
#
# Not `output: 'standalone'`: the Workflow runtime loads its backend by name
# at runtime (`require(WORKFLOW_TARGET_WORLD)` from the working directory, see
# @workflow/core runtime/world.js) and graphile-worker resolves its plugins at
# runtime, so file tracing cannot see them; and the same image also runs
# `prisma migrate deploy`. The runtime stage therefore ships the production
# dependency tree (`npm ci`, then `npm prune --omit=dev`) next to the built `.next`.

ARG NODE_IMAGE=node:24-bookworm-slim
# Only better-auth is accepted (LUM-1077). Build and runtime use the same value.
ARG AUTH_PROVIDER=better-auth

# ---- base: OS packages shared by every stage --------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# openssl: Prisma's schema engine (migrate deploy). ca-certificates: outbound
# TLS (AI providers, SMTP).
RUN apt-get -o Acquire::Retries=5 update \
 && apt-get -o Acquire::Retries=5 install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---- deps: every dependency, for the build ----------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY cli/package.json cli/
# --ignore-scripts: husky's `prepare` needs .git and `postinstall` needs the
# Prisma schema; `prisma generate` runs explicitly below.
RUN npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=5 \
      --fetch-retry-maxtimeout=120000

# ---- prod-deps: the runtime dependency tree ---------------------------------
# Pruned from `deps` rather than installed again: one download, and exactly
# the lockfile's versions.
FROM deps AS prod-deps
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY lib/db/database-url.ts ./lib/db/
RUN npx prisma generate

# ---- builder: next build ------------------------------------------------------
FROM deps AS builder
COPY . .
ARG AUTH_PROVIDER
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_PUSHER_KEY=
ARG NEXT_PUBLIC_PUSHER_CLUSTER=
ARG NEXT_PUBLIC_PUSHER_HOST=
ARG NEXT_PUBLIC_PUSHER_PORT=
ARG NEXT_PUBLIC_PUSHER_USE_TLS=
# The default V8 heap runs out of memory in `next build` (LUM-1029); lower
# this on a builder with less than ~8 GB.
ARG BUILD_MAX_OLD_SPACE_SIZE=6144
ENV AUTH_PROVIDER=$AUTH_PROVIDER \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_PUSHER_KEY=$NEXT_PUBLIC_PUSHER_KEY \
    NEXT_PUBLIC_PUSHER_CLUSTER=$NEXT_PUBLIC_PUSHER_CLUSTER \
    NEXT_PUBLIC_PUSHER_HOST=$NEXT_PUBLIC_PUSHER_HOST \
    NEXT_PUBLIC_PUSHER_PORT=$NEXT_PUBLIC_PUSHER_PORT \
    NEXT_PUBLIC_PUSHER_USE_TLS=$NEXT_PUBLIC_PUSHER_USE_TLS
RUN case "$AUTH_PROVIDER" in \
      better-auth) ;; \
      *) echo "build arg AUTH_PROVIDER must be better-auth, got '$AUTH_PROVIDER'" >&2; exit 1 ;; \
    esac
RUN npx prisma generate \
 && npm run build:shared \
 && NODE_OPTIONS=--max-old-space-size=$BUILD_MAX_OLD_SPACE_SIZE npx next build \
 && rm -rf .next/cache

# ---- runner -------------------------------------------------------------------
FROM base AS runner
ARG AUTH_PROVIDER
ENV NODE_ENV=production \
    PORT=3000 \
    AUTH_PROVIDER=$AUTH_PROVIDER
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json /app/next.config.mjs /app/prisma.config.ts ./
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/shared ./shared
COPY --from=builder --chown=node:node /app/lib/db/database-url.ts ./lib/db/
COPY --from=builder --chown=node:node /app/scripts/workflow-postgres-bootstrap.mjs ./scripts/
USER node
EXPOSE 3000
# `next start` must listen on $PORT — the in-process workflow worker delivers
# to WORKFLOW_LOCAL_BASE_URL, which names the same port. A Better Auth image
# refuses to start without a usable BETTER_AUTH_SECRET instead of failing
# every sign-in later (lib/auth/better-auth/config.ts: >= 32 characters).
CMD ["sh", "-c", "if [ \"$AUTH_PROVIDER\" = better-auth ] && [ ${#BETTER_AUTH_SECRET} -lt 32 ]; then echo 'BETTER_AUTH_SECRET must be set to at least 32 characters (openssl rand -hex 32)' >&2; exit 1; fi; exec node node_modules/next/dist/bin/next start -p \"$PORT\""]
