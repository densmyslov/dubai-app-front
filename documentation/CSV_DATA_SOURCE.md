# CSV Data Source for Charts

## Overview

The chart system now supports loading data from external CSV files stored in R2 (or any HTTP-accessible location). This approach significantly reduces LLM output token costs by separating data storage from chart configuration.

## Benefits

- **Token Efficiency**: Avoid sending large datasets through LLM output tokens
- **Performance**: CSV files can be cached on CDN edge locations
- **Scalability**: Same CSV can power multiple charts
- **Separation of Concerns**: Data processing happens server-side, presentation logic in frontend

## Architecture

```
┌─────────────────────────────────────────────┐
│ Lambda (Backend)                            │
├─────────────────────────────────────────────┤
│ 1. Process query → Generate CSV data        │
│ 2. Upload to R2 with structured path        │
│ 3. LLM generates chart manifest with        │
│    CSV reference (not data values)          │
│ 4. POST manifest to /api/charts             │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ Frontend                                    │
├─────────────────────────────────────────────┤
│ 1. Receive manifest via SSE                │
│ 2. Detect dataSource.type === "csv"        │
│ 3. Fetch CSV from dataSource.url           │
│ 4. Parse CSV and extract columns           │
│ 5. Build ECharts series                    │
│ 6. Render chart                            │
└─────────────────────────────────────────────┘
```

## R2 Storage Structure

```
R2 Bucket: dubai-real-estate-data
├── {user_id}/                           # User isolation
│   ├── {session_id}/                    # Browser session
│   │   ├── {request_id}/                # Chat request/conversation
│   │   │   ├── {task_id}/               # Specific task
│   │   │   │   ├── charts/              # Chart data folder
│   │   │   │   │   ├── units-sold.csv
│   │   │   │   │   ├── avg-price.csv
│   │   │   │   │   └── ...
```

**Path Template**: `{user_id}/{session_id}/{request_id}/{task_id}/charts/{filename}.csv`

**Example**:
```
user-alice/sess-abc123/req-001/task-chart-gen/charts/units-sold.csv
```

## Chart Manifest Schema

### With CSV Data Source

```typescript
{
  "chartId": "{sessionId}::{taskId}::chart-name",
  "sessionId": "session-id",
  "config": {
    "title": "Units Sold by Month",
    "chartType": "line",

    // CSV data source (instead of inline data)
    "dataSource": {
      "type": "csv",
      "url": "https://pub-{account}.r2.dev/{userId}/{sessionId}/{requestId}/{taskId}/charts/units-sold.csv",

      // Column mapping
      "xColumn": "month",           // Column for X-axis (categories)
      "yColumns": ["units_sold"],   // Columns for Y-axis (series)

      // Optional: Parse options
      "parseOptions": {
        "delimiter": ",",
        "skipRows": 0,
        "headers": true              // Default: true
      },

      // Optional: Metadata for tracking
      "userId": "user-123",
      "requestId": "req-456",
      "taskId": "task-789"
    },

    // Chart formatting options (same as before)
    "options": {
      "yAxis": {
        "axisLabel": {
          "formatter": "{value}"     // Use JavaScript-compatible syntax
        }
      }
    }
  }
}
```

### With Inline Data (Backward Compatible)

```typescript
{
  "chartId": "chart-123",
  "sessionId": "session-id",
  "config": {
    "title": "Small Dataset Chart",
    "chartType": "bar",

    // Inline data (for small datasets)
    "categories": ["Jan", "Feb", "Mar"],
    "series": [{
      "name": "Sales",
      "data": [100, 150, 200]
    }],

    "options": { /* ... */ }
  }
}
```

## CSV File Format

### Example: units-sold.csv

```csv
month,units_sold,avg_price
Jan 2025,14177,850000
Feb 2025,16010,920000
Mar 2025,15293,895000
Apr 2025,17848,910000
```

### Requirements

1. **Headers**: First row must contain column names (default behavior)
2. **Delimiter**: Comma (`,`) is default, configurable via `parseOptions.delimiter`
3. **Data Types**:
   - X-axis (categories): Any string value
   - Y-axis (series): Numeric values (will be parsed as floats)
4. **Null Values**: Empty cells or non-numeric values become `null` in the series

### Multiple Series

```csv
month,units_sold,avg_price,total_value
Jan 2025,14177,850000,12050450000
Feb 2025,16010,920000,14729200000
```

Chart manifest:
```typescript
{
  "dataSource": {
    "xColumn": "month",
    "yColumns": ["units_sold", "avg_price", "total_value"]  // Multiple series
  }
}
```

## Lambda Implementation Example

```python
import boto3
import pandas as pd
from datetime import datetime, timedelta

s3 = boto3.client('s3')
BUCKET = 'dubai-real-estate-data'
R2_PUBLIC_URL = 'https://pub-{account}.r2.dev'

def generate_chart_with_csv(
    user_id: str,
    session_id: str,
    request_id: str,
    task_id: str,
    chart_name: str,
    df: pd.DataFrame
):
    """
    Generate chart manifest with CSV data source

    Args:
        user_id: Authenticated user ID
        session_id: Frontend session ID
        request_id: Current chat request ID
        task_id: Task ID (e.g., "task-chart-units-sold")
        chart_name: Name for the chart and CSV file
        df: Pandas DataFrame with columns: month, units_sold, etc.

    Returns:
        Chart manifest dict ready to POST to /api/charts
    """

    # 1. Generate R2 path
    csv_filename = f"{chart_name}.csv"
    csv_key = f"{user_id}/{session_id}/{request_id}/{task_id}/charts/{csv_filename}"

    # 2. Upload CSV to R2
    csv_data = df.to_csv(index=False)

    s3.put_object(
        Bucket=BUCKET,
        Key=csv_key,
        Body=csv_data,
        ContentType='text/csv',
        CacheControl='public, max-age=3600',  # Cache for 1 hour
        Metadata={
            'user_id': user_id,
            'session_id': session_id,
            'request_id': request_id,
            'task_id': task_id,
            'created_at': datetime.utcnow().isoformat()
        },
        # Set expiration (24 hours)
        Expires=datetime.utcnow() + timedelta(hours=24)
    )

    # 3. Generate public URL
    csv_url = f"{R2_PUBLIC_URL}/{csv_key}"

    # 4. Build chart manifest
    manifest = {
        'chartId': f"{session_id}::{task_id}::{chart_name}",
        'sessionId': session_id,
        'config': {
            'title': 'Dubai Real Estate Units Sold',
            'chartType': 'line',
            'dataSource': {
                'type': 'csv',
                'url': csv_url,
                'xColumn': 'month',
                'yColumns': ['units_sold'],  # Or multiple columns
                'parseOptions': {
                    'delimiter': ',',
                    'headers': True
                },
                'userId': user_id,
                'requestId': request_id,
                'taskId': task_id
            },
            'options': {
                'yAxis': {
                    'axisLabel': {
                        'formatter': '{value}'  # JavaScript syntax
                    }
                },
                'tooltip': {
                    'formatter': '{b}: {c}'
                }
            }
        }
    }

    return manifest

# Usage in Lambda handler
def handle_chart_request(event):
    user_id = event['userId']
    session_id = event['sessionId']
    request_id = f"req-{int(datetime.utcnow().timestamp())}"
    task_id = f"task-chart-{int(datetime.utcnow().timestamp())}"

    # Query data
    df = query_database(...)  # Returns DataFrame with columns: month, units_sold

    # Generate manifest
    manifest = generate_chart_with_csv(
        user_id=user_id,
        session_id=session_id,
        request_id=request_id,
        task_id=task_id,
        chart_name='units-sold',
        df=df
    )

    # POST to webhook
    post_to_webhook(manifest)
```

## Frontend Behavior

### Loading States

1. **Initial State**: Shows loading spinner with filename
2. **Fetching CSV**: Downloads from R2 URL
3. **Parsing**: Extracts columns and converts to ECharts format
4. **Success**: Renders chart with data
5. **Error**: Displays error message with details

### Error Handling

The frontend displays helpful error messages:

- **Failed to fetch**: Network error or invalid URL
- **Parse error**: Invalid CSV format
- **Column not found**: xColumn or yColumn doesn't exist in CSV
- **No data**: CSV is empty or has no data rows

### Console Logging

For debugging, the component logs:
```
[DynamicChart] Loading CSV data from: https://...
[DynamicChart] CSV data loaded successfully: {categories: 10, series: 1}
```

## When to Use CSV vs. Inline Data

| Scenario | Recommendation | Reason |
|----------|----------------|--------|
| < 50 data points | Inline data | Simple, no extra HTTP request |
| 50-1000 data points | CSV | Token savings, better performance |
| > 1000 data points | CSV | Significant token savings |
| Shared data across charts | CSV | Reuse same file for multiple charts |
| Real-time updates | Inline data | No need for R2 upload delay |

## Security Considerations

### Access Control

**Option 1: Public R2 Bucket**
- Pros: Simple, fast, CDN-cacheable
- Cons: Anyone with URL can access
- Use when: Data is not sensitive

**Option 2: Presigned URLs**
```python
csv_url = s3.generate_presigned_url(
    'get_object',
    Params={'Bucket': BUCKET, 'Key': csv_key},
    ExpiresIn=3600  # 1 hour
)
```
- Pros: Time-limited access, user-specific
- Cons: URLs expire, no CDN caching
- Use when: Data is sensitive

### Path Validation

Always validate and sanitize path components:
```python
import re

def sanitize_id(value: str) -> str:
    # Only allow alphanumeric, dash, underscore
    return re.sub(r'[^a-zA-Z0-9\-_]', '', value)

user_id = sanitize_id(user_id)
session_id = sanitize_id(session_id)
```

### TTL and Cleanup

Set expiration on R2 objects:
```python
# In S3 put_object
Expires=datetime.utcnow() + timedelta(hours=24)
```

Or use R2 lifecycle policies:
```json
{
  "Rules": [{
    "Id": "expire-chart-data",
    "Filter": {"Prefix": ""},
    "Status": "Enabled",
    "Expiration": {"Days": 1}
  }]
}
```

## Testing

### Test with Sample CSV

Create a test CSV file:
```csv
month,units_sold
Jan,1000
Feb,1200
Mar,1100
```

POST test manifest:
```bash
curl -X POST http://localhost:3000/api/charts \
  -H "Content-Type: application/json" \
  -d '{
    "chartId": "test-csv-chart",
    "sessionId": "test-session",
    "config": {
      "title": "Test CSV Chart",
      "chartType": "line",
      "dataSource": {
        "type": "csv",
        "url": "https://your-r2-url/test.csv",
        "xColumn": "month",
        "yColumns": ["units_sold"]
      }
    }
  }'
```

### Debugging

Enable verbose logging in browser console:
1. Open DevTools → Console
2. Look for `[DynamicChart]` logs
3. Check Network tab for CSV fetch
4. Verify CSV content in Response

## Migration from Inline Data

No migration needed! The system supports both:

1. **New charts**: Use CSV data source
2. **Existing charts**: Continue using inline data
3. **Hybrid**: Some charts with CSV, others inline

The frontend automatically detects `config.dataSource` and switches behavior.

## Future Enhancements

Potential improvements:

1. **JSON data source**: Support `dataSource.type: "json"`
2. **Parquet support**: For larger datasets
3. **Streaming**: Large CSV files with chunked loading
4. **Data caching**: Client-side cache for repeated requests
5. **Delta updates**: Only send changed rows

## Related Documentation

- [Chart Webhook API](CHART_WEBHOOK.md)
- [Cloudflare KV Setup](CHART_KV_SETUP.md)
- [Manifest System](MANIFEST.md)
