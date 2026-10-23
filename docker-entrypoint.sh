#!/bin/sh
set -eu
mkdir -p /data
if [ "$(id -u)" = "0" ]; then
  if [ ! -f /app/.env ]; then
    if [ -z "${ENV_PASS:-}" ]; then
      echo "Set ENV_PASS to unlock the server secrets." >&2
      exit 1
    fi
    node /app/unseal-env.mjs --unseal /app/.env.enc /app/.env
    chown node:node /app/.env
    chmod 600 /app/.env
  fi
  chown node:node /data
  unset ENV_PASS
  exec runuser -u node -- "$@"
fi
exec "$@"
