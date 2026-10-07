#!/bin/bash
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 was not found. Install Python 3.10 or newer."
  exit 1
fi
if ! python3 tools/dependency_marker.py --check >/dev/null 2>&1; then
  echo "First launch: installing Python dependencies..."
  if ! bash mac-安装依赖.sh --no-pause; then
    echo "Dependency installation failed. Run bash mac-安装依赖.sh to see the full error."
    exit 1
  fi
fi
if ! python3 tools/check-environment.py --port 3000; then
  echo "Environment check failed. Fix the message above and try again."
  exit 1
fi
# 默认后端只监听本机；只有显式绑定到远端地址时才打开局域网地址。
BIND_HOST="${NADOU_BIND_HOST:-}"
if [ -z "$BIND_HOST" ] && [ -f "API/.env" ]; then
  BIND_HOST="$(sed -n 's/^[[:space:]]*NADOU_BIND_HOST[[:space:]]*=[[:space:]]*//p' API/.env | tail -n 1 | sed "s/^[\"']//; s/[\"']$//")"
fi
BIND_HOST="${BIND_HOST:-127.0.0.1}"
case "$(printf '%s' "$BIND_HOST" | tr '[:upper:]' '[:lower:]')" in
  0.0.0.0|::)
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
    if [ -z "$LAN_IP" ]; then
      LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    fi
    APP_HOST="${LAN_IP:-127.0.0.1}"
    ;;
  localhost|127.0.0.1|::1)
    APP_HOST="127.0.0.1"
    ;;
  *)
    APP_HOST="$BIND_HOST"
    ;;
esac
APP_URL="http://${APP_HOST}:3000/"

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
