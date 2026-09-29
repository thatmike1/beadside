#!/usr/bin/env bash
# build the ui and install beadside as a systemd user service.
# usage: install.sh <beads-repo-path> [port]
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <beads-repo-path> [port]" >&2
  exit 1
fi

REPO="$(cd "$1" && pwd)"
PORT="${2:-1338}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "error: node not found on PATH" >&2
  exit 1
fi

BD_BIN="$(command -v bd || true)"
if [ -z "$BD_BIN" ]; then
  echo "error: bd not found on PATH" >&2
  exit 1
fi
BD_DIR="$(dirname "$BD_BIN")"

echo "building ui..."
npm --prefix "$HERE" run build

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
SERVICE_FILE="$UNIT_DIR/beadside.service"

# the unit was called bd-board.service before the rename; retire it so two boards do not fight over the port
if [ -e "$UNIT_DIR/bd-board.service" ]; then
  systemctl --user disable --now bd-board.service || true
  rm -f "$UNIT_DIR/bd-board.service"
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=beadside over ${REPO}, 127.0.0.1:${PORT}
Documentation=https://github.com/gastownhall/beads

[Service]
Type=simple
WorkingDirectory=${REPO}
Environment=PATH=${BD_DIR}:/usr/local/bin:/usr/bin:/bin
ExecStart=${NODE_BIN} ${HERE}/bin/beadside.mjs --repo ${REPO} --port ${PORT} --no-open
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now beadside.service

echo
systemctl --user --no-pager status beadside.service | head -8 || true
echo
echo "board:     http://127.0.0.1:${PORT}"
echo "uninstall: systemctl --user disable --now beadside.service"
