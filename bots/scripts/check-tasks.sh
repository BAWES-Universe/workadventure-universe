#!/bin/bash

# Quick script to check for improvement tasks

TASKS_DIR="${IMPROVEMENT_TASKS_DIR:-bots/improvement-tasks}"

echo "🔍 Checking for improvement tasks..."
echo ""

if [ ! -d "$TASKS_DIR" ]; then
    echo "⚠️  Tasks directory does not exist: $TASKS_DIR"
    echo "   AutoPilot will create it when tasks are generated"
    exit 0
fi

TASK_COUNT=$(ls -1 "$TASKS_DIR"/*.json 2>/dev/null | wc -l)

if [ "$TASK_COUNT" -eq 0 ]; then
    echo "✅ No pending tasks - all bots are performing well!"
    exit 0
fi

echo "📋 Found $TASK_COUNT pending task(s):"
echo ""

# List tasks sorted by modification time (newest first)
ls -lt "$TASKS_DIR"/*.json 2>/dev/null | head -10 | while read -r line; do
    if [ -n "$line" ]; then
        FILE=$(echo "$line" | awk '{print $NF}')
        TASK_ID=$(basename "$FILE" .json)
        MODIFIED=$(echo "$line" | awk '{print $6, $7, $8}')
        
        # Try to get priority from task file
        if command -v jq &> /dev/null; then
            PRIORITY=$(jq -r '.priority' "$FILE" 2>/dev/null || echo "unknown")
            FAILED_TESTS=$(jq -r '.failedTests | length' "$FILE" 2>/dev/null || echo "0")
            RECOMMENDATIONS=$(jq -r '.recommendations | length' "$FILE" 2>/dev/null || echo "0")
            
            echo "  📝 $TASK_ID"
            echo "     Priority: $PRIORITY | Failed tests: $FAILED_TESTS | Recommendations: $RECOMMENDATIONS"
            echo "     Modified: $MODIFIED"
            echo ""
        else
            echo "  📝 $TASK_ID (modified: $MODIFIED)"
        fi
    fi
done

echo ""
echo "💡 To view a task:"
echo "   cat $TASKS_DIR/task-*.json | jq ."
echo ""
echo "💡 To resolve a task (after fixing):"
echo "   rm $TASKS_DIR/task-{id}.json"
echo ""
echo "📖 See: bots/docs/improvement/AUTOPILOT_WORKFLOW.md for workflow"
