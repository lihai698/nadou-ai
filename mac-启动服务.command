#!/bin/bash
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
bash mac-启动服务.sh "$@"
status=$?
if [ -t 0 ]; then
  read -r -p "按 Enter 键关闭窗口..." _
fi
exit "$status"
