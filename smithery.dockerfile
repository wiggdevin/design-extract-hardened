# MCP serves local files only and does not need a browser or apt packages.
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --chown=node:node package.json package-lock.json .npmrc ./
USER node
RUN npm ci --ignore-scripts --omit=optional --omit=dev
COPY --chown=node:node bin ./bin
COPY --chown=node:node src ./src
ENTRYPOINT ["node", "/app/bin/design-extract.js", "mcp"]
