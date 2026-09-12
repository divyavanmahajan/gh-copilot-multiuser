/**
 * Minimal WebSocket client with reconnect. Validates inbound frames against
 * the shared protocol so a server/client version mismatch fails loudly.
 */
import { ServerMessage, type ClientMessage } from "../../protocol/messages.js";

export type Listener = (msg: ServerMessage) => void;

export class RoomSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private closed = false;
  private backoff = 500;

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => (this.backoff = 500);
    this.ws.onmessage = (ev) => {
      const parsed = ServerMessage.safeParse(JSON.parse(ev.data as string));
      if (!parsed.success) return console.warn("unknown server message", parsed.error);
      for (const l of this.listeners) l(parsed.data);
    };
    this.ws.onclose = (ev) => {
      if (this.closed || ev.code === 1008) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 10_000);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
