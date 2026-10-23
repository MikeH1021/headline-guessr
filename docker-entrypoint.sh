#!/bin/sh
set -eu
mkdir -p /data
if [ "$(id -u)" = "0" ]; then
  chown node:node /data
  exec runuser -u node -- "$@"
fi
exec "$@"
