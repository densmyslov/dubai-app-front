// functions/api/webhook/stream.ts
export const onRequestGet: PagesFunction<{ SESSIONS: DurableObjectNamespace }> =
  async ({ request, env }) => {
    const url = new URL(request.url);
    const sid = url.searchParams.get('sessionId') || 'global';
    const id = env.SESSIONS.idFromName(sid);
    const hub = env.SESSIONS.get(id);

    // Proxies to DO /connect to get an SSE stream
    return hub.fetch('http://do/connect?sessionId=' + encodeURIComponent(sid), {
      method: 'GET',
    });
  };
