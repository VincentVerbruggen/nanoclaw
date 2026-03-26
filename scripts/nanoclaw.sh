#!/bin/bash

SERVICE="com.nanoclaw"
PLIST="$HOME/Library/LaunchAgents/$SERVICE.plist"
UID_NUM=$(id -u)

usage() {
  echo "Usage: nanoclaw {start|stop|restart|status}"
  exit 1
}

if [ $# -ne 1 ]; then
  usage
fi

case "$1" in
  start)
    launchctl load "$PLIST" 2>/dev/null
    launchctl kickstart "gui/$UID_NUM/$SERVICE"
    echo "NanoClaw started."
    ;;
  stop)
    launchctl kill SIGTERM "gui/$UID_NUM/$SERVICE" 2>/dev/null
    launchctl unload "$PLIST" 2>/dev/null
    echo "NanoClaw stopped."
    ;;
  restart)
    launchctl kickstart -k "gui/$UID_NUM/$SERVICE"
    echo "NanoClaw restarted."
    ;;
  status)
    if ! docker info &>/dev/null; then
      echo "Docker is not running. NanoClaw needs Docker to work."
      exit 1
    fi
    if launchctl print "gui/$UID_NUM/$SERVICE" &>/dev/null; then
      LAST_EXIT=$(launchctl print "gui/$UID_NUM/$SERVICE" 2>/dev/null | grep "last exit code" | awk '{print $NF}')
      if [ "$LAST_EXIT" != "0" ] && [ -n "$LAST_EXIT" ]; then
        echo "NanoClaw is crash-looping (last exit code: $LAST_EXIT)."
        echo "Check logs: tail -20 /Volumes/Workspace/nanoclaw/logs/nanoclaw.error.log"
      else
        echo "NanoClaw is running."
      fi
    else
      echo "NanoClaw is not running."
    fi
    ;;
  *)
    usage
    ;;
esac
