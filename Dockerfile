# Server-mode image: the room, the Copilot runtime, and a checkout of the repo
# the agent works on. Mount or clone the repo at /workspace.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
ENV COPILOT_ROOM_MODE=server \
    COPILOT_ROOM_REPO=/workspace \
    COPILOT_ROOM_STATE_DIR=/state \
    PORT=3000
VOLUME ["/workspace", "/state"]
EXPOSE 3000
ENTRYPOINT ["node", "dist/cli.js"]
