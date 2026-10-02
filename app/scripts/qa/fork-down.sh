#!/usr/bin/env bash
# Stop the forks started by fork-up.sh (by pid file only; never pkill).
for f in /tmp/qa-fork-*.pid; do [ -f "$f" ] || continue; kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done
echo "forks stopped"
