#!/bin/sh
# Install Forge Chess as a systemd user service on this machine. No sudo needed.
# GPL-3.0-or-later.
set -e
cd "$(dirname "$0")/.."
mkdir -p data "$HOME/.config/systemd/user"
cp deploy/forge-chess.service "$HOME/.config/systemd/user/forge-chess.service"
systemctl --user daemon-reload
systemctl --user enable --now forge-chess.service
sleep 1
curl -fsS http://127.0.0.1:8110/api/health && echo
echo "Expose on the tailnet with: tailscale serve --bg --tcp 8110 tcp://localhost:8110"
