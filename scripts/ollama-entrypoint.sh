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
MODEL="${OLLAMA_MODEL:-llama3.2:3b}"
echo "[entrypoint] Checking for model: ${MODEL}"
# Use fixed-string grep (-F) to avoid regex issues with dots in model names
if ollama list 2>/dev/null | grep -qF "${MODEL}"; then
  echo "[entrypoint] Model ${MODEL} already present."
else
  echo "[entrypoint] Pulling model: ${MODEL}..."
  ollama pull "${MODEL}"
  echo "[entrypoint] Model ${MODEL} pull complete."
fi

# Pre-warm model into memory so first request doesn't cold-start
echo "[entrypoint] Warming up model: ${MODEL}"
curl -sf http://localhost:11434/api/generate -d "{\"model\":\"${MODEL}\",\"prompt\":\"hi\",\"stream\":false}" > /dev/null 2>&1
echo "[entrypoint] Model ${MODEL} warm-up complete."

# Wait for the server process
wait $OLLAMA_PID
