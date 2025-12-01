#!/bin/bash
set -euo pipefail

# Main orchestration script for WorkAdventure Universe deployment
# Orchestrates: build → verify → push workflow

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script paths
BUILD_SCRIPT="$SCRIPT_DIR/build-universe.sh"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-universe.sh"
PUSH_SCRIPT="$SCRIPT_DIR/push-universe.sh"

# Default values
DOCKER_USERNAME="${DOCKER_USERNAME:-}"
VERSION="${VERSION:-latest}"

# Parse command line arguments
SKIP_BUILD=false
SKIP_VERIFY=false
SKIP_PUSH=false
DRY_RUN=false
SERVICE_ONLY=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --docker-username)
            DOCKER_USERNAME="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-verify)
            SKIP_VERIFY=true
            shift
            ;;
        --skip-push)
            SKIP_PUSH=true
            shift
            ;;
        --service)
            SERVICE_ONLY="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Orchestrate WorkAdventure Universe build → verify → push workflow"
            echo ""
            echo "Options:"
            echo "  --docker-username USER    Docker Hub username (required for push)"
            echo "  --version VERSION          Image version tag (default: latest)"
            echo "  --service SERVICE          Process only specific service"
            echo "  --skip-build               Skip build step"
            echo "  --skip-verify              Skip verification step"
            echo "  --skip-push                Skip push step"
            echo "  --dry-run                  Dry run mode (build only, no push)"
            echo "  --help                     Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  DOCKER_USERNAME            Docker Hub username"
            echo "  VERSION                    Image version tag"
            echo "  SENTRY_*                   Sentry configuration (optional)"
            echo ""
            echo "Example:"
            echo "  $0 --docker-username myuser --version v1.0.0"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Validate scripts exist
for script in "$BUILD_SCRIPT" "$VERIFY_SCRIPT" "$PUSH_SCRIPT"; do
    if [[ ! -f "$script" ]]; then
        echo -e "${RED}Error: Script not found: $script${NC}"
        exit 1
    fi
done

# Make scripts executable
chmod +x "$BUILD_SCRIPT" "$VERIFY_SCRIPT" "$PUSH_SCRIPT" 2>/dev/null || true

# Build common arguments
BUILD_ARGS=()
VERIFY_ARGS=()
PUSH_ARGS=()

if [[ -n "$DOCKER_USERNAME" ]]; then
    BUILD_ARGS+=("--docker-username" "$DOCKER_USERNAME")
    VERIFY_ARGS+=("--docker-username" "$DOCKER_USERNAME")
    PUSH_ARGS+=("--docker-username" "$DOCKER_USERNAME")
fi

if [[ -n "$VERSION" ]]; then
    BUILD_ARGS+=("--version" "$VERSION")
    VERIFY_ARGS+=("--version" "$VERSION")
    PUSH_ARGS+=("--version" "$VERSION")
fi

if [[ -n "$SERVICE_ONLY" ]]; then
    BUILD_ARGS+=("--service" "$SERVICE_ONLY")
    VERIFY_ARGS+=("--service" "$SERVICE_ONLY")
    PUSH_ARGS+=("--service" "$SERVICE_ONLY")
fi

if [[ "$DRY_RUN" == "true" ]]; then
    BUILD_ARGS+=("--dry-run")
    SKIP_PUSH=true
fi

# Main workflow
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  WorkAdventure Universe Deploy Script    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "Configuration:"
echo "  Docker Username: ${DOCKER_USERNAME:-<not set>}"
echo "  Version: $VERSION"
if [[ -n "$SERVICE_ONLY" ]]; then
    echo "  Service: $SERVICE_ONLY"
fi
echo ""

# Step 1: Build
if [[ "$SKIP_BUILD" != "true" ]]; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 1: Building Images${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    if ! "$BUILD_SCRIPT" "${BUILD_ARGS[@]}"; then
        echo -e "${RED}✗ Build failed${NC}"
        exit 1
    fi
    
    echo ""
    echo -e "${GREEN}✓ Build completed successfully${NC}"
    echo ""
else
    echo -e "${YELLOW}⏭ Skipping build step${NC}"
    echo ""
fi

# Step 2: Verify
if [[ "$SKIP_VERIFY" != "true" ]]; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 2: Verifying Images${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    if ! "$VERIFY_SCRIPT" "${VERIFY_ARGS[@]}"; then
        echo -e "${RED}✗ Verification failed${NC}"
        echo ""
        echo -e "${YELLOW}Images were built but failed verification.${NC}"
        echo -e "${YELLOW}They will NOT be pushed to Docker Hub.${NC}"
        exit 1
    fi
    
    echo ""
    echo -e "${GREEN}✓ Verification completed successfully${NC}"
    echo ""
else
    echo -e "${YELLOW}⏭ Skipping verification step${NC}"
    echo ""
fi

# Step 3: Push
if [[ "$SKIP_PUSH" != "true" ]]; then
    if [[ -z "$DOCKER_USERNAME" ]]; then
        echo -e "${YELLOW}⚠ Docker username not set, skipping push${NC}"
        echo "Set DOCKER_USERNAME or use --docker-username to push images"
    else
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${BLUE}Step 3: Pushing Images to Docker Hub${NC}"
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        
        if ! "$PUSH_SCRIPT" "${PUSH_ARGS[@]}"; then
            echo -e "${RED}✗ Push failed${NC}"
            exit 1
        fi
        
        echo ""
        echo -e "${GREEN}✓ Push completed successfully${NC}"
        echo ""
    fi
else
    echo -e "${YELLOW}⏭ Skipping push step${NC}"
    echo ""
fi

# Final summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Deployment Complete!                     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [[ "$SKIP_PUSH" != "true" && -n "$DOCKER_USERNAME" ]]; then
    echo "Images are now available on Docker Hub:"
    for service in play back map-storage uploader; do
        if [[ -z "$SERVICE_ONLY" || "$SERVICE_ONLY" == "$service" ]]; then
            echo "  - ${DOCKER_USERNAME}/${service}-universe:${VERSION}"
        fi
    done
    echo ""
    echo "You can now deploy these images in Coolify:"
    echo "  1. Create a new resource in Coolify"
    echo "  2. Choose 'Docker Image' as source"
    echo "  3. Enter: ${DOCKER_USERNAME}/play-universe:${VERSION}"
    echo "  4. Configure environment variables and deploy!"
else
    echo "Images built and verified locally."
    if [[ -z "$DOCKER_USERNAME" ]]; then
        echo "Set DOCKER_USERNAME and run push-universe.sh to publish them."
    fi
fi

echo ""

