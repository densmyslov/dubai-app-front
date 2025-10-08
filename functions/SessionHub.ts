// functions/SessionHub.ts
// Cloudflare Durable Object that fans out messages to connected SSE clients
// grouped by sessionId. Works great with Pages Functions.
//
// Endpoints handled by this DO (called via stub.fetch):
//   GET  /connect?sessionId=<id>     -> returns an EventSource stream
//   POST /broadcast?sessionId=<id>   -> broadcasts JSON body to all clients in session
//   GET  /stats                      -> simple JSON with session/client counts (debug)
//
// Bind in Pages as Durable Object "SESSIONS" with class name "SessionHub".
// Example from a Pages Function:
//   const id  = env.SESSIONS.idFromName(sessionId);
//   const hub = env.SESSIONS.get(id);
//   await hub.fetch('http://do/broadcast?sessionId=global', { method:'POST', body: JSON.stringify({...}), headers:{'Content-Type':'application/json'} });

export class SessionHub {
  private state: DurableObjectState;
  private encoder = new TextEncoder();

  // sessions: sessionId -> set of SSE controllers
  private sessions: Map<string, Set<ReadableStreamDefaultController>> = new Map();

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  // --- helpers ---------------------------------------------------------------

  private getSession(id: string): Set<ReadableStreamDefaultController> {
    let set = this.sessions.get(id);
    if (!set) {
      set = new Set();
      this.sessions.set(id, set);
    }
    return set;
  }

  private send(controller: ReadableStreamDefaultController, payload: unknown) {
    const chunk = `data: ${JSON.stringify(payload)}\n\n`;
    controller.enqueue(this.encoder.encode(chunk));
  }

  private sendComment(controller: ReadableStreamDefaultController, text: string) {
    controller.enqueue(this.encoder.encode(`: ${text}\n\n`));
  }

  private pruneDead(sessionId: string, controller: ReadableStreamDefaultController) {
    const set = this.sessions.get(sessionId);
    if (set && set.has(controller)) {
      set.delete(controller);
    }
  }

  // --- routes ----------------------------------------------------------------

  private async handleConnect(url: URL): Promise<Response> {
    const sessionId = url.searchParams.get("sessionId") || "global";
    const clients = this.getSession(sessionId);

    // Keep-alive every 10 seconds to prevent idle timeouts
    let keepAliveTimer: number | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        clients.add(controller);

        // Initial hello so the client knows it's connected
        this.send(controller, { ok: true, connected: true, sessionId, ts: new Date().toISOString() });

        // Keep the connection warm
        keepAliveTimer = setInterval(() => {
          this.sendComment(controller, "keep-alive");
        }, 10_000) as unknown as number;
      },
      cancel: () => {
        if (keepAliveTimer !== undefined) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = undefined;
        }
        // We don't know which controller canceled here, but Cloudflare will drop
        // the controller instance; pruning happens on write errors during broadcast.
        // (Optional) You can maintain a WeakRef map if you want more aggressive cleanup.
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  }

  private async handleBroadcast(request: Request, url: URL): Promise<Response> {
    const sessionId = url.searchParams.get("sessionId") || "global";

    let body: unknown;
    try {
      const type = request.headers.get("Content-Type") || "";
      if (type.includes("application/json")) {
        body = await request.json();
      } else {
        const text = await request.text();
        body = text ? JSON.parse(text) : {};
      }
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    const clients = this.getSession(sessionId);
    const payload = { ...((body as object) ?? {}), _session: sessionId, _ts: new Date().toISOString() };

    // Fan-out; copy to array first so we can modify the Set during iteration
    for (const controller of Array.from(clients)) {
      try {
        this.send(controller, payload);
      } catch {
        // Controller is likely closed; prune it
        this.pruneDead(sessionId, controller);
      }
    }

    return new Response("ok", { status: 200 });
  }

  private async handleStats(): Promise<Response> {
    const stats = {
      sessions: Array.from(this.sessions.entries()).map(([id, set]) => ({
        id,
        clients: set.size,
      })),
      totalClients: Array.from(this.sessions.values()).reduce((acc, s) => acc + s.size, 0),
    };
    return new Response(JSON.stringify(stats), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- entrypoint ------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/connect")) {
      return this.handleConnect(url);
    }
    if (request.method === "POST" && url.pathname.endsWith("/broadcast")) {
      return this.handleBroadcast(request, url);
    }
    if (request.method === "GET" && url.pathname.endsWith("/stats")) {
      return this.handleStats();
    }

    return new Response("Not found", { status: 404 });
  }
}
