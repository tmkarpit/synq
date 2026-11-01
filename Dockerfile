# SYNQ in one container: the SYNQ server serves the built website, the API, the sockets
# and Go Live from one origin (no CORS, first-party login cookie).
#
#   docker build --build-arg SITE_URL=https://synq.example.com -t synq .
#   docker run -p 4000:4000 --env-file server/.env -e NODE_ENV=production synq
#
# In production the host terminal and Python/C/C++/Java are off (config.js); only the
# sandboxed JavaScript/TypeScript runner is on.

# ---- 1. Build the website --------------------------------------------------------------
FROM node:24-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000
COPY client/ ./
ARG SITE_URL=""
ENV SITE_URL=${SITE_URL} VITE_USE_MOCK=false
RUN npm run build

# ---- 2. Server -------------------------------------------------------------------------
FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=4000 STATIC_DIR=/app/client/dist \
    DATA_DIR=/app/data WORKSPACES_DIR=/app/workspaces
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000
COPY server/src ./src
COPY --from=client /app/client/dist /app/client/dist
RUN mkdir -p /app/data /app/workspaces && chown -R node:node /app/data /app/workspaces
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
