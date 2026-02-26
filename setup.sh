#!/bin/bash
# Setup script for Policy Bot
# Run this once before first docker-compose up

set -e

echo "Setting up Policy Bot directories..."

# Create data directories with correct permissions
mkdir -p ./data/app
mkdir -p ./data/transformers_cache

# Set permissions for transformers cache (needs to be writable by container user)
chmod 777 ./data/transformers_cache

echo "Setup complete! You can now run: docker-compose up -d"
