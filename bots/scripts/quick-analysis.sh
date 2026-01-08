#!/bin/bash
# Quick movement analysis script

echo "=== Quick Movement Analysis ==="
echo ""

# Count MovementLogger entries
echo "📊 MovementLogger entries in logs:"
docker compose -f docker-compose.yaml -f docker-compose.bots.yaml logs bot-server --tail 50000 2>&1 | grep "MovementLogger" | wc -l

echo ""
echo "📝 Recent MovementLogger entries (last 20):"
docker compose -f docker-compose.yaml -f docker-compose.bots.yaml logs bot-server --tail 50000 2>&1 | grep "MovementLogger" | tail -20

echo ""
echo "🔍 Speed analysis from logs:"
docker compose -f docker-compose.yaml -f docker-compose.bots.yaml logs bot-server --tail 50000 2>&1 | grep -E "MovementLogger.*speed|MovementLogger.*effectiveSpeed|MovementLogger.*moveDistance" | tail -20

echo ""
echo "✅ Analysis complete"

