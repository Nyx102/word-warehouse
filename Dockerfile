# --- stage 1: frontend build (kept out of the runtime image layers)
FROM node:22-slim AS webbuild
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- stage 2: runtime
FROM python:3.12-slim

# node 22 (NodeSource): runs claude-code, npm builds, and vite dev in-container
RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates wamerican \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && pip install --no-cache-dir pyyaml \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Run as a non-root user whose uid/gid match the host caller. docker-compose
# passes these as build args (sourced from .env); the container then writes to
# the bind-mounted project as the host user instead of root, so nothing lands
# root-owned. The 1000 defaults are only a fallback for a build without .env.
ARG PUID=1000
ARG PGID=1000
RUN groupadd -g "$PGID" dev \
    && useradd -m -u "$PUID" -g "$PGID" -s /bin/bash dev
ENV HOME=/home/dev

# fixed container-internal path; docker-compose bind-mounts the live project
# here — nothing about the host's layout is assumed
COPY . /word-warehouse
COPY --from=webbuild /build/dist /word-warehouse/frontend/dist
RUN printf '#!/bin/sh\nexec env PYTHONPATH=/word-warehouse python3 -m backend.cli "$@"\n' > /usr/local/bin/corpus \
    && chmod +x /usr/local/bin/corpus \
    && git config --system --add safe.directory '*'

USER dev
WORKDIR /word-warehouse
EXPOSE 8686
CMD ["python3", "-m", "backend.server", "--host", "0.0.0.0", "--port", "8686"]
