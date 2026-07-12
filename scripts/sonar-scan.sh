#!/bin/bash
# SonarCloud Scan Pipeline
# Usage: SONAR_TOKEN=your_token ./scripts/sonar-scan.sh
# Or set SONAR_TOKEN in .env.local and run: ./scripts/sonar-scan.sh

set -e

if [ -z "$SONAR_TOKEN" ]; then
  # Attempt to read from .env.local
  if [ -f ".env.local" ]; then
    SONAR_TOKEN=$(grep -E '^SONAR_TOKEN=' .env.local | cut -d '=' -f2-)
  fi
fi

if [ -z "$SONAR_TOKEN" ]; then
  echo "❌ SONAR_TOKEN is not set."
  echo ""
  echo "  To generate a token:"
  echo "    1. Go to https://sonarcloud.io/account/security/"
  echo "    2. Generate a token for project 'abhirupbanerjee_policybot'"
  echo "    3. Run: SONAR_TOKEN=your_token_here ./scripts/sonar-scan.sh"
  echo "    4. Or add 'SONAR_TOKEN=your_token_here' to .env.local"
  exit 1
fi

echo "=========================================="
echo "  AI Assistant — SonarCloud Scan"
echo "=========================================="
echo "  Project:  abhirupbanerjee_policybot"
echo "  Org:      abhirupbanerjee"
echo "  Server:   https://sonarcloud.io"
echo "=========================================="
echo ""

export SONAR_TOKEN

# Run the scanner
npx sonar-scanner

SCAN_EXIT=$?

echo ""
if [ $SCAN_EXIT -eq 0 ]; then
  echo "✅ SonarCloud scan completed successfully."
  echo "   View results at: https://sonarcloud.io/project/overview?id=abhirupbanerjee_policybot"
else
  echo "❌ SonarCloud scan failed (exit code: $SCAN_EXIT)."
  echo "   Check the error output above."
fi

exit $SCAN_EXIT
