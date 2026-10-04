# ---- build: install everything, build the PWA, then drop dev dependencies ----
FROM node:24-slim AS build
WORKDIR /app
# npm ci still runs better-sqlite3's node-gyp step, so python3 and make are required
# (Node headers are downloaded); g++ only matters if no prebuild matches the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY web web
RUN npm run build
COPY server server
RUN npm prune --omit=dev

# ---- runtime: Node runs the server's TypeScript directly (type stripping) ----
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    METRICS_PORT=9464 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/shared/src shared/src
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/src server/src
COPY --from=build /app/server/drizzle server/drizzle
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8080 9464
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
