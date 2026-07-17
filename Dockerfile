FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates nodejs npm \
    && npm install -g @anthropic-ai/claude-code \
    && pip install --no-cache-dir pyyaml \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# mirror the host layout so claude session keys (cwd-based) match on host and
# in container; docker-compose bind-mounts the live directories over these
COPY . /home/ubuntu/worldend/app
RUN ln -sf /home/ubuntu/worldend/app/corpus_cli.py /usr/local/bin/corpus \
    && chmod +x /home/ubuntu/worldend/app/corpus_cli.py \
    && git config --system --add safe.directory '*'

WORKDIR /home/ubuntu/worldend/app
EXPOSE 8686
CMD ["python3", "server.py", "--host", "0.0.0.0", "--port", "8686"]
