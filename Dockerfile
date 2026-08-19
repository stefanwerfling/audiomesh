# AudioMesh — single image: builds all workspaces and runs the backend, which
# serves the API, the WebSocket, and the static frontend. Kept deliberately simple
# (one stage, one service) — no Kubernetes, no separate frontend container.
FROM node:24-bookworm

WORKDIR /app

# Install deps first for layer caching. --ignore-scripts avoids a transitive
# husky prepare-script failure; better-sqlite3's native binary is rebuilt after.
COPY package.json package-lock.json tsconfig.base.json ./
COPY schemas/package.json ./schemas/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

# Build: schemas → backend (tsc) → frontend (gulp: assets + webpack).
COPY . .
RUN npm run build

# Bake the container config (DB + paths); app settings are edited in the UI.
RUN cp backend/config.docker.json backend/config.json

EXPOSE 3901
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
