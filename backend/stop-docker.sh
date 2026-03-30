#!/bin/bash

# SuperBrain Docker Stop Script

echo "🛑 Stopping SuperBrain..."

# Use docker compose if available, otherwise docker-compose
if command -v docker compose &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

$DOCKER_COMPOSE down

echo "✅ SuperBrain stopped."
