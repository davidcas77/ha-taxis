// A fake Home Assistant for development: speaks the real WebSocket protocol
// (auth, then id-tagged commands) and the REST config API, answers the read
// commands Taxis uses with an invented house, and applies the edits Taxis
// sends. Lets anyone work on Taxis without a Home Assistant. Data lives in
// memory: restart to reset.
//
//   npm run mock-ha          # listens on ws://localhost:8124/api/websocket
//   npm run dev:mock         # fake HA + Taxis server + UI

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

import { buildMockRegistry, handleMock, handleMockRest, withRecipeDemo } from "./mock-ha-core.ts";

const PORT = Number(process.env.MOCK_HA_PORT ?? 8124);
const TOKEN = "mock";
const registry = withRecipeDemo(buildMockRegistry());

// REST and WebSocket share one port, like HA.
const server = createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: "Unauthorized" });
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?")[0];
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined; // handleMockRest answers 400 for a body that isn't an object
    }
    const reply = handleMockRest(registry, method, path, body);
    if (method !== "GET") console.log(`write ${method} ${path} -> ${reply.status} ${raw}`);
    send(reply.status, reply.body);
  });
});

const wss = new WebSocketServer({ server, path: "/api/websocket" });
wss.on("connection", (socket) => {
  let authed = false;
  socket.send(JSON.stringify({ type: "auth_required", ha_version: registry.config.version }));
  socket.on("message", (data) => {
    const msg = JSON.parse(String(data)) as { type: string; id?: number; access_token?: string } & Record<string, unknown>;
    if (msg.type === "auth") {
      authed = msg.access_token === TOKEN;
      socket.send(JSON.stringify(authed ? { type: "auth_ok" } : { type: "auth_invalid", message: "Invalid access token" }));
      if (!authed) socket.close();
      return;
    }
    if (!authed) return;
    const { id, type, ...payload } = msg;
    const reply = handleMock(registry, type, payload);
    const reads = ["get_states", "get_config", "search/related", "lovelace/config", "lovelace/info", "blueprint/list"];
    if (!type.endsWith("/list") && !reads.includes(type)) console.log(`write ${type} ${JSON.stringify(payload)}`);
    socket.send(
      JSON.stringify(
        reply.success
          ? { id, type: "result", success: true, result: reply.result }
          : { id, type: "result", success: false, error: { code: "invalid_info", message: reply.message } },
      ),
    );
  });
});
server.listen(PORT, () => console.log(`Mock Home Assistant on ws://localhost:${PORT}/api/websocket and http://localhost:${PORT}/api (token: ${TOKEN})`));
