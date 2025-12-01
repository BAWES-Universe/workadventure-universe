#!/bin/bash
set -euo pipefail

# Script to monitor GitHub Actions workflow and verify images are uploaded correctly
# This script checks workflow status and verifies images in GHCR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get repository info
REPO_URL=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")
if [[ "$REPO_URL" =~ github\.com[:/]([^/]+)/([^/]+)\.git ]]; then
    REPO_OWNER="${BASH_REMATCH[1]}"
    REPO_NAME="${BASH_REMATCH[2]%.git}"
else
    echo -e "${RED}Error: Could not determine repository from remote${NC}"
    exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Monitor & Verify GitHub Actions Workflow${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "Repository: ${REPO_OWNER}/${REPO_NAME}"
echo ""

# Get latest commit SHA
LATEST_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "")
if [[ -n "$LATEST_SHA" ]]; then
    echo -e "${BLUE}Latest commit: ${LATEST_SHA:0:7}${NC}"
    echo ""
fi

# Check if GitHub CLI is available
if command -v gh &> /dev/null; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Checking Workflow Status (via GitHub CLI)${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    # Check if authenticated
    if gh auth status &> /dev/null; then
        echo -e "${GREEN}✓ GitHub CLI authenticated${NC}"
        echo ""
        
        # Get latest workflow run
        echo "Fetching latest workflow runs..."
        BUILD_RUN=$(gh run list --workflow="build-universe-images.yml" --limit 1 --json databaseId,status,conclusion,headBranch,headSha --jq '.[0]' 2>/dev/null || echo "")
        
        if [[ -n "$BUILD_RUN" && "$BUILD_RUN" != "null" ]]; then
            RUN_ID=$(echo "$BUILD_RUN" | jq -r '.databaseId // empty' 2>/dev/null || echo "")
            STATUS=$(echo "$BUILD_RUN" | jq -r '.status // "unknown"' 2>/dev/null || echo "")
            CONCLUSION=$(echo "$BUILD_RUN" | jq -r '.conclusion // "unknown"' 2>/dev/null || echo "")
            BRANCH=$(echo "$BUILD_RUN" | jq -r '.headBranch // "unknown"' 2>/dev/null || echo "")
            SHA=$(echo "$BUILD_RUN" | jq -r '.headSha // "unknown"' 2>/dev/null || echo "")
            
            echo "Build Workflow:"
            echo "  Run ID: $RUN_ID"
            echo "  Status: $STATUS"
            echo "  Conclusion: $CONCLUSION"
            echo "  Branch: $BRANCH"
            echo "  SHA: ${SHA:0:7}"
            echo ""
            
            if [[ "$STATUS" == "completed" && "$CONCLUSION" == "success" ]]; then
                echo -e "${GREEN}✓ Build workflow completed successfully!${NC}"
                echo ""
                
                # Check test workflow
                TEST_RUN=$(gh run list --workflow="test-universe-images.yml" --limit 1 --json databaseId,status,conclusion --jq '.[0]' 2>/dev/null || echo "")
                if [[ -n "$TEST_RUN" && "$TEST_RUN" != "null" ]]; then
                    TEST_STATUS=$(echo "$TEST_RUN" | jq -r '.status // "unknown"' 2>/dev/null || echo "")
                    TEST_CONCLUSION=$(echo "$TEST_RUN" | jq -r '.conclusion // "unknown"' 2>/dev/null || echo "")
                    
                    echo "Test Workflow:"
                    echo "  Status: $TEST_STATUS"
                    echo "  Conclusion: $TEST_CONCLUSION"
                    echo ""
                    
                    if [[ "$TEST_STATUS" == "completed" && "$TEST_CONCLUSION" == "success" ]]; then
                        echo -e "${GREEN}✓ Test workflow completed successfully!${NC}"
                    elif [[ "$TEST_STATUS" == "in_progress" || "$TEST_STATUS" == "queued" ]]; then
                        echo -e "${YELLOW}⏳ Test workflow is still running...${NC}"
                    elif [[ "$TEST_CONCLUSION" == "failure" ]]; then
                        echo -e "${RED}✗ Test workflow failed${NC}"
                    fi
                else
                    echo -e "${YELLOW}⚠ Test workflow not found yet${NC}"
                fi
            elif [[ "$STATUS" == "in_progress" || "$STATUS" == "queued" ]]; then
                echo -e "${YELLOW}⏳ Build workflow is still running...${NC}"
            elif [[ "$CONCLUSION" == "failure" ]]; then
                echo -e "${RED}✗ Build workflow failed${NC}"
            fi
        else
            echo -e "${YELLOW}⚠ No workflow runs found${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ GitHub CLI not authenticated${NC}"
        echo "Run: gh auth login"
    fi
else
    echo -e "${YELLOW}⚠ GitHub CLI (gh) not installed${NC}"
    echo "Install it to check workflow status automatically"
    echo "Or check manually at: https://github.com/${REPO_OWNER}/${REPO_NAME}/actions"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Verifying Images in GHCR${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

SERVICES=("play" "back" "map-storage" "uploader")
BRANCH_TAG="universe"
SHA_TAG="universe-${LATEST_SHA:0:7}"

if command -v docker &> /dev/null; then
    echo "Checking if images exist in GHCR..."
    echo "(Note: Images may be private and require authentication)"
    echo ""
    
    ALL_FOUND=true
    
    for service in "${SERVICES[@]}"; do
        IMAGE_BRANCH="ghcr.io/${REPO_OWNER}/${service}-universe:${BRANCH_TAG}"
        IMAGE_SHA="ghcr.io/${REPO_OWNER}/${service}-universe:${SHA_TAG}"
        
        echo -n "  ${service} (${BRANCH_TAG})... "
        if docker manifest inspect "$IMAGE_BRANCH" &> /dev/null 2>&1; then
            echo -e "${GREEN}✓ Found${NC}"
        else
            echo -e "${YELLOW}⚠ Not found${NC}"
            ALL_FOUND=false
        fi
        
        if [[ -n "$LATEST_SHA" ]]; then
            echo -n "  ${service} (${SHA_TAG})... "
            if docker manifest inspect "$IMAGE_SHA" &> /dev/null 2>&1; then
                echo -e "${GREEN}✓ Found${NC}"
            else
                echo -e "${YELLOW}⚠ Not found${NC}"
                ALL_FOUND=false
            fi
        fi
    done
    
    echo ""
    if [[ "$ALL_FOUND" == "true" ]]; then
        echo -e "${GREEN}✓ All images found in GHCR!${NC}"
    else
        echo -e "${YELLOW}⚠ Some images not found yet${NC}"
        echo "  - Workflow may still be running"
        echo "  - Images may be private (requires authentication)"
        echo "  - Check workflow status first"
    fi
else
    echo -e "${YELLOW}⚠ Docker not available - cannot verify images${NC}"
    echo "Install Docker to verify images, or check manually at:"
    echo "  https://github.com/${REPO_OWNER}?tab=packages"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Workflow monitoring:"
echo "  https://github.com/${REPO_OWNER}/${REPO_NAME}/actions"
echo ""
echo "Package registry:"
echo "  https://github.com/${REPO_OWNER}?tab=packages"
echo ""
echo "Expected images:"
for service in "${SERVICES[@]}"; do
    echo "  - ghcr.io/${REPO_OWNER}/${service}-universe:${BRANCH_TAG}"
    if [[ -n "$LATEST_SHA" ]]; then
        echo "  - ghcr.io/${REPO_OWNER}/${service}-universe:${SHA_TAG}"
    fi
done
echo ""

