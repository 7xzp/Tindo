#!/bin/bash
# Auto-restart tunnel - keeps the same URL as long as the process stays alive
while true; do
  /Users/7xzp/Tindo/cloudflared tunnel --url http://localhost:5088 2>&1 | tee /tmp/cf.log
  sleep 3
done
