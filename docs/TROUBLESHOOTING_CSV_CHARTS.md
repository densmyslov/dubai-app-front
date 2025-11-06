# Troubleshooting CSV Data Source Charts

## Error: CORS policy blocks R2 CSV fetch

### Symptoms

You see a CORS error in the browser console:

```
Access to fetch at 'https://pub-xxx.r2.dev/.../charts/file.csv' from origin 'https://your-app.pages.dev'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.

Failed to load resource: net::ERR_FAILED
[DynamicChart] Failed to load CSV data: TypeError: Failed to fetch
```

### Root Cause

The R2 bucket doesn't have CORS headers configured, so browsers block direct fetch requests from your frontend domain.

### Solution: Automatic CSV Proxy (Recommended)

**The frontend now automatically proxies R2 requests through `/api/charts/csv`** to bypass CORS restrictions.

The CSV parser ([app/lib/csvParser.ts](../app/lib/csvParser.ts)) detects R2 URLs and routes them through the proxy:

```typescript
// Automatically uses proxy for R2 URLs
const isR2Url = url.includes('.r2.dev/') || url.includes('.r2.cloudflarestorage.com/');
const fetchUrl = isR2Url
  ? `/api/charts/csv?url=${encodeURIComponent(url)}`  // Proxy
  : url;  // Direct fetch for non-R2 URLs
```

**This happens automatically** - no backend changes needed! The proxy:
- ✅ Fetches CSV from R2 server-side (no CORS restrictions)
- ✅ Returns CSV with proper CORS headers
- ✅ Caches responses for 1 hour
- ✅ Only allows R2 URLs (security measure)

**Status:** If you're seeing CORS errors, ensure the CSV proxy endpoint exists at [app/api/charts/csv/route.ts](../app/api/charts/csv/route.ts). This should be deployed automatically with your app.

### Alternative: Configure R2 CORS (Optional)

If you prefer direct fetches without the proxy, configure CORS on your R2 bucket:

**Using Cloudflare Dashboard:**
1. Go to R2 → Your Bucket → Settings
2. Scroll to CORS Policy
3. Add this configuration:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

**Using wrangler CLI:**
```bash
wrangler r2 bucket cors put dubai-real-estate-data \
  --rules '[{"AllowedOrigins":["*"],"AllowedMethods":["GET"],"AllowedHeaders":["*"],"MaxAgeSeconds":3600}]'
```

**Note:** Direct R2 access is less secure than using the proxy, as it exposes your R2 bucket publicly. The proxy provides better control and logging.

---

## Error: 401 Unauthorized when fetching CSV

### Symptoms

You see a 401 error in the browser console:

```
/api/charts/csv?url=https://pub-xxx.r2.dev/.../charts/file.csv:1 Failed to load resource: the server responded with a status of 401
[DynamicChart] Failed to load CSV data: Error: Failed to fetch CSV: 401
```

The CSV proxy is working (CORS is resolved), but R2 is rejecting the request.

### Root Cause

The R2 bucket is **private** and requires authentication. Public URLs (like `https://pub-xxx.r2.dev/...`) don't work for private buckets.

### Solution 1: Use Presigned URLs (Recommended)

Generate presigned URLs in your backend that include temporary authentication:

```python
import boto3
from datetime import timedelta

s3 = boto3.client('s3')

# Upload CSV as before
s3.put_object(
    Bucket='dubai-real-estate-data',
    Key=csv_key,
    Body=csv_data,
    ContentType='text/csv'
)

# Generate presigned URL (valid for 1 hour)
csv_url = s3.generate_presigned_url(
    'get_object',
    Params={
        'Bucket': 'dubai-real-estate-data',
        'Key': csv_key
    },
    ExpiresIn=3600  # 1 hour
)

# Use presigned URL in manifest
manifest = {
    'config': {
        'dataSource': {
            'type': 'csv',
            'url': csv_url,  # ✅ Presigned URL with authentication
            'xColumn': 'month',
            'yColumns': ['units_sold']
        }
    }
}
```

**Presigned URLs automatically work through the CSV proxy** - no frontend changes needed!

**Pros:**
- ✅ Secure: Time-limited access
- ✅ Private bucket: Data not publicly accessible
- ✅ Works with proxy: No code changes needed

**Cons:**
- ⏱️ URLs expire (default: 1 hour)
- 📦 No CDN caching (URLs are unique per request)

### Solution 2: Make R2 Bucket Public (Simple but Less Secure)

If your data is not sensitive, you can make the bucket public:

**Using wrangler CLI:**
```bash
# This requires configuring bucket policies
# See Cloudflare R2 docs for public bucket configuration
```

**Note:** Public buckets expose all data to anyone with the URL. Use presigned URLs for sensitive data.

### Solution 3: Use S3-Compatible Credentials in Proxy (Advanced)

If you need the proxy to authenticate with R2 on behalf of clients, you can add AWS credentials to the proxy. However, this is complex and **presigned URLs (Solution 1) are recommended instead**.

### Quick Test: Is Your Bucket Private?

Test the CSV URL directly in your browser:

```bash
# Copy the R2 URL from the error message
# Open in browser or use curl
curl -I https://pub-xxx.r2.dev/results/0000/.../charts/task_1.csv
```

**Expected Results:**
- **200 OK** = Bucket is public (CORS was the only issue)
- **401 Unauthorized** = Bucket is private (need presigned URLs)
- **403 Forbidden** = Bucket policy blocking access

### Recommended Approach

**For production:** Use presigned URLs (Solution 1)
- Secure and works with the CSV proxy
- No frontend changes required
- Backend generates presigned URLs before posting chart manifests

---

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
