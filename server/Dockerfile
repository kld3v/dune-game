# Build from the repository root: the server shares its wire protocol with the game.
#   docker build -f server/Dockerfile -t arrakis-server .
FROM node:22-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY src/net/protocol.ts /app/src/net/protocol.ts
ENV NODE_ENV=production PORT=8006
EXPOSE 8006
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8006/health || exit 1
CMD ["node", "--experimental-strip-types", "src/index.ts"]
