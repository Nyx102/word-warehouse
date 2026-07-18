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

# fixed container-internal path; docker-compose bind-mounts the live project
# here — nothing about the host's layout is assumed
COPY . /word-warehouse
COPY --from=webbuild /build/dist /word-warehouse/frontend/dist
RUN ln -sf /word-warehouse/corpus_cli.py /usr/local/bin/corpus \
    && chmod +x /word-warehouse/corpus_cli.py \
    && git config --system --add safe.directory '*'

WORKDIR /word-warehouse
EXPOSE 8686
CMD ["python3", "server.py", "--host", "0.0.0.0", "--port", "8686"]
