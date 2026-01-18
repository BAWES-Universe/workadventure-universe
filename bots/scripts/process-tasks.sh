#!/bin/bash

# Process improvement tasks systematically
# Analyzes all tasks, groups by issue type, and shows what needs fixing

TASKS_DIR="${IMPROVEMENT_TASKS_DIR:-bots/improvement-tasks}"
if [ ! -d "$TASKS_DIR" ]; then
    TASKS_DIR="bots/bots/improvement-tasks"
fi

echo "🔍 Analyzing improvement tasks..."
echo ""

# Count tasks
TASK_COUNT=$(find "$TASKS_DIR" -name "task-*.json" -type f 2>/dev/null | wc -l)
if [ "$TASK_COUNT" -eq 0 ]; then
    echo "✅ No tasks found"
    exit 0
fi

echo "📋 Found $TASK_COUNT task(s)"
echo ""

# Group by error type
echo "📊 Issues by Type:"
echo ""

# Extract all unique errors
find "$TASKS_DIR" -name "task-*.json" -type f 2>/dev/null | while read -r task_file; do
    if command -v jq &> /dev/null; then
        jq -r '.failedTests[]?.errors[]?' "$task_file" 2>/dev/null
    fi
done | sort | uniq -c | sort -rn | head -10

echo ""
echo "📝 Tasks by Priority:"
echo ""

# Show tasks grouped by priority
for priority in critical high medium low; do
    COUNT=$(find "$TASKS_DIR" -name "task-*.json" -type f -exec jq -r 'select(.priority == "'$priority'") | .id' {} \; 2>/dev/null | wc -l)
    if [ "$COUNT" -gt 0 ]; then
        echo "  $priority: $COUNT task(s)"
    fi
done

echo ""
echo "🔧 Recommended Fixes:"
echo ""

# Analyze common issues
REASONING_COUNT=$(find "$TASKS_DIR" -name "task-*.json" -type f -exec grep -l "redacted_reasoning\|<think>" {} \; 2>/dev/null | wc -l)
GREETING_COUNT=$(find "$TASKS_DIR" -name "task-*.json" -type f -exec jq -r 'select(.failedTests[]?.errors[]? | contains("hello") or contains("greeting")) | .id' {} \; 2>/dev/null | wc -l)

if [ "$REASONING_COUNT" -gt 0 ]; then
    echo "  1. Reasoning tags in responses: $REASONING_COUNT task(s)"
    echo "     → Fix: ResponseProcessor.ts - cleanSystemPromptLeakage()"
fi

if [ "$GREETING_COUNT" -gt 0 ]; then
    echo "  2. Greeting test failures: $GREETING_COUNT task(s)"
    echo "     → Fix: Test expectations or system prompts in AIService.ts"
fi

echo ""
echo "💡 To view a specific task:"
echo "   cat $TASKS_DIR/task-*.json | jq ."
echo ""
echo "💡 To clean up resolved tasks:"
echo "   rm $TASKS_DIR/task-{id}.json"
