// functions/api/webhook/index.ts
export const onRequestPost: PagesFunction<{ SESSIONS: DurableObjectNamespace }> =
  async ({ request, env }) => {
    let body: any;
    try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

    const sid = (body?.sessionId as string) || 'global';
    const id = env.SESSIONS.idFromName(sid);
    const hub = env.SESSIONS.get(id);

    const payload = {
      id: new Date().toISOString(),
      text: body?.message ?? 'No message content',
    };

    await hub.fetch('http://do/broadcast?sessionId=' + encodeURIComponent(sid), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
