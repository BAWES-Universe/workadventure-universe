#!/bin/bash

# Active monitoring and improvement script
# This script continuously monitors for task files and prompts AI to improve

TASKS_DIR="${IMPROVEMENT_TASKS_DIR:-bots/improvement-tasks}"
CHECK_INTERVAL=5  # Check every 5 seconds

echo "🔍 AutoPilot Active Monitor Started"
echo "   Checking for tasks every ${CHECK_INTERVAL} seconds"
echo "   Tasks directory: $TASKS_DIR"
echo ""

LAST_COUNT=0

while true; do
    # Count task files
    TASK_COUNT=$(ls -1 "$TASKS_DIR"/*.json 2>/dev/null | wc -l)
    
    if [ "$TASK_COUNT" -gt "$LAST_COUNT" ]; then
        NEW_TASKS=$((TASK_COUNT - LAST_COUNT))
        echo "📋 NEW TASK(S) DETECTED: $NEW_TASKS new task(s) found!"
        echo ""
        
        # List new tasks
        ls -t "$TASKS_DIR"/*.json 2>/dev/null | head -$NEW_TASKS | while read -r task_file; do
            TASK_ID=$(basename "$task_file" .json)
            echo "   📝 $TASK_ID"
            
            # Show priority if jq is available
            if command -v jq &> /dev/null; then
                PRIORITY=$(jq -r '.priority' "$task_file" 2>/dev/null || echo "unknown")
                FAILED=$(jq -r '.failedTests | length' "$task_file" 2>/dev/null || echo "0")
                echo "      Priority: $PRIORITY | Failed tests: $FAILED"
            fi
        done
        
        echo ""
        echo "💡 AI Assistant: Please check and improve based on these tasks"
        echo "   Run: cat $TASKS_DIR/task-*.json | jq ."
        echo ""
    fi
    
    LAST_COUNT=$TASK_COUNT
    
    # Sleep
    sleep $CHECK_INTERVAL
done
