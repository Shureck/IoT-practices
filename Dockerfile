# ESP32 Lab — веб-приложение (фронтенд + API-сервер) в одном образе.
# Сборка: docker compose build app   (или docker build -t esp32lab-app .)
# Только сервер без фронтенда (если apps/web ещё не собирается): --build-arg SKIP_WEB=1

# ---------- 1. сборка ----------
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/content/package.json packages/content/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
ARG SKIP_WEB=0
RUN if [ "$SKIP_WEB" = "1" ]; then echo "SKIP_WEB=1: фронтенд не собирается"; mkdir -p apps/web/dist; \
    else npm run build -w apps/web; fi
RUN npm run build -w apps/server

# ---------- 2. production-зависимости (нативный better-sqlite3 и др.) ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/content/package.json packages/content/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --no-audit --no-fund --workspace apps/server --include-workspace-root=false \
 && rm -rf node_modules/@esp32lab \
 && node -e "require('better-sqlite3')(':memory:').close()"

# ---------- 3. рабочий образ ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST=/app/web
WORKDIR /app
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
