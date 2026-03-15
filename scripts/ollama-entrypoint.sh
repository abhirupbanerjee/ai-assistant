#!/bin/bash
# Start Ollama server in the background, pull default model, then keep serving.
ollama serve &
OLLAMA_PID=$!

# Wait for server to be ready
echo "[entrypoint] Waiting for Ollama server..."
until curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do
  sleep 1
done
echo "[entrypoint] Ollama server is ready."

# Pull default model if not already present
MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"
echo "[entrypoint] Checking for model: ${MODEL}"
# Use fixed-string grep (-F) to avoid regex issues with dots in model names
if ollama list 2>/dev/null | grep -qF "${MODEL}"; then
  echo "[entrypoint] Model ${MODEL} already present."
else
  echo "[entrypoint] Pulling model: ${MODEL}..."
  ollama pull "${MODEL}"
  echo "[entrypoint] Model ${MODEL} pull complete."
fi

# Wait for the server process
wait $OLLAMA_PID
