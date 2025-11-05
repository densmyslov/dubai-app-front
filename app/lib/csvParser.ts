// ============================================================================
// CSV Parser for Chart Data Sources
// ============================================================================
// Fetches and parses CSV files from R2/external sources to populate chart data.
// Supports column extraction and basic parsing options.
// ============================================================================

export interface CSVParseOptions {
  delimiter?: string;
  skipRows?: number;
  headers?: boolean;
}

export interface ParsedCSVData {
  categories: string[];
  series: Array<{
    name: string;
    data: (number | null)[];
  }>;
}

/**
 * Fetches and parses a CSV file from a URL
 * @param url - URL to the CSV file
 * @param xColumn - Column name for X-axis (categories)
 * @param yColumns - Column names for Y-axis (series data)
 * @param options - Parse options
 * @returns Parsed data ready for ECharts
 */
export async function fetchAndParseCSV(
  url: string,
  xColumn?: string,
  yColumns?: string[],
  options?: CSVParseOptions
): Promise<ParsedCSVData> {
  const delimiter = options?.delimiter || ',';
  const skipRows = options?.skipRows || 0;
  const hasHeaders = options?.headers !== false; // Default true

  // Fetch CSV - use proxy for R2 URLs to handle CORS
  const isR2Url = url.includes('.r2.dev/') || url.includes('.r2.cloudflarestorage.com/');
  const fetchUrl = isR2Url
    ? `/api/charts/csv?url=${encodeURIComponent(url)}`
    : url;

  console.log('[csvParser] Fetching CSV:', isR2Url ? `${url} (via proxy)` : url);

  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const lines = text.trim().split('\n').slice(skipRows);

  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }

  // Parse headers
  const headers = hasHeaders
    ? lines[0].split(delimiter).map((h) => h.trim())
    : [];

  const dataLines = hasHeaders ? lines.slice(1) : lines;

  // Parse rows
  const rows = dataLines.map((line) => {
    return line.split(delimiter).map((cell) => cell.trim());
  });

  if (rows.length === 0) {
    throw new Error('No data rows in CSV');
  }

  // Determine column indices
  let xIndex = 0;
  let yIndices: number[] = [];

  if (hasHeaders && headers.length > 0) {
    if (xColumn) {
      xIndex = headers.indexOf(xColumn);
      if (xIndex === -1) {
        throw new Error(`X column "${xColumn}" not found in headers: ${headers.join(', ')}`);
      }
    }

    if (yColumns && yColumns.length > 0) {
      yIndices = yColumns.map((colName) => {
        const idx = headers.indexOf(colName);
        if (idx === -1) {
          throw new Error(`Y column "${colName}" not found in headers: ${headers.join(', ')}`);
        }
        return idx;
      });
    } else {
      // Default: use all columns except X column
      yIndices = headers
        .map((_, i) => i)
        .filter((i) => i !== xIndex);
    }
  } else {
    // No headers: assume first column is X, rest are Y
    xIndex = 0;
    yIndices = rows[0]
      .map((_, i) => i)
      .filter((i) => i !== xIndex);
  }

  // Extract categories (X values)
  const categories = rows.map((row) => row[xIndex] || '');

  // Extract series (Y values)
  const series = yIndices.map((yIdx) => {
    const columnName = hasHeaders && headers[yIdx] ? headers[yIdx] : `Series ${yIdx}`;
    const data = rows.map((row) => {
      const value = row[yIdx];
      if (!value || value === '') return null;
      const num = parseFloat(value);
      return isNaN(num) ? null : num;
    });

    return {
      name: columnName,
      data,
    };
  });

  return { categories, series };
}
