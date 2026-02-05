#!/bin/bash

# Check if self-improvement system is ready

echo "🔍 Checking self-improvement system status..."
echo ""

# Check environment
echo "📋 Environment:"
if [ "$NODE_ENV" = "development" ]; then
    echo "  ✅ NODE_ENV=development (improvement system enabled)"
else
    echo "  ⚠️  NODE_ENV=$NODE_ENV (improvement system disabled - set NODE_ENV=development)"
fi

# Check if bot server is running
echo ""
echo "🌐 Bot Server:"
API_URL="${API_URL:-http://localhost:3001}"
if curl -s -f "$API_URL/health" > /dev/null 2>&1; then
    echo "  ✅ Bot server is running at $API_URL"
    
    # Try to get a bot list
    BOTS=$(curl -s "$API_URL/api/bots" 2>/dev/null | jq -r '.[] | .botId' 2>/dev/null || echo "")
    if [ -n "$BOTS" ]; then
        echo "  ✅ Found active bots:"
        echo "$BOTS" | while read bot; do
            echo "     - $bot"
        done
    else
        echo "  ⚠️  No active bots found (spawn a bot via Admin API)"
    fi
else
    echo "  ❌ Bot server not responding at $API_URL"
    echo "     Start it with: npm run dev (in bots directory)"
fi

# Check Admin API
echo ""
echo "🔗 Admin API:"
ADMIN_API_URL="${ADMIN_API_URL:-http://localhost:3000}"
if curl -s -f "$ADMIN_API_URL/health" > /dev/null 2>&1; then
    echo "  ✅ Admin API is running at $ADMIN_API_URL"
else
    echo "  ⚠️  Admin API not responding (metrics/conversations won't be stored)"
fi

# Check improvement endpoints
echo ""
echo "🚀 Improvement System:"
if [ "$NODE_ENV" = "development" ]; then
    if curl -s -f "$API_URL/api/bots/improve/recommendations?botId=test" > /dev/null 2>&1; then
        echo "  ✅ Improvement endpoints are available"
    else
        echo "  ⚠️  Improvement endpoints not responding (may need to restart bot server)"
    fi
else
    echo "  ⚠️  Improvement system disabled (set NODE_ENV=development)"
fi

echo ""
echo "📊 Next Steps:"
echo "  1. Ensure NODE_ENV=development"
echo "  2. Start bot server: npm run dev"
echo "  3. Spawn a bot via Admin API"
echo "  4. Have conversations with the bot (to generate metrics)"
echo "  5. Run: ./bots/scripts/iterate.sh <bot-id> analyze"
echo ""
