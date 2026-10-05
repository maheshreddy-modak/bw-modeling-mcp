# Self-hosted streamable HTTP server (src/http-local.ts).
#
# Credentials are never baked into the image; the .env is mounted at /app/.env at run time.
# Run with compose (see docker-compose.yml):
#   docker compose up -d --build
# Node loads the mounted file itself (--env-file-if-exists), so quoted values keep
# working; `docker run --env-file` would pass the quotes through literally.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "--env-file-if-exists=/app/.env", "dist/http-local.js"]
