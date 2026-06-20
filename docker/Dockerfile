# Build stage: install all workspaces, build server + web apps + minigames
FROM node:24-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/player/package.json web/player/
COPY web/admin/package.json web/admin/
COPY packages/tile-pipeline/package.json packages/tile-pipeline/
COPY minigames/sliding-puzzle/package.json minigames/sliding-puzzle/
COPY minigames/find-object/package.json minigames/find-object/
COPY minigames/runner/package.json minigames/runner/
COPY minigames/arkanoid/package.json minigames/arkanoid/
RUN npm ci

COPY tsconfig.base.json ./
COPY scripts/ scripts/
COPY packages/ packages/
COPY minigames/ minigames/
COPY server/ server/
COPY web/ web/
RUN npm run build

# Prune to production deps only (keeps the linux-built better-sqlite3 binary)
RUN npm prune --omit=dev

# Runtime stage
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/server/dist ./server/dist
COPY --from=build /repo/server/static ./server/static
COPY --from=build /repo/server/package.json ./server/
COPY --from=build /repo/web/player/dist ./web/player/dist
COPY --from=build /repo/web/admin/dist ./web/admin/dist

VOLUME /data
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
