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

# mirror the host layout so claude session keys (cwd-based) match on host and
# in container; docker-compose bind-mounts the live directories over these
COPY . /home/ubuntu/worldend/app
COPY --from=webbuild /build/dist /home/ubuntu/worldend/app/frontend/dist
RUN ln -sf /home/ubuntu/worldend/app/corpus_cli.py /usr/local/bin/corpus \
    && chmod +x /home/ubuntu/worldend/app/corpus_cli.py \
    && git config --system --add safe.directory '*'

WORKDIR /home/ubuntu/worldend/app
EXPOSE 8686
CMD ["python3", "server.py", "--host", "0.0.0.0", "--port", "8686"]
