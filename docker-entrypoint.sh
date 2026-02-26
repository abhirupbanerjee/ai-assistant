#!/bin/sh
# Docker entrypoint script
# Ensures proper permissions on mounted volumes before starting the app

set -e

# Fix permissions on transformers cache directory (may be mounted from host)
if [ -d "/tmp/transformers_cache" ]; then
  chown -R nextjs:nodejs /tmp/transformers_cache 2>/dev/null || true
  chmod 755 /tmp/transformers_cache 2>/dev/null || true
fi

# Fix permissions on data directory if needed
if [ -d "/app/data" ]; then
  chown -R nextjs:nodejs /app/data 2>/dev/null || true
fi

# Drop privileges and run the app as nextjs user
# Using gosu for proper signal handling in containers
exec gosu nextjs "$@"
