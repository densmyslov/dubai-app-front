#!/bin/bash

# ============================================================================
# Create Chart KV Namespace
# ============================================================================
# This script creates a Cloudflare KV namespace for storing chart data.
# Run this once before deploying your application.
# ============================================================================

echo "============================================"
echo "Creating Chart KV Namespace"
echo "============================================"
echo ""

# Create the KV namespace
echo "Creating CHART_KV namespace..."
npx wrangler kv namespace create CHART_KV

echo ""
echo "============================================"
echo "Next Steps:"
echo "============================================"
echo "1. Copy the 'id' from the output above"
echo "2. Replace PLACEHOLDER_CHART_KV_ID in wrangler.toml with the actual ID"
echo "3. Deploy your app: npm run build:cf && npx wrangler pages deploy"
echo ""
echo "For detailed instructions, see CHART_KV_SETUP.md"
echo "============================================"
