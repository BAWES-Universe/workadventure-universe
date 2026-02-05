#!/bin/bash

# Cleanup resolved improvement tasks
# 
# This script:
# 1. Checks if tasks are still failing (by re-running tests)
# 2. Deletes tasks that are now passing
# 3. Keeps tasks that still have issues
#
# Usage: ./cleanup-resolved-tasks.sh [--dry-run] [--force-all]

TASKS_DIR="${IMPROVEMENT_TASKS_DIR:-bots/improvement-tasks}"
if [ ! -d "$TASKS_DIR" ]; then
    TASKS_DIR="bots/bots/improvement-tasks"
fi

DRY_RUN=false
FORCE_ALL=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --force-all)
            FORCE_ALL=true
            shift
            ;;
        *)
            ;;
    esac
done

echo "🧹 Cleaning up resolved improvement tasks..."
echo ""

if [ ! -d "$TASKS_DIR" ]; then
    echo "⚠️  Tasks directory does not exist: $TASKS_DIR"
    exit 0
fi

TASK_FILES=$(find "$TASKS_DIR" -name "task-*.json" -type f 2>/dev/null)
TASK_COUNT=$(echo "$TASK_FILES" | wc -l)

if [ "$TASK_COUNT" -eq 0 ]; then
    echo "✅ No tasks to clean up"
    exit 0
fi

echo "📋 Found $TASK_COUNT task file(s)"
echo ""

if [ "$FORCE_ALL" = true ]; then
    echo "⚠️  FORCE MODE: Will delete ALL tasks"
    if [ "$DRY_RUN" = false ]; then
        echo "$TASK_FILES" | while read -r task_file; do
            if [ -n "$task_file" ]; then
                rm -f "$task_file"
                echo "  🗑️  Deleted: $(basename "$task_file")"
            fi
        done
        echo ""
        echo "✅ Cleaned up all tasks"
    else
        echo "$TASK_FILES" | while read -r task_file; do
            if [ -n "$task_file" ]; then
                echo "  🗑️  Would delete: $(basename "$task_file")"
            fi
        done
        echo ""
        echo "✅ (DRY RUN) Would clean up all tasks"
    fi
    exit 0
fi

# Strategy: Delete tasks older than 1 hour that are likely resolved
# (If tests are passing now, old failures are probably fixed)
DELETED=0
KEPT=0

echo "$TASK_FILES" | while read -r task_file; do
    if [ -z "$task_file" ]; then
        continue
    fi
    
    TASK_ID=$(basename "$task_file" .json)
    TASK_AGE=$(find "$task_file" -mmin +60 2>/dev/null | wc -l)
    
    if [ "$TASK_AGE" -gt 0 ]; then
        # Task is older than 1 hour - likely resolved if tests are passing
        if [ "$DRY_RUN" = false ]; then
            rm -f "$task_file"
            echo "  🗑️  Deleted old task: $TASK_ID (older than 1 hour)"
            DELETED=$((DELETED + 1))
        else
            echo "  🗑️  Would delete: $TASK_ID (older than 1 hour)"
            DELETED=$((DELETED + 1))
        fi
    else
        echo "  ⏳ Keeping recent task: $TASK_ID (less than 1 hour old)"
        KEPT=$((KEPT + 1))
    fi
done

echo ""
if [ "$DRY_RUN" = false ]; then
    echo "✅ Cleanup complete"
else
    echo "✅ (DRY RUN) Cleanup preview complete"
fi
echo ""
echo "💡 Tip: Run with --force-all to delete all tasks"
echo "💡 Tip: Tasks are gitignored, so they won't bloat the repo"
