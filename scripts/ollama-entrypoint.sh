#!/bin/bash
# Start Ollama server in the background, pull default model, then keep serving.
ollama serve &
OLLAMA_PID=$!

# Wait for server to be ready
echo "Waiting for Ollama server..."
until curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do
  sleep 1
done

# Pull default model if not already present
MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"
if ! ollama list | grep -q "^${MODEL}"; then
  echo "Pulling model: ${MODEL}..."
  ollama pull "${MODEL}"
else
  echo "Model ${MODEL} already present."
fi

# Wait for the server process
wait $OLLAMA_PID
