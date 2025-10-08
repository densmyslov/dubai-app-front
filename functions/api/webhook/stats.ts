// functions/api/webhook/stats.ts

export const onRequestGet: PagesFunction<{ SESSIONS: DurableObjectNamespace }> =
  async ({ env }) => {
    const id = env.SESSIONS.idFromName('global');
    const hub = env.SESSIONS.get(id);
    return hub.fetch('http://do/stats', { method: 'GET' });
  };
