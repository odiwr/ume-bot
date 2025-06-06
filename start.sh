#!/bin/bash

# Kill existing screen session if it exists
/opt/sbin/screen -S ume -X quit

# Start a new screen session named "ume"
cd /volume1/sokko/Network/ume-bot
/opt/sbin/screen -dmS ume /usr/bin/node main.js
