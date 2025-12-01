#!/bin/bash
set -euo pipefail

# Check GitHub Actions workflow status using GitHub API
# This doesn't require authentication for public repos

REPO_OWNER="BAWES-Universe"
REPO_NAME="workadventure-universe"
BUILD_WORKFLOW="build-universe-images.yml"
TEST_WORKFLOW="test-universe-images.yml"

echo "Checking GitHub Actions workflow status..."
echo ""

# Check build workflow
echo "📦 Build Workflow Status:"
BUILD_RUNS=$(curl -s "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${BUILD_WORKFLOW}/runs?per_page=1" 2>/dev/null || echo "")

if [[ -n "$BUILD_RUNS" && "$BUILD_RUNS" != "null" ]]; then
    STATUS=$(echo "$BUILD_RUNS" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    CONCLUSION=$(echo "$BUILD_RUNS" | grep -o '"conclusion":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    CREATED_AT=$(echo "$BUILD_RUNS" | grep -o '"created_at":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    HTML_URL=$(echo "$BUILD_RUNS" | grep -o '"html_url":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    
    echo "  Status: $STATUS"
    echo "  Conclusion: ${CONCLUSION:-pending}"
    echo "  Created: $CREATED_AT"
    if [[ -n "$HTML_URL" ]]; then
        echo "  URL: $HTML_URL"
    fi
else
    echo "  ⚠ Could not fetch workflow status"
fi

echo ""
echo "🧪 Test Workflow Status:"
TEST_RUNS=$(curl -s "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${TEST_WORKFLOW}/runs?per_page=1" 2>/dev/null || echo "")

if [[ -n "$TEST_RUNS" && "$TEST_RUNS" != "null" ]]; then
    STATUS=$(echo "$TEST_RUNS" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    CONCLUSION=$(echo "$TEST_RUNS" | grep -o '"conclusion":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    CREATED_AT=$(echo "$TEST_RUNS" | grep -o '"created_at":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    HTML_URL=$(echo "$TEST_RUNS" | grep -o '"html_url":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    
    echo "  Status: $STATUS"
    echo "  Conclusion: ${CONCLUSION:-pending}"
    echo "  Created: $CREATED_AT"
    if [[ -n "$HTML_URL" ]]; then
        echo "  URL: $HTML_URL"
    fi
else
    echo "  ⚠ Could not fetch workflow status"
fi

echo ""
echo "View all workflows:"
echo "  https://github.com/${REPO_OWNER}/${REPO_NAME}/actions"

