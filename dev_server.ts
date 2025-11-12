import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

const API_PROXY_TARGET = "http://localhost:8080"; // Your API server

Deno.serve({ port: 8001 }, async (req: Request) => {
    const url = new URL(req.url);
  
    // 🔁 Proxy WebSocket requests
    // Support:
    // - /ws and /ws/<context>
    // - /api/exec/... and /api/<context>/exec/...
    const webSocketUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
    const execWebSocketPath =
      url.pathname.startsWith("/api/exec") ||
      /^\/api\/[^/]+\/exec(\/|$)/.test(url.pathname);
    const wsPath = url.pathname.startsWith("/ws");
    if ((wsPath || execWebSocketPath) && webSocketUpgrade) {
      const targetWsBase = API_PROXY_TARGET.replace(/^http/, "ws"); // http->ws, https->wss
      const wsUrl = `${targetWsBase}${url.pathname}${url.search}`;
      const { socket, response } = Deno.upgradeWebSocket(req);
  
      const backendSocket = new WebSocket(wsUrl);
  
      backendSocket.onopen = () => {
        socket.onmessage = (e) => backendSocket.send(e.data);
        backendSocket.onmessage = (e) => socket.send(e.data);
        socket.onclose = () => backendSocket.close();
        backendSocket.onclose = () => socket.close();
        socket.onerror = (e) => console.error("Client WS error", e);
        backendSocket.onerror = (e) => console.error("Backend WS error", e);
      };
  
      return response;
    }
  
    // 🔁 Proxy HTTP
    if (url.pathname.startsWith("/k8s") || url.pathname.startsWith("/api/")) {
      const proxyResp = await fetch(`${API_PROXY_TARGET}${url.pathname}${url.search}`, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
  
      return new Response(proxyResp.body, {
        status: proxyResp.status,
        headers: proxyResp.headers,
      });
    }
  
    // 🗂 Serve static files
    return serveDir(req, {
      fsRoot: "bundle",
      urlRoot: "",
      showDirListing: true,
    });
  });
  