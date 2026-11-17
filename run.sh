#!/usr/bin/env bash
# One command to run Briefing Desk: ./run.sh
#   ./run.sh --reset-data   rebuild the database from data/ (saved briefings are kept, marked stale)
# Needs: uv (Python) and Node.js 20+. Serves UI and API together on http://localhost:${PORT:-8000}.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"

step() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

command -v uv >/dev/null || fail "uv is not installed. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
command -v node >/dev/null || fail "Node.js is not installed. Install Node 20 or newer: https://nodejs.org"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || fail "Node.js 20 or newer is required (found $(node -v))."

if [ ! -f .env ]; then
  step "First run: configuring the LLM key"
  cp .env.example .env
  printf 'Paste your DeepSeek API key (input hidden, saved only to .env): '
  read -rs key
  echo
  [ -n "$key" ] || fail "No key entered. Add it to .env (LLM_API_KEY=...) and run again."
  sed -i.bak "s|^LLM_API_KEY=.*|LLM_API_KEY=${key}|" .env && rm -f .env.bak
fi
grep -q '^LLM_API_KEY=.\+' .env || fail "LLM_API_KEY is empty in .env. Add your key and run again."

step "Installing Python dependencies"
uv sync --quiet

step "Building the web UI"
(cd frontend && { [ -d node_modules ] || npm ci --silent --no-audit --no-fund; } && npm run build --silent >/dev/null)

if [ ! -f var/briefing.db ] || [ "${1:-}" = "--reset-data" ]; then
  step "Loading the data pack (first run downloads a small embedding model, about 130 MB)"
  uv run --quiet python -m briefing.ingest >/dev/null
fi

if command -v lsof >/dev/null && lsof -ti:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port $PORT is in use. Stop the other process or run: PORT=8010 ./run.sh"
fi

step "Starting Briefing Desk"
printf '\n  Open \033[1mhttp://localhost:%s\033[0m and sign in with a demo profile. Ctrl+C to stop.\n\n' "$PORT"
exec uv run --quiet uvicorn briefing.api:app --host 127.0.0.1 --port "$PORT" --log-level warning
