#!/usr/bin/env bash
# Walks the real BDS through the milestone 4 player scenarios and prints what
# the map API reports at each step. Requires BDS running with the tracker pack
# and the simulated-player test pack, plus the map server on :3000.
set -uo pipefail

TMUX="tmux -f /exec-daemon/tmux.portal.conf"
SESSION="bds-server:0.0"
LOG=${1:-/tmp/bds/m4g.log}

bds() {
  $TMUX send-keys -t "$SESSION" "$1" C-m
}

api() {
  curl -s "localhost:3000/api/players${1:-}"
  echo
}

step() {
  printf '\n=== %s ===\n' "$1"
}

step 'in-game position vs the map API'
bds 'scriptevent bmap:tp 450 200'
sleep 5
bds 'scriptevent bmap:where'
sleep 2
grep 'online:' "$LOG" | tail -1
api

step 'player walking: three samples while patrolling'
bds 'scriptevent bmap:patrol'
for _ in 1 2 3; do
  sleep 4
  api
done
bds 'scriptevent bmap:stop'
sleep 4

step 'player enters the nether'
bds 'scriptevent bmap:nether'
sleep 5
echo 'all dimensions:'
api
echo 'overworld map only:'
api '?dimension=overworld'

step 'player returns to the overworld'
bds 'scriptevent bmap:overworld'
sleep 5
api '?dimension=overworld'

step 'player disconnects'
bds 'scriptevent bmap:leave'
sleep 5
api

step 'BDS stops sending updates (stale after 10 s)'
bds 'scriptevent bmap:join'
sleep 5
echo 'before stopping BDS:'
api
bds 'stop'
sleep 12
echo 'after BDS shutdown:'
api
