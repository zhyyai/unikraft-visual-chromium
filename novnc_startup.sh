#!/bin/bash
echo "Starting noVNC proxy on port 6080..."
/opt/noVNC/utils/novnc_proxy --vnc 127.0.0.1:5900 --listen 6080 --web /opt/noVNC &
