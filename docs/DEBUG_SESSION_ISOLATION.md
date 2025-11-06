# Debugging Session-Based Chart Isolation

This guide will help you verify that charts are properly isolated per session.

## Overview

Charts should be stored in session-specific KV keys:
- **Session A**: `charts:session:abc123`
- **Session B**: `charts:session:xyz789`
- **Global**: `charts:global` (for charts without sessionId)

## Logging Added

Comprehensive logging has been added to track the flow:

### 1. Frontend (DynamicCharts.tsx:47)
```
[DynamicCharts] Connecting to chart stream: /api/charts/stream?sessionId=...
```

### 2. API Route (charts/stream/route.ts:26-36)
```
[charts/stream] Connection request with sessionId: ...
[charts/stream] CHART_KV available: true/false
[charts/stream] Loaded from KV: X charts for sessionId: ...
[charts/stream] Chart details from KV: [{chartId, sessionId, type}, ...]
```

### 3. Storage Layer (chartStorage.ts)

**When storing:**
```
[chartStorage] Storing chart with sessionId: ... in KV key: charts:session:...
[chartStorage] Creating new storage array for key: ... OR Existing storage has X charts
[chartStorage] Added chart: ... Total charts: X
[chartStorage] Saved to KV key: ...
```

**When reading:**
```
[chartStorage] Reading from KV key: ... for sessionId: ...
[chartStorage] Found X messages in KV
[chartStorage] Message sessionIds: [...]
```

## Testing Steps

### Step 1: Clear Old Data

Old charts might not have sessionIds. Clear them:

**Option A: Via Cloudflare Dashboard**
1. Go to Workers & Pages → KV
2. Find your CHART_KV namespace
3. Delete all keys starting with `charts:`

**Option B: Via wrangler CLI**
```bash
npx wrangler kv:key list --namespace-id=<your-kv-id>
npx wrangler kv:key delete --namespace-id=<your-kv-id> "charts:messages"
npx wrangler kv:key delete --namespace-id=<your-kv-id> "charts:global"
```

### Step 2: Open Browser A (Normal Mode)

1. Open Developer Console (F12)
2. Navigate to Application → Local Storage
3. Check `chatSessionId` value (e.g., `"abc123"`)
4. Watch Network tab for `/api/charts/stream` request
5. Watch Console for logging output

### Step 3: Post a Chart for Session A

Use the test script or curl:

```bash
# Replace with your actual sessionId from localStorage
SESSION_A="abc123"

curl -X POST http://localhost:3000/api/charts \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"add\",
    \"chartId\": \"test-chart-a\",
    \"sessionId\": \"$SESSION_A\",
    \"config\": {
      \"title\": \"Chart for Session A\",
      \"chartType\": \"line\",
      \"categories\": [\"Jan\", \"Feb\", \"Mar\"],
      \"series\": [{
        \"name\": \"Data A\",
        \"data\": [10, 20, 30]
      }]
    }
  }"
```

**Expected Console Output:**
```
[chartStorage] Storing chart with sessionId: abc123 in KV key: charts:session:abc123
[chartStorage] Creating new storage array for key: charts:session:abc123
[chartStorage] Added chart: test-chart-a Total charts: 1
[chartStorage] Saved to KV key: charts:session:abc123
```

**Expected Result:**
- Browser A shows the chart ✅

### Step 4: Open Browser B (Incognito Mode)

1. Open new Incognito/Private window
2. Open Developer Console (F12)
3. Navigate to Application → Local Storage
4. Check `chatSessionId` value (e.g., `"xyz789"` - **different from A**)
5. Watch Console for logging output

**Expected Console Output:**
```
[DynamicCharts] Connecting to chart stream: /api/charts/stream?sessionId=xyz789
[charts/stream] Connection request with sessionId: xyz789
[charts/stream] CHART_KV available: true
[charts/stream] Loaded from KV: 0 charts for sessionId: xyz789
[charts/stream] Chart details from KV: []
```

**Expected Result:**
- Browser B shows NO charts ✅
- Browser B's sessionId is different from Browser A

### Step 5: Post a Chart for Session B

```bash
# Replace with Browser B's sessionId from localStorage
SESSION_B="xyz789"

curl -X POST http://localhost:3000/api/charts \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"add\",
    \"chartId\": \"test-chart-b\",
    \"sessionId\": \"$SESSION_B\",
    \"config\": {
      \"title\": \"Chart for Session B\",
      \"chartType\": \"bar\",
      \"categories\": [\"Q1\", \"Q2\", \"Q3\"],
      \"series\": [{
        \"name\": \"Data B\",
        \"data\": [100, 200, 150]
      }]
    }
  }"
```

**Expected Console Output:**
```
[chartStorage] Storing chart with sessionId: xyz789 in KV key: charts:session:xyz789
[chartStorage] Creating new storage array for key: charts:session:xyz789
[chartStorage] Added chart: test-chart-b Total charts: 1
[chartStorage] Saved to KV key: charts:session:xyz789
```

**Expected Result:**
- Browser B shows "Chart for Session B" ✅
- Browser A still only shows "Chart for Session A" ✅
- Charts are isolated!

### Step 6: Verify in KV Storage

Check Cloudflare KV contains two separate keys:

**Via Dashboard:**
- `charts:session:abc123` → Contains test-chart-a
- `charts:session:xyz789` → Contains test-chart-b

**Via CLI:**
```bash
npx wrangler kv:key list --namespace-id=<your-kv-id> --prefix="charts:session:"
```

## Common Issues

### Issue 1: Charts Still Shared

**Symptom:** Browser B sees Browser A's charts

**Possible Causes:**

1. **Old data in KV without sessionIds**
   - Solution: Clear KV storage (Step 1)

2. **SessionId not passed to POST /api/charts**
   - Check: Look for `[chartStorage] Storing chart with sessionId: undefined`
   - Solution: Ensure backend includes `sessionId` in request body

3. **Both browsers have same sessionId**
   - Check: Compare `chatSessionId` in localStorage
   - Solution: Use incognito mode for true isolation

4. **CHART_KV not bound**
   - Check: Look for `[charts/stream] CHART_KV available: false`
   - Solution: Bind KV namespace in wrangler.toml or dashboard

### Issue 2: Charts Not Persisting

**Symptom:** Charts disappear on refresh

**Check logging:**
```
[chartStorage] Saved to KV key: ...  ← Should see this
```

**Possible Causes:**
- KV write failing
- TTL expiring too quickly (should be 24 hours)
- Network issues during KV write

### Issue 3: No Charts Loading

**Symptom:** Fresh browser sees nothing (expected)

**This is correct!** A new session should start empty.

**To verify:**
```
[chartStorage] Reading from KV key: charts:session:NEW_ID for sessionId: NEW_ID
[chartStorage] Found 0 messages in KV
```

## Quick Test Script

Use the existing test script:

```bash
# Edit test-chart-webhook.sh and add your sessionId
SESSION_ID="your-session-id-here"

# Run the test
bash test-chart-webhook.sh
```

## Key Indicators of Success

✅ **Correct Isolation:**
- Each session has unique KV key: `charts:session:{sessionId}`
- Logs show: `[chartStorage] Reading from KV key: charts:session:abc123`
- Different sessions load different charts
- No cross-contamination

❌ **Incorrect Isolation:**
- All sessions load from same key: `charts:messages` or `charts:global`
- Logs show sessionId as `undefined`
- Different sessions see same charts
- Cross-contamination occurs

## Next Steps

If charts are still shared:
1. Share the console logs from both browsers
2. Check what KV keys exist in Cloudflare dashboard
3. Verify the sessionIds are different
4. Confirm backend is sending sessionId in POST requests
