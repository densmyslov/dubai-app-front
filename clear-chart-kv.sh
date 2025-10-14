#!/bin/bash

# Clear all chart-related keys from CHART_KV namespace
# This removes legacy data that might not have sessionIds

NAMESPACE_ID="254eda49b33c49079029e5612dc45b94"

echo "🔍 Listing all keys in CHART_KV namespace..."
echo ""

# List all keys (note: wrangler syntax is "kv key list" not "kv:key list")
KEYS=$(npx wrangler kv key list --namespace-id="$NAMESPACE_ID" --prefix="charts:" 2>&1)

if echo "$KEYS" | grep -q "error\|ERROR"; then
    echo "❌ Error listing keys. Make sure you're logged in:"
    echo "   npx wrangler login"
    echo ""
    echo "Error details:"
    echo "$KEYS"
    exit 1
fi

# Parse JSON to get key names
KEY_NAMES=$(echo "$KEYS" | jq -r '.[].name' 2>/dev/null)

if [ -z "$KEY_NAMES" ]; then
    echo "✅ No chart keys found in KV. Already clean!"
    exit 0
fi

echo "Found the following keys to delete:"
echo "$KEY_NAMES" | sed 's/^/  - /'
echo ""

# Count keys
KEY_COUNT=$(echo "$KEY_NAMES" | wc -l | tr -d ' ')
echo "Total: $KEY_COUNT keys"
echo ""

read -p "⚠️  Delete all these keys? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled. No keys were deleted."
    exit 0
fi

echo ""
echo "🗑️  Deleting keys..."
echo ""

# Delete each key
while IFS= read -r key; do
    if [ -n "$key" ]; then
        echo "  Deleting: $key"
        npx wrangler kv key delete --namespace-id="$NAMESPACE_ID" "$key" 2>&1
        if [ $? -eq 0 ]; then
            echo "    ✅ Deleted"
        else
            echo "    ❌ Failed"
        fi
    fi
done <<< "$KEY_NAMES"

echo ""
echo "✅ Done! All chart keys have been cleared."
echo ""
echo "📊 Verify:"
echo "   npx wrangler kv key list --namespace-id=\"$NAMESPACE_ID\" --prefix=\"charts:\""
