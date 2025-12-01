#!/bin/bash
set -euo pipefail

# Build script for WorkAdventure Universe services
# Builds all services using universe-specific Dockerfiles

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DOCKER_USERNAME="${DOCKER_USERNAME:-}"
VERSION="${VERSION:-latest}"
SERVICES=("play" "back" "map-storage" "uploader")

# Build arguments for play service (Sentry - optional)
SENTRY_RELEASE="${SENTRY_RELEASE:-}"
SENTRY_URL="${SENTRY_URL:-}"
SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN:-}"
SENTRY_ORG="${SENTRY_ORG:-}"
SENTRY_PROJECT="${SENTRY_PROJECT:-}"
SENTRY_ENVIRONMENT="${SENTRY_ENVIRONMENT:-}"

# Build options
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=16384}"
FAST_BUILD="${FAST_BUILD:-}"

# Parse command line arguments
DRY_RUN=false
BUILD_ONLY=""

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
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --service)
            BUILD_ONLY="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Build WorkAdventure Universe Docker images"
            echo ""
            echo "Options:"
            echo "  --docker-username USER    Docker Hub username (required for tagging)"
            echo "  --version VERSION         Image version tag (default: latest)"
            echo "  --service SERVICE         Build only specific service (play, back, map-storage, uploader)"
            echo "  --dry-run                 Show what would be built without actually building"
            echo "  --help                    Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  DOCKER_USERNAME           Docker Hub username"
            echo "  VERSION                   Image version tag"
            echo "  SENTRY_*                  Sentry configuration (optional, for play service)"
            echo "  NODE_OPTIONS              Node.js build options"
            echo "  FAST_BUILD                Fast build flag"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Validate Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: docker command not found${NC}"
    exit 1
fi

# Check if we're in the repo root
if [[ ! -f "$REPO_ROOT/package.json" ]]; then
    echo -e "${RED}Error: Must run from WorkAdventure repository root${NC}"
    exit 1
fi

# Determine which services to build
if [[ -n "$BUILD_ONLY" ]]; then
    if [[ ! " ${SERVICES[@]} " =~ " ${BUILD_ONLY} " ]]; then
        echo -e "${RED}Error: Invalid service '$BUILD_ONLY'${NC}"
        echo "Valid services: ${SERVICES[*]}"
        exit 1
    fi
    SERVICES=("$BUILD_ONLY")
fi

# Function to build a service
build_service() {
    local service=$1
    local dockerfile="$REPO_ROOT/$service/Dockerfile.universe"
    local image_name=""
    
    if [[ -n "$DOCKER_USERNAME" ]]; then
        image_name="${DOCKER_USERNAME}/${service}-universe:${VERSION}"
    else
        image_name="${service}-universe:${VERSION}"
    fi
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Building ${GREEN}$service${BLUE} → ${YELLOW}$image_name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Check if Dockerfile exists
    if [[ ! -f "$dockerfile" ]]; then
        echo -e "${RED}Error: Dockerfile not found: $dockerfile${NC}"
        return 1
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${YELLOW}[DRY RUN] Would build:${NC}"
        echo "  dockerfile: $dockerfile"
        echo "  image: $image_name"
        if [[ "$service" == "play" ]]; then
            echo "  build args: NODE_OPTIONS, FAST_BUILD, SENTRY_*"
        fi
        return 0
    fi
    
    # Build arguments
    local build_args=()
    
    # Common build args
    build_args+=("--build-arg" "NODE_OPTIONS=$NODE_OPTIONS")
    if [[ -n "$FAST_BUILD" ]]; then
        build_args+=("--build-arg" "FAST_BUILD=$FAST_BUILD")
    fi
    
    # Play service specific: Sentry build args
    if [[ "$service" == "play" ]]; then
        if [[ -n "$SENTRY_RELEASE" ]]; then
            build_args+=("--build-arg" "SENTRY_RELEASE=$SENTRY_RELEASE")
        fi
        if [[ -n "$SENTRY_URL" ]]; then
            build_args+=("--build-arg" "SENTRY_URL=$SENTRY_URL")
        fi
        if [[ -n "$SENTRY_AUTH_TOKEN" ]]; then
            build_args+=("--build-arg" "SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN")
        fi
        if [[ -n "$SENTRY_ORG" ]]; then
            build_args+=("--build-arg" "SENTRY_ORG=$SENTRY_ORG")
        fi
        if [[ -n "$SENTRY_PROJECT" ]]; then
            build_args+=("--build-arg" "SENTRY_PROJECT=$SENTRY_PROJECT")
        fi
        if [[ -n "$SENTRY_ENVIRONMENT" ]]; then
            build_args+=("--build-arg" "SENTRY_ENVIRONMENT=$SENTRY_ENVIRONMENT")
        fi
    fi
    
    # Build the image
    cd "$REPO_ROOT"
    if docker build \
        --platform linux/amd64 \
        --file "$dockerfile" \
        --tag "$image_name" \
        "${build_args[@]}" \
        .; then
        echo -e "${GREEN}✓ Successfully built $image_name${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to build $image_name${NC}"
        return 1
    fi
}

# Main build loop
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  WorkAdventure Universe Build Script     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}DRY RUN MODE - No images will be built${NC}"
    echo ""
fi

failed_services=()
successful_services=()

for service in "${SERVICES[@]}"; do
    if build_service "$service"; then
        successful_services+=("$service")
    else
        failed_services+=("$service")
    fi
    echo ""
done

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Build Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [[ ${#successful_services[@]} -gt 0 ]]; then
    echo -e "${GREEN}✓ Successful:${NC} ${successful_services[*]}"
fi

if [[ ${#failed_services[@]} -gt 0 ]]; then
    echo -e "${RED}✗ Failed:${NC} ${failed_services[*]}"
    exit 1
fi

if [[ ${#successful_services[@]} -eq ${#SERVICES[@]} ]]; then
    echo -e "${GREEN}All services built successfully!${NC}"
    echo ""
    echo "Built images:"
    for service in "${successful_services[@]}"; do
        if [[ -n "$DOCKER_USERNAME" ]]; then
            echo "  - ${DOCKER_USERNAME}/${service}-universe:${VERSION}"
        else
            echo "  - ${service}-universe:${VERSION}"
        fi
    done
    exit 0
fi

