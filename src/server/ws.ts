/**
 * WebSocket transport: authenticates the upgrade with the session cookie,
 * then shuttles validated messages between the socket and the Room.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessage, type ServerMessage } from "../protocol/messages.js";
import type { Room } from "./room/room.js";
import { COOKIE_NAME, type SessionStore } from "./auth/session-store.js";

export function attachWebSocket(server: Server, room: Room, sessions: SessionStore, log: (m: string) => void): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/ws") return;
    const identity = sessions.lookup(readCookie(req, COOKIE_NAME));
    if (!identity) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const id = randomUUID();
      const send = (msg: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      };
      room.join({ id, identity, send });
      wire(ws, id, room, send, log);
    });
  });
}

function wire(ws: WebSocket, id: string, room: Room, send: (m: ServerMessage) => void, log: (m: string) => void): void {
  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return send({ type: "error", message: "malformed JSON" });
    }
    const result = ClientMessage.safeParse(parsed);
    if (!result.success) return send({ type: "error", message: "unknown message" });
    room.handle(id, result.data).catch((err) => {
      log(`handler failed: ${String(err)}`);
      send({ type: "error", message: "internal error" });
    });
  });
  ws.on("close", () => room.leave(id));
  ws.on("error", (err) => log(`socket ${id}: ${err.message}`));
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
