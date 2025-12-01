#!/bin/bash
set -euo pipefail

# Push script for WorkAdventure Universe Docker images
# Pushes verified images to Docker Hub

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

# Parse command line arguments
PUSH_ONLY=""
SKIP_CONFIRM=false

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
        --service)
            PUSH_ONLY="$2"
            shift 2
            ;;
        --skip-confirm)
            SKIP_CONFIRM=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Push WorkAdventure Universe Docker images to Docker Hub"
            echo ""
            echo "Options:"
            echo "  --docker-username USER    Docker Hub username (required)"
            echo "  --version VERSION          Image version tag (default: latest)"
            echo "  --service SERVICE          Push only specific service"
            echo "  --skip-confirm             Skip confirmation prompt"
            echo "  --help                     Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Validate Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: docker command not found${NC}"
    exit 1
fi

# Validate Docker username
if [[ -z "$DOCKER_USERNAME" ]]; then
    echo -e "${RED}Error: Docker username is required${NC}"
    echo "Set DOCKER_USERNAME environment variable or use --docker-username"
    exit 1
fi

# Check Docker login - try a test push to see if authenticated
# This is more reliable than checking docker info
if [[ "$SKIP_CONFIRM" != "true" ]]; then
    # Try to check authentication by attempting to access Docker Hub
    if ! docker pull hello-world:latest &> /dev/null && ! docker info &> /dev/null; then
        echo -e "${YELLOW}Warning: May not be logged into Docker Hub${NC}"
        echo "Run: docker login"
        echo ""
        read -p "Do you want to login now? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker login
        else
            echo -e "${YELLOW}Continuing anyway - push will fail if not authenticated${NC}"
        fi
    fi
fi

# Determine which services to push
if [[ -n "$PUSH_ONLY" ]]; then
    if [[ ! " ${SERVICES[@]} " =~ " ${PUSH_ONLY} " ]]; then
        echo -e "${RED}Error: Invalid service '$PUSH_ONLY'${NC}"
        echo "Valid services: ${SERVICES[*]}"
        exit 1
    fi
    SERVICES=("$PUSH_ONLY")
fi

# Function to get image name
get_image_name() {
    local service=$1
    echo "${DOCKER_USERNAME}/${service}-universe:${VERSION}"
}

# Function to check if image exists locally
image_exists() {
    local image_name=$1
    docker image inspect "$image_name" &> /dev/null
}

# Function to push a service
push_service() {
    local service=$1
    local image_name=$(get_image_name "$service")
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Pushing ${GREEN}$service${BLUE} → ${YELLOW}$image_name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Check if image exists locally
    if ! image_exists "$image_name"; then
        echo -e "${RED}✗ Image not found locally: $image_name${NC}"
        echo "  Run build-universe.sh first to build the image"
        return 1
    fi
    
    echo -e "${YELLOW}→ Pushing to Docker Hub...${NC}"
    
    if docker push "$image_name"; then
        echo -e "${GREEN}✓ Successfully pushed $image_name${NC}"
        
        # Also tag and push as 'latest' if version is not 'latest'
        if [[ "$VERSION" != "latest" ]]; then
            local latest_name="${DOCKER_USERNAME}/${service}-universe:latest"
            echo -e "${YELLOW}→ Also tagging as latest...${NC}"
            if docker tag "$image_name" "$latest_name" && docker push "$latest_name"; then
                echo -e "${GREEN}✓ Also pushed as $latest_name${NC}"
            else
                echo -e "${YELLOW}⚠ Failed to push latest tag (non-critical)${NC}"
            fi
        fi
        
        return 0
    else
        echo -e "${RED}✗ Failed to push $image_name${NC}"
        return 1
    fi
}

# Main push loop
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  WorkAdventure Universe Push Script       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Show what will be pushed
echo "Images to push:"
for service in "${SERVICES[@]}"; do
    local image_name=$(get_image_name "$service")
    if image_exists "$image_name"; then
        echo -e "  ${GREEN}✓${NC} $image_name"
    else
        echo -e "  ${RED}✗${NC} $image_name (not found locally)"
    fi
done
echo ""

# Confirmation
if [[ "$SKIP_CONFIRM" != "true" ]]; then
    read -p "Push these images to Docker Hub? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Aborted${NC}"
        exit 0
    fi
fi

failed_services=()
successful_services=()

for service in "${SERVICES[@]}"; do
    if push_service "$service"; then
        successful_services+=("$service")
    else
        failed_services+=("$service")
    fi
    echo ""
done

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Push Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [[ ${#successful_services[@]} -gt 0 ]]; then
    echo -e "${GREEN}✓ Pushed:${NC} ${successful_services[*]}"
    echo ""
    echo "Images available at:"
    for service in "${successful_services[@]}"; do
        echo "  - docker pull $(get_image_name "$service")"
    done
fi

if [[ ${#failed_services[@]} -gt 0 ]]; then
    echo -e "${RED}✗ Failed:${NC} ${failed_services[*]}"
    exit 1
fi

if [[ ${#successful_services[@]} -eq ${#SERVICES[@]} ]]; then
    echo -e "${GREEN}All images pushed successfully!${NC}"
    exit 0
fi

