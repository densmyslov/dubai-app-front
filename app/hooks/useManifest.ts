"use client";
import { useState, useEffect, useCallback } from 'react';
import type { Manifest } from '../lib/manifest';
import { DEFAULT_MANIFEST } from '../lib/manifest';

const POLL_INTERVAL = 5000; // Poll every 5 seconds

export function useManifest() {
  const [manifest, setManifest] = useState<Manifest>(DEFAULT_MANIFEST);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchManifest = useCallback(async () => {
    try {
      const response = await fetch('/api/manifest', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.status}`);
      }

      const data: Manifest = await response.json();
      setManifest(data);
      setError(null);
    } catch (err) {
      console.error('[useManifest] Error fetching manifest:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      // Keep existing manifest on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchManifest();

    // Set up polling
    const intervalId = setInterval(fetchManifest, POLL_INTERVAL);

    // Cleanup
    return () => clearInterval(intervalId);
  }, [fetchManifest]);

  return { manifest, loading, error, refetch: fetchManifest };
}
