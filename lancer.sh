#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js est requis : https://nodejs.org"; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || { echo "Node.js 20 ou plus est requis (actuel : $(node -v))"; exit 1; }
if [ ! -x node_modules/.bin/vite ] || [ ! -x node_modules/.bin/tsx ]; then
  echo "Installation des dépendances (première fois, 1 à 2 minutes)…"
  npm install --include=dev --no-audit --no-fund
fi
npm run build
( sleep 4; (command -v open >/dev/null && open http://localhost:8787) || (command -v xdg-open >/dev/null && xdg-open http://localhost:8787) || true ) &
echo "Application disponible sur http://localhost:8787 (Ctrl+C pour arrêter)"
npm start
