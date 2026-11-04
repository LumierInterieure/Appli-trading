#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js est requis : https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
npm run build
( sleep 3; (command -v open >/dev/null && open http://localhost:8787) || (command -v xdg-open >/dev/null && xdg-open http://localhost:8787) || true ) &
npm start
