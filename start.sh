#!/usr/bin/env sh
# Starts Gloss and opens it in the browser.
#   ./start.sh          the built app on port 3001
#   ./start.sh --dev    development servers with live reload
# Press Ctrl+C to stop.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Gloss needs Node.js 22.13 or newer: https://nodejs.org"
  exit 1
fi

exec node scripts/start.mjs "$@"
