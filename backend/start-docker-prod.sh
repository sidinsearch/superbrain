#!/bin/bash

# ────────────────────────────────────────────────────────────────────────────────
# SuperBrain Backend Production Startup Script
# Ensures all configuration is validated and services are healthy
# ────────────────────────────────────────────────────────────────────────────────

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         SuperBrain API - Production Startup                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"

# ──── Check prerequisites ────
echo -e "\n${YELLOW}→ Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker found${NC}"

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ Docker Compose is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose found${NC}"

# ──── Check environment file ────
echo -e "\n${YELLOW}→ Checking environment configuration...${NC}"

if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "${YELLOW}⚠ .env file not found. Creating from .env.example...${NC}"
        cp .env.example .env
        echo -e "${YELLOW}⚠ Please edit .env with your actual credentials and run this script again${NC}"
        exit 1
    else
        echo -e "${RED}✗ Neither .env nor .env.example found${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ .env file found${NC}"
fi

# ──── Check required API keys ────
source .env

if [ -z "$GROQ_API_KEY" ] && [ -z "$GOOGLE_API_KEY" ] && [ -z "$OPENROUTER_API_KEY" ]; then
    echo -e "${YELLOW}⚠ Warning: No AI provider API keys configured${NC}"
    echo -e "${YELLOW}  Set at least one of: GROQ_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY${NC}"
fi

# ──── Create necessary directories ────
echo -e "\n${YELLOW}→ Setting up directories...${NC}"

mkdir -p config temp static/uploads logs
chmod 755 config temp static static/uploads logs

echo -e "${GREEN}✓ Directories created${NC}"

# ──── Build Docker image ────
echo -e "\n${YELLOW}→ Building Docker image...${NC}"

docker-compose build --no-cache

echo -e "${GREEN}✓ Docker image built successfully${NC}"

# ──── Start services ────
echo -e "\n${YELLOW}→ Starting SuperBrain API...${NC}"

docker-compose up -d

echo -e "${GREEN}✓ Containers started${NC}"

# ──── Wait for service to be healthy ────
echo -e "\n${YELLOW}→ Waiting for API to become healthy...${NC}"

for i in {1..30}; do
    if docker-compose exec -T superbrain-api curl -s http://localhost:5000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ API is healthy${NC}"
        break
    fi
    
    if [ $i -eq 30 ]; then
        echo -e "${RED}✗ API failed to start after 30 seconds${NC}"
        docker-compose logs superbrain-api
        exit 1
    fi
    
    echo -n "."
    sleep 1
done

# ──── Display status ────
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    Startup Complete! ✓                         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"

echo -e "\n${GREEN}Services running:${NC}"
docker-compose ps

echo -e "\n${GREEN}API Information:${NC}"
echo -e "  📡 Endpoint: http://localhost:${API_PORT:-5000}"
echo -e "  📚 Documentation: http://localhost:${API_PORT:-5000}/docs"
echo -e "  🏥 Health Check: http://localhost:${API_PORT:-5000}/health"

echo -e "\n${GREEN}Useful commands:${NC}"
echo -e "  View logs:     ${YELLOW}docker-compose logs -f superbrain-api${NC}"
echo -e "  Stop services: ${YELLOW}docker-compose down${NC}"
echo -e "  Restart:       ${YELLOW}docker-compose restart${NC}"
echo -e "  Status:        ${YELLOW}docker-compose ps${NC}"

echo -e "\n"
