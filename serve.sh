#!/usr/bin/env bash
# 本地启动。摄像头要求「安全上下文」：
#   - localhost / 127.0.0.1 天然安全
#   - 手机通过局域网 IP 访问时，http 不算安全，必须走 HTTPS 隧道或在手机浏览器里放行
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PORT="${1:-5180}"
HOST="127.0.0.1"

if [ "${1:-}" = "--lan" ]; then
  PORT="${2:-5180}"
  HOST="0.0.0.0"
  echo "局域网模式（手机同 Wi-Fi 访问）："
  for ip in $(ipconfig getifaddr en0 2>/dev/null) $(ipconfig getifaddr en1 2>/dev/null); do
    echo "  http://$ip:$PORT/   ← 摄像头可能被浏览器拦，见 README「手机上测」"
  done
fi

echo "预览: http://127.0.0.1:${PORT}/"
exec python3 -m http.server "$PORT" --bind "$HOST"
