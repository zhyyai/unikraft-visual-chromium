#!/bin/bash
export DISPLAY=:${DISPLAY_NUM:-1}
echo "Starting optimized x11vnc..."
PASS_ARG="-nopw"
if [ -n "$VNC_PASSWORD" ]; then
    mkdir -p /root/.vnc
    x11vnc -storepasswd "$VNC_PASSWORD" /root/.vnc/passwd
    PASS_ARG="-rfbauth /root/.vnc/passwd"
fi

x11vnc -display $DISPLAY     -forever     -shared     -rfbport 5900     $PASS_ARG     -noxdamage     -nowf     -ncache 10     -wait 10     -defer 10     -snapfb &
