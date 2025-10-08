import type { ExecutionContext } from '@cloudflare/workers-types';

export default {
  async fetch(req: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const cacheStorage = caches as unknown as CacheStorage & { default: Cache };
    const cache = cacheStorage.default;

    const cacheFetch = async (targetUrl: string) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const upstream = await fetch(targetUrl);
      const res = new Response(upstream.body, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
        }
      });
      ctx.waitUntil(cache.put(req, res.clone()));
      return res;
    };

    if (url.pathname === "/api/league") {
      return cacheFetch(env.LEAGUE_JSON_URL);
    }
    if (url.pathname === "/api/rent_ppm2") {
      return cacheFetch(env.RENT_PPM2_JSON_URL);
    }
    if (url.pathname === "/api/ptr") {
      return cacheFetch(env.PTR_JSON_URL);
    }
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
}
