// A fake Home Assistant for development: speaks the real WebSocket protocol
// (auth, then id-tagged commands), answers the read commands Taxis uses with an
// invented house, and applies the registry edits Taxis sends. Lets anyone work
// on Taxis without a Home Assistant. Data lives in memory: restart to reset.
//
//   npm run mock-ha          # listens on ws://localhost:8124/api/websocket
//   npm run dev:mock         # fake HA + Taxis server + UI

import { WebSocketServer } from "ws";

import { buildMockRegistry, handleMock } from "./mock-ha-core.ts";

const PORT = Number(process.env.MOCK_HA_PORT ?? 8124);
const TOKEN = "mock";
const registry = buildMockRegistry();

const wss = new WebSocketServer({ port: PORT, path: "/api/websocket" });
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
    if (!type.endsWith("/list") && type !== "get_states" && type !== "get_config") console.log(`write ${type} ${JSON.stringify(payload)}`);
    socket.send(
      JSON.stringify(
        reply.success
          ? { id, type: "result", success: true, result: reply.result }
          : { id, type: "result", success: false, error: { code: "invalid_info", message: reply.message } },
      ),
    );
  });
});
console.log(`Mock Home Assistant on ws://localhost:${PORT}/api/websocket (token: ${TOKEN})`);
