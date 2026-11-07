#!/usr/bin/env bash
# Copy the single server owner's existing agent logins into the web container's persistent volume.
# This edition is explicitly single-user: credentials stay server-side and are never sent to a browser.
#
# Run from the repository root while the compose service is up:
#   ./scripts/web-import-agent-auth.sh
#
# Optional: TAYANG_SERVICE=other-name (default: tayang)
set -euo pipefail

SERVICE=${TAYANG_SERVICE:-tayang}
cd "$(dirname "$0")/.."

if ! docker compose ps --status running --services | grep -qx "$SERVICE"; then
  echo "The '$SERVICE' compose service is not running. Start it first: docker compose up -d" >&2
  exit 1
fi

echo "Importing server-side agent credentials into the container volume (no secrets are printed)."

# opencode stores integration credentials behind its auth command. Exporting and importing passes
# them through stdin so they are not written to a temporary file or the repository.
if command -v opencode >/dev/null 2>&1; then
  if opencode auth export 2>/dev/null | docker compose exec -T "$SERVICE" opencode auth import >/dev/null 2>&1; then
    echo "  opencode: imported"
  else
    echo "  opencode: no exported credential (or import failed); skipping"
  fi
else
  echo "  opencode: not installed on the host; skipping"
fi

# Claude Code's own config directory is /data/claude in the image (CLAUDE_CONFIG_DIR).
if [ -f "$HOME/.claude/.credentials.json" ]; then
  docker compose cp "$HOME/.claude/.credentials.json" "$SERVICE:/data/claude/.credentials.json" >/dev/null
  echo "  Claude Code: imported credentials"
else
  echo "  Claude Code: no ~/.claude/.credentials.json; skipping"
fi
if [ -f "$HOME/.claude.json" ]; then
  docker compose cp "$HOME/.claude.json" "$SERVICE:/data/claude/.claude.json" >/dev/null
fi

# Codex keeps its login in ~/.codex/auth.json. Do not copy the host's model config: a model
# selected for the host's Codex build may not be offered to the ACP adapter in the container.
docker compose exec -T -u root "$SERVICE" mkdir -p /data/home/.codex >/dev/null
if [ -f "$HOME/.codex/auth.json" ]; then
  docker compose cp "$HOME/.codex/auth.json" "$SERVICE:/data/home/.codex/auth.json" >/dev/null
  echo "  Codex: imported credentials"
else
  echo "  Codex: no ~/.codex/auth.json; skipping"
fi

# The image runs as UID/GID 10001; copied host files are owned by the host user.
docker compose exec -T -u root "$SERVICE" chown -R 10001:10001 /data/claude /data/home >/dev/null

echo "Done. Reload Settings › Agents; existing logins now come from this server account."
