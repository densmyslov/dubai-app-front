# Troubleshooting CSV Data Source Charts

## Error: Failed to load CSV with placeholder URL

### Symptoms

You see these errors in the browser console:

```
Failed to load resource: the server responded with a status of 404 ()
[DynamicChart] Failed to load CSV data: Error: Failed to fetch CSV: 404
```

The failed URL looks like:
- `/METADATA_R2_CSV_URL_REQUIRED:1`
- `PLACEHOLDER_URL`
- `TODO_REPLACE_WITH_ACTUAL_URL`

### Root Cause

The backend (Lambda) is sending a chart manifest with a **placeholder URL** instead of an actual R2 URL. The frontend now validates URLs and will reject placeholders, but if you stored a chart before this validation was added, it might still be in KV storage.

### Solution 1: Fix the Backend

The backend must upload the CSV to R2 and generate a real public URL before posting the chart manifest.

**Incorrect (Placeholder):**

```python
manifest = {
    'config': {
        'dataSource': {
            'type': 'csv',
            'url': 'METADATA_R2_CSV_URL_REQUIRED',  # ❌ WRONG
            'xColumn': 'month',
            'yColumns': ['units_sold']
        }
    }
}
```

**Correct (Real URL):**

```python
import boto3
from datetime import datetime, timedelta

s3 = boto3.client('s3')
BUCKET = 'dubai-real-estate-data'
R2_PUBLIC_URL = 'https://pub-YOUR-ACCOUNT.r2.dev'

# 1. Upload CSV to R2
csv_key = f"{user_id}/{session_id}/{request_id}/{task_id}/charts/units-sold.csv"
csv_data = df.to_csv(index=False)

s3.put_object(
    Bucket=BUCKET,
    Key=csv_key,
    Body=csv_data,
    ContentType='text/csv',
    CacheControl='public, max-age=3600',
    Expires=datetime.utcnow() + timedelta(hours=24)
)

# 2. Generate real URL
csv_url = f"{R2_PUBLIC_URL}/{csv_key}"

# 3. Use real URL in manifest
manifest = {
    'config': {
        'dataSource': {
            'type': 'csv',
            'url': csv_url,  # ✅ CORRECT: real HTTP(S) URL
            'xColumn': 'month',
            'yColumns': ['units_sold']
        }
    }
}
```

### Solution 2: Clear Bad Charts from KV

If charts with placeholder URLs are already stored in Cloudflare KV, you need to clear them:

#### Option A: Delete via API (Recommended)

```bash
# Find your session ID (check browser localStorage or console logs)
SESSION_ID="your-session-id-here"

# Get the chart ID from the error message
CHART_ID="d88c303f-76bb-453f-abb7-5c321be8dc2d::units-sold-by-building"

# Delete the chart
curl -X DELETE http://localhost:3000/api/charts \
  -H "Content-Type: application/json" \
  -d "{
    \"chartId\": \"$CHART_ID\",
    \"sessionId\": \"$SESSION_ID\"
  }"
```

#### Option B: Clear All Charts for a Session

Use the Cloudflare dashboard or wrangler CLI:

```bash
# Using wrangler
wrangler kv:key delete --namespace-id=YOUR_KV_ID "charts:session:YOUR_SESSION_ID"
```

#### Option C: Delete from Browser

1. Open the dashboard with the broken chart
2. Click the red delete button (🗑️) in the top-right corner of the chart
3. Confirm deletion

### Solution 3: Verify R2 Configuration

Ensure your R2 bucket is properly configured for public access:

1. **R2 Bucket Setup:**
   - Bucket name: `dubai-real-estate-data`
   - Public access enabled (if using public URLs)
   - CORS configured to allow frontend domain

2. **R2 Public URL:**
   ```
   https://pub-{ACCOUNT_HASH}.r2.dev/{path}
   ```

3. **Test CSV Access:**
   ```bash
   # Try fetching a CSV directly
   curl -I https://pub-YOUR-ACCOUNT.r2.dev/user-123/session-abc/req-001/task-001/charts/test.csv

   # Should return 200 OK (not 404)
   ```

### Solution 4: Validate Chart Manifest Before Posting

Add validation in your backend before posting to `/api/charts`:

```python
def validate_chart_manifest(manifest: dict) -> bool:
    """Validate chart manifest before posting"""
    config = manifest.get('config', {})
    data_source = config.get('dataSource')

    if data_source:
        url = data_source.get('url', '')

        # Check for placeholders
        placeholders = ['REQUIRED', 'PLACEHOLDER', 'TODO', 'FIXME', 'METADATA']
        if any(p in url.upper() for p in placeholders):
            raise ValueError(f"dataSource.url contains placeholder: {url}")

        # Check for valid HTTP(S) URL
        if not url.startswith(('http://', 'https://')):
            raise ValueError(f"dataSource.url must be HTTP(S): {url}")

    return True

# Before posting
validate_chart_manifest(manifest)
post_to_webhook(manifest)
```

### Frontend Validation (Now Enforced)

As of commit `44d8719`, the frontend now validates `dataSource.url` and will reject:

- Empty or missing URLs
- Non-HTTP(S) URLs (must start with `http://` or `https://`)
- Placeholder text containing: `REQUIRED`, `PLACEHOLDER`, `TODO`, `FIXME`, `METADATA`

**Error Response (400 Bad Request):**

```json
{
  "error": "dataSource.url must be a valid HTTP(S) URL. Received: \"METADATA_R2_CSV_URL_REQUIRED\". Placeholders like \"METADATA_R2_CSV_URL_REQUIRED\" are not allowed."
}
```

### Debugging Checklist

- [ ] Backend uploads CSV to R2 before creating manifest
- [ ] Backend generates real public URL (not placeholder)
- [ ] CSV file exists at the URL (test with `curl -I <url>`)
- [ ] R2 bucket has public access enabled (if using public URLs)
- [ ] No placeholder text in `dataSource.url`
- [ ] URL starts with `http://` or `https://`
- [ ] Chart manifest validation passes (check backend logs)
- [ ] KV storage cleared of old broken charts (if applicable)

### Example Working Flow

```
1. User sends query → Lambda
2. Lambda queries database → DataFrame
3. Lambda uploads CSV to R2 → Get URL
   ✅ https://pub-abc123.r2.dev/user-1/session-x/req-1/task-1/charts/data.csv
4. Lambda generates manifest with real URL
5. Lambda POST to /api/charts → Frontend validates
6. Frontend fetches CSV from R2 → Success ✅
7. Chart renders with data
```

### Related Documentation

- [CSV Data Source Guide](CSV_DATA_SOURCE.md) - Complete CSV implementation guide
- [Chart Webhook API](CHART_WEBHOOK.md) - Chart webhook API reference
- [Cloudflare KV Setup](CHART_KV_SETUP.md) - KV configuration guide

## Still Having Issues?

If you're still experiencing problems after following these steps:

1. Check backend logs for R2 upload errors
2. Verify R2 credentials and permissions
3. Test CSV URL directly in browser
4. Check Cloudflare KV dashboard for stored data
5. Enable verbose logging: Look for `[DynamicChart]` logs in browser console
