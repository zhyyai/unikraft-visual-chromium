#!/bin/bash
set -e

export HOME=/root
export DEBIAN_FRONTEND=noninteractive
export DISPLAY_NUM=1
export DISPLAY=:1
mkdir -p /app/data

/app/xvfb_startup.sh
/app/openbox_startup.sh
/app/x11vnc_startup.sh
/app/novnc_startup.sh

echo "Starting Optimized Chromium CDP Proxy..."
exec node /app/proxy.js
