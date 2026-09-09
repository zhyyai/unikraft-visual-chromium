#!/bin/bash
set -e
export DISPLAY=:${DISPLAY_NUM:-1}
DPI=96
RES_AND_DEPTH="1280x720x16"
echo "Starting Xvfb on $DISPLAY with $RES_AND_DEPTH..."
Xvfb $DISPLAY -ac -screen 0 $RES_AND_DEPTH -dpi $DPI -nolisten tcp &
XVFB_PID=$!

for i in $(seq 1 40); do
    if xdpyinfo -display $DISPLAY >/dev/null 2>&1; then
        echo "Xvfb successfully started (PID $XVFB_PID)."
        exit 0
    fi
    sleep 0.2
done

echo "Xvfb failed to start in time!"
exit 1
