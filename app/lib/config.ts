export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

// Load KEY from environment variable
export const getApiAuthToken = async (): Promise<string | null> => {
  if (typeof window === 'undefined') {
    // Server-side: use KEY from .env.local
    return process.env.KEY || null;
  } else {
    // Client-side: use NEXT_PUBLIC_API_AUTH_TOKEN from environment
    return process.env.NEXT_PUBLIC_API_AUTH_TOKEN || null;
  }
};
