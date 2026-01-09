#!/bin/bash
# Deep path analysis script

API_URL="${BOT_API_URL:-http://bot-server.workadventure.localhost}"

echo "=== Deep Path Analysis ==="
echo ""

# Get all path starts with their waypoint advances
echo "📊 Path Analysis:"
curl -s "$API_URL/dev/movement/logs?count=5000" | jq '
  # Group events by bot and path
  [.events[] | select(.eventType=="path_start" or .eventType=="waypoint_advance" or .eventType=="path_end" or .eventType=="path_fail")] 
  | group_by(.botId) 
  | .[] 
  | {
      botId: .[0].botId[0:8],
      paths: (
        # Group by path (path_start events)
        [.[] | select(.eventType=="path_start")] 
        | map({
            timestamp: .timestamp,
            pathLength: .pathLength,
            start: .position,
            target: .targetPosition,
            waypoints: []
          })
      )
    }
  | .paths = (
      # For each path, find waypoint advances within 5 seconds
      .paths | map(. as $path |
        [.[] | select(.eventType=="waypoint_advance" and .timestamp >= $path.timestamp and .timestamp <= ($path.timestamp + 5000))] 
        | map({
            index: .waypointIndex,
            distance: .distanceToTarget,
            position: .position
          })
      )
    )
' | jq -r '.[] | "Bot \(.botId): \(.paths | length) paths"' | head -10

echo ""
echo "🔍 Waypoint Distance Distribution:"
curl -s "$API_URL/dev/movement/logs?count=5000" | jq '[.events[] | select(.eventType=="waypoint_advance")] | [.[] | .distanceToTarget | floor] | group_by(.) | map({distance: .[0], count: length}) | sort_by(.distance)'

echo ""
echo "⚠️ Potential Issues:"
echo "1. Waypoints advanced at >20px (threshold violation):"
curl -s "$API_URL/dev/movement/logs?count=5000" | jq '[.events[] | select(.eventType=="waypoint_advance" and .distanceToTarget > 25)] | length'

echo "2. Paths with very few waypoints (might be cutting corners):"
curl -s "$API_URL/dev/movement/logs?count=5000" | jq '[.events[] | select(.eventType=="path_start" and .pathLength < 3)] | length'

echo "3. Path validation failures:"
curl -s "$API_URL/dev/movement/logs?count=5000" | jq '[.events[] | select(.eventType=="path_fail")] | length'


