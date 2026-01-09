#!/bin/bash
# Script to analyze bot movement patterns

API_URL="${BOT_API_URL:-http://bot-server.workadventure.localhost}"

echo "=== Bot Movement Analysis ==="
echo ""

# Check if API is available
if ! curl -s "$API_URL/health" > /dev/null; then
    echo "❌ Bot server API not available at $API_URL"
    exit 1
fi

# Get summary
echo "📊 Summary:"
curl -s "$API_URL/dev/movement/summary" 2>/dev/null | jq '.' || echo "No data yet"
echo ""

# Get recent movement logs
echo "📝 Recent Movement Events (last 20):"
curl -s "$API_URL/dev/movement/logs?count=20" 2>/dev/null | jq -r '.events[]? | select(.eventType=="move") | "\(.botId[0:8]) | \(.eventType) | speed:\(.speed // "N/A") | dist:\(.distanceToTarget // "N/A")"' | head -20 || echo "No movement events yet"
echo ""

# Analyze each bot
echo "🔍 Bot Analysis:"
BOT_IDS=$(curl -s "$API_URL/dev/movement/logs?count=100" 2>/dev/null | jq -r '.events[].botId' 2>/dev/null | sort -u | head -5)

if [ -z "$BOT_IDS" ]; then
    echo "No bots with movement data yet"
else
    for BOT_ID in $BOT_IDS; do
        if [ -n "$BOT_ID" ]; then
            echo ""
            echo "Bot: ${BOT_ID:0:8}"
            curl -s "$API_URL/dev/movement/analyze/$BOT_ID?timeWindow=30000" 2>/dev/null | jq '.' || echo "No data"
        fi
    done
fi

echo ""
echo "✅ Analysis complete"

