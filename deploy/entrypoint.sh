#!/bin/sh
# Starts as root only to hand the persistent disk (mounted root-owned) to the "node" user,
# then runs the command as "node". Nothing else runs as root.
set -e
if [ "$(id -u)" = "0" ]; then
  if [ -n "$STORAGE_DIR" ]; then
    mkdir -p "$STORAGE_DIR"
    chown node:node "$STORAGE_DIR" || echo "entrypoint: cannot chown $STORAGE_DIR" >&2
  fi
  # setpriv keeps the environment: give Chromium and the CLIs a home they can write to.
  export HOME=/home/node XDG_CONFIG_HOME=/tmp/.chromium XDG_CACHE_HOME=/tmp/.chromium
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
