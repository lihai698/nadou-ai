#!/bin/bash
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 was not found. Install Python 3.10 or newer."
  exit 1
fi
if ! python3 tools/check-environment.py --port 3000; then
  echo "Environment check failed. Fix the message above and try again."
  exit 1
fi
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
if [ -z "$LAN_IP" ]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [ -z "$LAN_IP" ]; then
  LAN_IP="127.0.0.1"
fi
APP_URL="http://${LAN_IP}:3000/"

echo "Starting nadou ai..."
echo "Visit: ${APP_URL}"
echo "Local: http://127.0.0.1:3000/"
echo "Press Ctrl+C to stop."
echo ""

# A self-restart keeps the existing page open; avoid opening a second tab.
if [ "${1:-}" != "--no-browser" ]; then
  sleep 3 && open "${APP_URL}" &
fi

python3 main.py
status=$?

echo ""
echo "Server stopped."
exit "$status"
