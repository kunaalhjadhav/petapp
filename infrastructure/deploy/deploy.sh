#!/usr/bin/env bash
# Runs on the server (Linux, Docker Compose v2), called by the deploy workflow over SSH:
#   ./deploy.sh <image tag> <staging|production>
# 1. Pulls the new images.  2. Production: takes a database backup first.  3. Runs migrations (they are always
# backward-compatible, so the old version keeps working during the rollout).  4. Starts the new version.
# 5. Waits for it to be healthy; if it isn't, starts the previous version again and fails.
set -euo pipefail
TAG="${1:?usage: deploy.sh <image tag> <staging|production>}"
ENVIRONMENT="${2:?usage: deploy.sh <image tag> <staging|production>}"
cd "$(dirname "$0")"
export DEPLOY_ENV="$ENVIRONMENT"
PREVIOUS="$(cat .deployed-tag 2>/dev/null || true)"
dc() { IMAGE_TAG="$1" docker compose -f compose.yml "${@:2}"; }

echo "Deploying $TAG to $ENVIRONMENT (previous: ${PREVIOUS:-none})"
dc "$TAG" pull --quiet
dc "$TAG" --profile jobs pull --quiet migrate backup

if [ "$ENVIRONMENT" = production ]; then
  echo "Backing up the database before migrating"
  dc "$TAG" --profile jobs run --rm backup node scripts/ops/backup.mjs
fi

echo "Running migrations"
dc "$TAG" --profile jobs run --rm migrate

echo "Starting $TAG"
dc "$TAG" up -d --remove-orphans api worker admin web

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:4000/ready >/dev/null && curl -fsS http://127.0.0.1:3001/robots.txt >/dev/null && curl -fsS -o /dev/null http://127.0.0.1:3000/login; then
      return 0
    fi
    sleep 4
  done
  return 1
}

if healthy; then
  echo "$TAG" > .deployed-tag
  echo "$TAG is live on $ENVIRONMENT"
  docker image prune -f --filter "until=168h" >/dev/null || true
else
  echo "$TAG did not become healthy" >&2
  dc "$TAG" logs --tail 80 api worker >&2 || true
  if [ -n "$PREVIOUS" ]; then
    echo "Rolling back to $PREVIOUS" >&2
    dc "$PREVIOUS" up -d --remove-orphans api worker admin web
  fi
  exit 1
fi
