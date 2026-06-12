# Build stage: install all workspaces, build server + both web apps
FROM node:24-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/player/package.json web/player/
COPY web/admin/package.json web/admin/
RUN npm ci

COPY tsconfig.base.json ./
COPY server/ server/
COPY web/ web/
RUN npm run build --workspaces --if-present

# Prune to production deps only (keeps the linux-built better-sqlite3 binary)
RUN npm prune --omit=dev

# Runtime stage
FROM node:24-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/server/dist ./server/dist
COPY --from=build /repo/server/package.json ./server/
COPY --from=build /repo/web/player/dist ./web/player/dist
COPY --from=build /repo/web/admin/dist ./web/admin/dist

VOLUME /data
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
