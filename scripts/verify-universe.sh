#!/bin/bash
set -euo pipefail

# Verification script for WorkAdventure Universe Docker images
# Tests that containers start correctly and health checks pass

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

# Service configurations: name, port, health_check_path, health_check_timeout
declare -A SERVICE_PORTS=(
    ["play"]="3000"
    ["back"]="8080"
    ["map-storage"]="3000"
    ["uploader"]="8080"
)

declare -A HEALTH_CHECK_PATHS=(
    ["play"]="/ping"
    ["back"]="/ping"
    ["map-storage"]="/ping"
    ["uploader"]="/"  # Uploader may not have /ping, use root
)

declare -A HEALTH_CHECK_TIMEOUTS=(
    ["play"]="30"
    ["back"]="30"
    ["map-storage"]="30"
    ["uploader"]="20"
)

# Parse command line arguments
VERIFY_ONLY=""
SKIP_CLEANUP=false

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
            VERIFY_ONLY="$2"
            shift 2
            ;;
        --skip-cleanup)
            SKIP_CLEANUP=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Verify WorkAdventure Universe Docker images"
            echo ""
            echo "Options:"
            echo "  --docker-username USER    Docker Hub username (required for image names)"
            echo "  --version VERSION         Image version tag (default: latest)"
            echo "  --service SERVICE         Verify only specific service"
            echo "  --skip-cleanup            Don't remove containers after verification"
            echo "  --help                    Show this help message"
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

# Determine which services to verify
if [[ -n "$VERIFY_ONLY" ]]; then
    if [[ ! " ${SERVICES[@]} " =~ " ${VERIFY_ONLY} " ]]; then
        echo -e "${RED}Error: Invalid service '$VERIFY_ONLY'${NC}"
        echo "Valid services: ${SERVICES[*]}"
        exit 1
    fi
    SERVICES=("$VERIFY_ONLY")
fi

# Function to get image name
get_image_name() {
    local service=$1
    if [[ -n "$DOCKER_USERNAME" ]]; then
        echo "${DOCKER_USERNAME}/${service}-universe:${VERSION}"
    else
        echo "${service}-universe:${VERSION}"
    fi
}

# Function to check if image exists
image_exists() {
    local image_name=$1
    docker image inspect "$image_name" &> /dev/null
}

# Function to verify a service
verify_service() {
    local service=$1
    local image_name=$(get_image_name "$service")
    local port=${SERVICE_PORTS[$service]}
    local health_path=${HEALTH_CHECK_PATHS[$service]}
    local timeout=${HEALTH_CHECK_TIMEOUTS[$service]}
    local container_name="verify-${service}-universe-$$"
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Verifying ${GREEN}$service${BLUE} (${YELLOW}$image_name${BLUE})${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Check if image exists
    if ! image_exists "$image_name"; then
        echo -e "${RED}✗ Image not found: $image_name${NC}"
        echo "  Run build-universe.sh first to build the image"
        return 1
    fi
    
    echo -e "${YELLOW}→ Starting container...${NC}"
    
    # Start container with minimal environment
    # Note: Services require specific env vars to start - provide minimal test values
    local start_cmd="docker run -d --name $container_name"
    
    # Map port to random host port to avoid conflicts
    local host_port=$((RANDOM % 10000 + 20000))
    start_cmd="$start_cmd -p $host_port:$port"
    
    # Add minimal environment variables that services require
    case $service in
        play)
            # Play service requires: SECRET_KEY, API_URL, MAP_STORAGE_API_TOKEN, UPLOADER_URL, ICON_URL
            start_cmd="$start_cmd -e NODE_ENV=production"
            start_cmd="$start_cmd -e SECRET_KEY=test-secret-key-for-verification-only"
            start_cmd="$start_cmd -e API_URL=http://localhost:8080"
            start_cmd="$start_cmd -e MAP_STORAGE_API_TOKEN=test-token"
            start_cmd="$start_cmd -e UPLOADER_URL=http://localhost:8080"
            start_cmd="$start_cmd -e ICON_URL=http://localhost:8080"
            ;;
        back)
            # Back service requires: PLAY_URL
            start_cmd="$start_cmd -e NODE_ENV=production"
            start_cmd="$start_cmd -e SECRET_KEY=test-secret-key-for-verification-only"
            start_cmd="$start_cmd -e PLAY_URL=http://localhost:3000"
            ;;
        map-storage)
            # Map-storage requires: API_URL, MAP_STORAGE_API_TOKEN, PUSHER_URL
            start_cmd="$start_cmd -e NODE_ENV=production"
            start_cmd="$start_cmd -e API_URL=http://localhost:8080"
            start_cmd="$start_cmd -e MAP_STORAGE_API_TOKEN=test-token"
            start_cmd="$start_cmd -e PUSHER_URL=http://localhost:3000"
            ;;
        uploader)
            # Uploader doesn't have strict requirements, but may need AWS config
            start_cmd="$start_cmd -e NODE_ENV=production"
            # Uploader doesn't have /ping, so we'll check if it responds at all
            ;;
    esac
    
    start_cmd="$start_cmd $image_name"
    
    if ! eval "$start_cmd" &> /dev/null; then
        echo -e "${RED}✗ Failed to start container${NC}"
        docker logs "$container_name" 2>&1 | tail -20 || true
        docker rm -f "$container_name" 2>/dev/null || true
        return 1
    fi
    
    echo -e "${YELLOW}→ Container started, waiting for health check...${NC}"
    
    # Wait for container to be ready
    local elapsed=0
    local max_wait=$timeout
    local health_status=""
    
    while [[ $elapsed -lt $max_wait ]]; do
        sleep 2
        elapsed=$((elapsed + 2))
        
        # Check if container is still running
        if ! docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
            echo -e "${RED}✗ Container stopped unexpectedly${NC}"
            echo "Container logs:"
            docker logs "$container_name" 2>&1 | tail -30
            docker rm -f "$container_name" 2>/dev/null || true
            return 1
        fi
        
        # Try health check
        # For uploader, it may not have /ping, so check if it responds at all (even 404 means server is running)
        if [[ "$service" == "uploader" ]]; then
            # Uploader returns 404 on /, but that means the server is running
            # Check HTTP status code - any response (even 404) means the service is up
            local http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$host_port/" || echo "000")
            if [[ "$http_code" != "000" ]]; then
                echo -e "${GREEN}✓ Service responding (${elapsed}s, HTTP $http_code)${NC}"
                health_status="passed"
                break
            fi
        else
            if curl -sf "http://localhost:$host_port$health_path" &> /dev/null; then
                echo -e "${GREEN}✓ Health check passed (${elapsed}s)${NC}"
                health_status="passed"
                break
            fi
        fi
    done
    
    if [[ "$health_status" != "passed" ]]; then
        echo -e "${RED}✗ Health check failed after ${max_wait}s${NC}"
        echo "Container logs:"
        docker logs "$container_name" 2>&1 | tail -30
        echo ""
        echo "Trying to connect to http://localhost:$host_port$health_path"
        curl -v "http://localhost:$host_port$health_path" || true
        docker rm -f "$container_name" 2>/dev/null || true
        return 1
    fi
    
    # Check logs for critical errors
    echo -e "${YELLOW}→ Checking logs for errors...${NC}"
    local logs=$(docker logs "$container_name" 2>&1)
    local error_count=0
    
    # Common error patterns
    if echo "$logs" | grep -qi "error\|fatal\|exception\|crash"; then
        # Count error lines
        error_count=$(echo "$logs" | grep -ci "error\|fatal\|exception\|crash" || true)
        if [[ $error_count -gt 5 ]]; then
            echo -e "${YELLOW}⚠ Found $error_count potential error messages in logs${NC}"
            echo "Recent log entries:"
            echo "$logs" | tail -20
        fi
    fi
    
    # Cleanup
    if [[ "$SKIP_CLEANUP" != "true" ]]; then
        echo -e "${YELLOW}→ Stopping and removing container...${NC}"
        docker stop "$container_name" &> /dev/null || true
        docker rm "$container_name" &> /dev/null || true
    else
        echo -e "${YELLOW}→ Container left running (--skip-cleanup)${NC}"
        echo "  Container name: $container_name"
        echo "  Port: $host_port:$port"
    fi
    
    echo -e "${GREEN}✓ Verification passed for $service${NC}"
    return 0
}

# Main verification loop
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  WorkAdventure Universe Verify Script     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

failed_services=()
successful_services=()

for service in "${SERVICES[@]}"; do
    if verify_service "$service"; then
        successful_services+=("$service")
    else
        failed_services+=("$service")
    fi
    echo ""
done

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Verification Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [[ ${#successful_services[@]} -gt 0 ]]; then
    echo -e "${GREEN}✓ Verified:${NC} ${successful_services[*]}"
fi

if [[ ${#failed_services[@]} -gt 0 ]]; then
    echo -e "${RED}✗ Failed:${NC} ${failed_services[*]}"
    exit 1
fi

if [[ ${#successful_services[@]} -eq ${#SERVICES[@]} ]]; then
    echo -e "${GREEN}All services verified successfully!${NC}"
    exit 0
fi

