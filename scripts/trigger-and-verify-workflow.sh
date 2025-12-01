#!/bin/bash
set -euo pipefail

# Script to trigger GitHub Actions workflow and verify images are uploaded
# This script makes a test commit, triggers the workflow, and verifies results

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Trigger & Verify GitHub Actions Workflow ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Check if we're on universe branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "universe" ]]; then
    echo -e "${RED}Error: Must be on 'universe' branch (currently on: $CURRENT_BRANCH)${NC}"
    exit 1
fi

# Check if there are uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}⚠ Uncommitted changes detected${NC}"
    echo "Committing changes..."
    git add -A
    git commit -m "chore: fix test workflow to use branch name tag instead of latest" || true
fi

# Get repository owner from remote
REPO_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [[ "$REPO_URL" =~ github\.com[:/]([^/]+)/([^/]+)\.git ]]; then
    REPO_OWNER="${BASH_REMATCH[1]}"
    REPO_NAME="${BASH_REMATCH[2]%.git}"
else
    echo -e "${RED}Error: Could not determine repository owner from remote${NC}"
    exit 1
fi

echo -e "${BLUE}Repository: ${REPO_OWNER}/${REPO_NAME}${NC}"
echo ""

# Make a test commit to trigger workflow
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 1: Creating test commit to trigger workflow${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Create a small change that will trigger the workflow
TEST_FILE="$REPO_ROOT/.github/workflows/.workflow-test-trigger"
TIMESTAMP=$(date +%s)
echo "# Workflow test trigger - $TIMESTAMP" > "$TEST_FILE"

git add "$TEST_FILE"
git commit -m "chore: trigger workflow test - $(date +%Y%m%d-%H%M%S)" || {
    echo -e "${YELLOW}⚠ No changes to commit (workflow may have been triggered already)${NC}"
}

# Push to trigger workflow
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 2: Pushing to trigger workflow${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if git push origin universe 2>&1; then
    echo -e "${GREEN}✓ Pushed to origin/universe${NC}"
    COMMIT_SHA=$(git rev-parse HEAD)
    echo -e "${GREEN}✓ Commit SHA: ${COMMIT_SHA:0:7}${NC}"
else
    echo -e "${RED}✗ Failed to push${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 3: Workflow Information${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Workflow has been triggered!"
echo ""
echo "Expected images (after build completes):"
echo "  - ghcr.io/${REPO_OWNER}/play-universe:universe"
echo "  - ghcr.io/${REPO_OWNER}/play-universe:universe-${COMMIT_SHA:0:7}"
echo "  - ghcr.io/${REPO_OWNER}/back-universe:universe"
echo "  - ghcr.io/${REPO_OWNER}/back-universe:universe-${COMMIT_SHA:0:7}"
echo "  - ghcr.io/${REPO_OWNER}/map-storage-universe:universe"
echo "  - ghcr.io/${REPO_OWNER}/map-storage-universe:universe-${COMMIT_SHA:0:7}"
echo "  - ghcr.io/${REPO_OWNER}/uploader-universe:universe"
echo "  - ghcr.io/${REPO_OWNER}/uploader-universe:universe-${COMMIT_SHA:0:7}"
echo ""
echo "Monitor workflow at:"
echo "  https://github.com/${REPO_OWNER}/${REPO_NAME}/actions"
echo ""
echo -e "${YELLOW}Note: It may take 5-15 minutes for the build to complete${NC}"
echo ""

# Check if we can verify images (requires docker and authentication)
if command -v docker &> /dev/null; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 4: Waiting and Verifying Images${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${YELLOW}Waiting 60 seconds for workflow to start...${NC}"
    sleep 60
    
    echo ""
    echo "Attempting to verify images in GHCR..."
    echo "(This requires authentication - images may be private)"
    echo ""
    
    SERVICES=("play" "back" "map-storage" "uploader")
    BRANCH_TAG="universe"
    SHA_TAG="universe-${COMMIT_SHA:0:7}"
    
    for service in "${SERVICES[@]}"; do
        IMAGE_BRANCH="ghcr.io/${REPO_OWNER}/${service}-universe:${BRANCH_TAG}"
        IMAGE_SHA="ghcr.io/${REPO_OWNER}/${service}-universe:${SHA_TAG}"
        
        echo -n "Checking ${service} (branch tag)... "
        if docker manifest inspect "$IMAGE_BRANCH" &> /dev/null; then
            echo -e "${GREEN}✓ Found${NC}"
        else
            echo -e "${YELLOW}⚠ Not found yet (workflow may still be running)${NC}"
        fi
        
        echo -n "Checking ${service} (SHA tag)... "
        if docker manifest inspect "$IMAGE_SHA" &> /dev/null; then
            echo -e "${GREEN}✓ Found${NC}"
        else
            echo -e "${YELLOW}⚠ Not found yet (workflow may still be running)${NC}"
        fi
    done
    
    echo ""
    echo -e "${YELLOW}If images are not found, the workflow may still be running.${NC}"
    echo -e "${YELLOW}Check GitHub Actions for current status.${NC}"
else
    echo -e "${YELLOW}Docker not available - skipping image verification${NC}"
    echo "You can verify images manually at:"
    echo "  https://github.com/${REPO_OWNER}?tab=packages"
fi

echo ""
echo -e "${GREEN}Workflow trigger complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Monitor workflow: https://github.com/${REPO_OWNER}/${REPO_NAME}/actions"
echo "  2. Wait for build workflow to complete"
echo "  3. Test workflow will run automatically after build succeeds"
echo "  4. Verify images at: https://github.com/${REPO_OWNER}?tab=packages"
echo ""

