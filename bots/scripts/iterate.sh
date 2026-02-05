#!/bin/bash

# Continuous Iteration Script
# Helps you test, analyze, and improve bots continuously

set -e

BOT_ID="${1:-}"
API_URL="${API_URL:-http://localhost:3000}"

if [ -z "$BOT_ID" ]; then
    echo "Usage: ./iterate.sh <bot-id> [command]"
    echo ""
    echo "Commands:"
    echo "  test          - Run test suite"
    echo "  analyze      - Get improvement recommendations"
    echo "  improve      - Run improvement cycle"
    echo "  metrics      - View current metrics"
    echo "  cycle        - Full cycle: test -> analyze -> improve -> test"
    echo ""
    echo "Examples:"
    echo "  ./iterate.sh bot-123 test"
    echo "  ./iterate.sh bot-123 cycle"
    exit 1
fi

COMMAND="${2:-cycle}"

case "$COMMAND" in
    test)
        echo "🧪 Running test suite for $BOT_ID..."
        curl -X POST "$API_URL/api/bots/test/run-suite" \
            -H "Content-Type: application/json" \
            -d "{\"botId\":\"$BOT_ID\",\"testSuite\":{\"id\":\"default\",\"name\":\"Default Tests\",\"botId\":\"$BOT_ID\",\"testCases\":[]}}" \
            | jq '.'
        ;;
    
    analyze)
        echo "🔍 Analyzing bot $BOT_ID..."
        curl -X GET "$API_URL/api/bots/improve/recommendations?botId=$BOT_ID" \
            | jq '.'
        ;;
    
    improve)
        echo "🚀 Running improvement cycle for $BOT_ID..."
        curl -X POST "$API_URL/api/bots/improve/cycle" \
            -H "Content-Type: application/json" \
            -d "{\"botId\":\"$BOT_ID\"}" \
            | jq '.'
        ;;
    
    metrics)
        echo "📊 Metrics for $BOT_ID:"
        curl -X GET "$API_URL/api/bots/$BOT_ID/metrics?limit=10" \
            | jq '.'
        ;;
    
    cycle)
        echo "🔄 Running full iteration cycle for $BOT_ID..."
        echo ""
        
        echo "Step 1: Getting current metrics..."
        curl -s -X GET "$API_URL/api/bots/$BOT_ID/metrics?limit=10" > /tmp/metrics_before.json
        echo "✅ Baseline metrics saved"
        echo ""
        
        echo "Step 2: Analyzing for improvements..."
        curl -s -X GET "$API_URL/api/bots/improve/recommendations?botId=$BOT_ID" > /tmp/recommendations.json
        cat /tmp/recommendations.json | jq '.'
        echo ""
        
        echo "Step 3: Running improvement cycle..."
        curl -s -X POST "$API_URL/api/bots/improve/cycle" \
            -H "Content-Type: application/json" \
            -d "{\"botId\":\"$BOT_ID\"}" > /tmp/improvement.json
        cat /tmp/improvement.json | jq '.'
        echo ""
        
        echo "Step 4: Getting updated metrics..."
        curl -s -X GET "$API_URL/api/bots/$BOT_ID/metrics?limit=10" > /tmp/metrics_after.json
        echo "✅ Updated metrics saved"
        echo ""
        
        echo "📊 Comparison:"
        echo "Before:"
        cat /tmp/metrics_before.json | jq '[.[] | .metrics] | add | {repetitionScore, personalityCompliance, conversationQuality}'
        echo ""
        echo "After:"
        cat /tmp/metrics_after.json | jq '[.[] | .metrics] | add | {repetitionScore, personalityCompliance, conversationQuality}'
        echo ""
        
        echo "✅ Iteration cycle complete!"
        echo "📁 Results saved to:"
        echo "   - /tmp/metrics_before.json"
        echo "   - /tmp/recommendations.json"
        echo "   - /tmp/improvement.json"
        echo "   - /tmp/metrics_after.json"
        ;;
    
    *)
        echo "Unknown command: $COMMAND"
        echo "Run './iterate.sh $BOT_ID' for usage"
        exit 1
        ;;
esac
