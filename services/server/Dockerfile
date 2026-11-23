# KangXi.exe Universal Self-Hosted Backend (Node 24 + built-in SQLite + WebSocket)
# Build from repository root:
#   docker build -f services/server/Dockerfile -t kangxi-server .

FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.21.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/tsconfig.json ./packages/protocol/
COPY packages/server-core/package.json packages/server-core/tsconfig.json ./packages/server-core/
COPY services/server/package.json services/server/tsconfig.json ./services/server/

RUN pnpm install --frozen-lockfile --filter @kangxi/protocol --filter @kangxi/server-core --filter @kangxi/server

COPY packages/protocol/src ./packages/protocol/src
COPY packages/server-core/src ./packages/server-core/src
COPY services/server/src ./services/server/src

RUN pnpm --filter @kangxi/protocol build \
  && pnpm --filter @kangxi/server-core build \
  && pnpm --filter @kangxi/server build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV KANGXI_DATA_DIR=/data

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=builder /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=builder /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY --from=builder /app/packages/server-core/package.json ./packages/server-core/package.json
COPY --from=builder /app/packages/server-core/dist ./packages/server-core/dist
COPY --from=builder /app/packages/server-core/node_modules ./packages/server-core/node_modules
COPY --from=builder /app/services/server/package.json ./services/server/package.json
COPY --from=builder /app/services/server/dist ./services/server/dist
COPY --from=builder /app/services/server/node_modules ./services/server/node_modules

RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["node", "services/server/dist/cli.js"]
