#!/bin/bash
export DISPLAY=:${DISPLAY_NUM:-1}
echo "Starting Openbox window manager..."
openbox &
