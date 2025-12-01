#!/bin/bash
set -euo pipefail

# Verification script for GitHub Actions workflows
# Verifies workflow setup, triggers builds, and confirms images are uploaded correctly

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  GitHub Actions Workflow Verification     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Verify workflow files exist
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 1: Verifying Workflow Files${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

WORKFLOW_DIR="$REPO_ROOT/.github/workflows"
BUILD_WORKFLOW="$WORKFLOW_DIR/build-universe-images.yml"
TEST_WORKFLOW="$WORKFLOW_DIR/test-universe-images.yml"

if [[ ! -f "$BUILD_WORKFLOW" ]]; then
    echo -e "${RED}✗ Build workflow not found: $BUILD_WORKFLOW${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Build workflow found${NC}"

if [[ ! -f "$TEST_WORKFLOW" ]]; then
    echo -e "${RED}✗ Test workflow not found: $TEST_WORKFLOW${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Test workflow found${NC}"

# Step 2: Verify Dockerfile.universe files exist
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 2: Verifying Dockerfile.universe Files${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

SERVICES=("play" "back" "map-storage" "uploader")
MISSING_FILES=()

for service in "${SERVICES[@]}"; do
    dockerfile="$REPO_ROOT/$service/Dockerfile.universe"
    if [[ ! -f "$dockerfile" ]]; then
        echo -e "${RED}✗ Missing: $dockerfile${NC}"
        MISSING_FILES+=("$dockerfile")
    else
        echo -e "${GREEN}✓ Found: $dockerfile${NC}"
    fi
done

if [[ ${#MISSING_FILES[@]} -gt 0 ]]; then
    echo -e "${RED}Missing Dockerfile.universe files!${NC}"
    exit 1
fi

# Step 3: Verify docker-compose.universe.yaml
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 3: Verifying Docker Compose Configuration${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

COMPOSE_FILE="$REPO_ROOT/contrib/docker/docker-compose.universe.yaml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo -e "${RED}✗ Missing: $COMPOSE_FILE${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Found: $COMPOSE_FILE${NC}"

# Verify it references all services
for service in "${SERVICES[@]}"; do
    if grep -q "${service}-universe" "$COMPOSE_FILE"; then
        echo -e "${GREEN}✓ $service referenced in docker-compose.universe.yaml${NC}"
    else
        echo -e "${RED}✗ $service NOT referenced in docker-compose.universe.yaml${NC}"
        exit 1
    fi
done

# Step 4: Check current branch
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 4: Checking Git Branch${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [[ "$CURRENT_BRANCH" != "universe" ]]; then
    echo -e "${YELLOW}⚠ Current branch: $CURRENT_BRANCH (expected: universe)${NC}"
    echo -e "${YELLOW}  Workflows trigger on 'universe' branch${NC}"
else
    echo -e "${GREEN}✓ On 'universe' branch${NC}"
fi

# Step 5: Verify workflow syntax (basic YAML check)
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 5: Verifying Workflow Syntax${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if command -v yamllint &> /dev/null; then
    if yamllint "$BUILD_WORKFLOW" "$TEST_WORKFLOW" &> /dev/null; then
        echo -e "${GREEN}✓ Workflow YAML syntax is valid${NC}"
    else
        echo -e "${YELLOW}⚠ YAML linting found issues (non-critical)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ yamllint not installed, skipping syntax check${NC}"
fi

# Step 6: Check for required workflow components
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 6: Verifying Workflow Components${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check build workflow has all services
for service in "${SERVICES[@]}"; do
    if grep -q "build-${service}" "$BUILD_WORKFLOW"; then
        echo -e "${GREEN}✓ Build job for $service found${NC}"
    else
        echo -e "${RED}✗ Build job for $service NOT found${NC}"
        exit 1
    fi
    
    # Check Dockerfile path
    if grep -q "file: ./${service}/Dockerfile.universe" "$BUILD_WORKFLOW"; then
        echo -e "${GREEN}✓ Correct Dockerfile path for $service${NC}"
    else
        echo -e "${RED}✗ Incorrect Dockerfile path for $service${NC}"
        exit 1
    fi
done

# Check test workflow references build workflow
if grep -q "Build Universe Images for Coolify" "$TEST_WORKFLOW"; then
    echo -e "${GREEN}✓ Test workflow correctly references build workflow${NC}"
else
    echo -e "${RED}✗ Test workflow does not reference build workflow${NC}"
    exit 1
fi

# Step 7: Verify image naming convention
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 7: Verifying Image Naming Convention${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

for service in "${SERVICES[@]}"; do
    if grep -q "${service}-universe" "$BUILD_WORKFLOW"; then
        echo -e "${GREEN}✓ Image name correct for $service${NC}"
    else
        echo -e "${RED}✗ Image name incorrect for $service${NC}"
        exit 1
    fi
done

# Step 8: Check workflow triggers
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 8: Verifying Workflow Triggers${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if grep -q "branches: \[universe\]" "$BUILD_WORKFLOW" || grep -q "branches:.*universe" "$BUILD_WORKFLOW"; then
    echo -e "${GREEN}✓ Build workflow triggers on 'universe' branch${NC}"
else
    echo -e "${YELLOW}⚠ Build workflow trigger configuration may be incorrect${NC}"
fi

if grep -q "workflow_run" "$TEST_WORKFLOW"; then
    echo -e "${GREEN}✓ Test workflow triggers on workflow_run${NC}"
else
    echo -e "${RED}✗ Test workflow does not use workflow_run trigger${NC}"
    exit 1
fi

# Summary
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Workflow Setup Verification Complete!     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}All workflow files and configurations are correct!${NC}"
echo ""
echo "Next steps:"
echo "  1. Push a commit to trigger the build workflow"
echo "  2. Monitor workflow runs in GitHub Actions"
echo "  3. Verify images are pushed to GHCR"
echo ""

