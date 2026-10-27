#!/usr/bin/env bash
set -euo pipefail

# Load environment variables from .env file
if [ -f .env ]; then
  set -a
  source .env
  set +a
else
  echo "Error: .env file not found!" >&2
  exit 1
fi

docker pull ${TEX_LIVE_REPO}/texlive-full:2026.1
docker pull ${TEX_LIVE_REPO}/texlive-full:2025.1
docker pull ${TEX_LIVE_REPO}/texlive-full:2024.1
docker pull ${TEX_LIVE_REPO}/texlive-full:2023.1

docker pull nginx:stable-alpine
docker pull mongo:${MONGO_VERSION}
docker pull redis:${REDIS_VERSION}
docker pull chrislusf/seaweedfs:latest
