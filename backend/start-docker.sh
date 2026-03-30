#!/bin/bash

# SuperBrain Docker Setup Script
# One-click script to build and start the SuperBrain backend

set -e

echo "🐳 SuperBrain Docker Setup"
echo "=========================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if docker-compose or docker compose is available
if ! command -v docker compose &> /dev/null && ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Use docker compose if available, otherwise docker-compose
if command -v docker compose &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

# Check if .env exists, if not create from example
if [ ! -f .env ]; then
    echo "📝 Creating .env file from example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ Created .env file. Please edit it with your API keys."
    else
        echo "⚠️ No .env.example found, continuing without environment variables."
    fi
fi

# Build and start the container
echo "🔨 Building Docker image..."
$DOCKER_COMPOSE build

echo "🚀 Starting SuperBrain..."
$DOCKER_COMPOSE up -d

echo ""
echo "✅ SuperBrain is now running!"
echo "📖 API: http://localhost:5000"
echo "📚 Docs: http://localhost:5000/docs"
echo ""
echo "Useful commands:"
echo "  $DOCKER_COMPOSE logs -f    # View logs"
echo "  $DOCKER_COMPOSE down       # Stop the server"
echo "  $DOCKER_COMPOSE restart    # Restart the server"
