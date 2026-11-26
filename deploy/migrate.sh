#!/bin/sh
# Render pre-deploy command: apply pending database migrations before the new version starts.
set -e
cd /opt/tools
exec node node_modules/prisma/build/index.js migrate deploy
