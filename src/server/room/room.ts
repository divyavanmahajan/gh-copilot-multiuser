/**
 * The room: participants, the one agent, the strict queue, and fan-out.
 *
 * Everything user-facing flows through here. Transport (WebSocket) is kept
 * in ws.ts so this class can be driven from tests without sockets.
 */
import { CopilotAgent } from "../agent/copilot.js";
import { PermissionRouter } from "../agent/permissions.js";
import { PromptQueue } from "../agent/queue.js";
import { Transcript } from "./transcript.js";
import {
  can,
  type ClientMessage,
  type Identity,
  type Participant,
  type QueuedPrompt,
  type RoomStatus,
  type ServerMessage,
  type TranscriptEntry,
} from "../../protocol/messages.js";

export interface RoomOptions {
  name: string;
  repo: string;
  model?: string;
  sessionId?: string;
  stateDir: string;
  copilotToken?: string;
  permissionTimeoutMs: number;
  log: (msg: string) => void;
}

export interface Connection {
  id: string;
  identity: Identity;
  send: (msg: ServerMessage) => void;
}

export class Room {
  private readonly connections = new Map<string, Connection & { typing: boolean; connectedAt: string }>();
  private readonly queue = new PromptQueue();
  private readonly transcript: Transcript;
  private readonly permissions: PermissionRouter;
  private readonly agent: CopilotAgent;
  private status: RoomStatus = "starting";

  constructor(private readonly opts: RoomOptions) {
    this.transcript = new Transcript(opts.stateDir);
    this.permissions = new PermissionRouter({
      timeoutMs: opts.permissionTimeoutMs,
      deciders: () => this.currentDeciders(),
      broadcast: (p) =>
        this.broadcast({
          type: "permission.request",
          requestId: p.requestId,
          request: p.request,
          deciderIds: p.deciderIds,
          expiresAt: p.expiresAt.toISOString(),
        }),
      resolved: (requestId, decision, byUserId) =>
        void this.record({ kind: "permission.resolved", at: now(), requestId, decision, byUserId }),
    });
    this.agent = new CopilotAgent({
      repo: opts.repo,
      model: opts.model,
      sessionId: opts.sessionId,
      gitHubToken: opts.copilotToken,
      onPermissionRequest: this.permissions.handler,
      onEvent: (event) => void this.record({ kind: "agent", at: now(), event }),
      onIdle: () => this.onTurnFinished("completed"),
      onError: (m) => opts.log(m),
    });
  }

  async start(): Promise<void> {
    await this.transcript.load();
    await this.agent.start();
    this.setStatus("idle");
    this.opts.log(`session ${this.agent.sessionId} ready`);
  }

  async stop(): Promise<void> {
    this.permissions.rejectAll();
    await this.agent.stop();
  }

  get sessionId(): string {
    return this.agent.sessionId;
  }

  // --- connections ---------------------------------------------------------

  join(conn: Connection): void {
    this.connections.set(conn.id, { ...conn, typing: false, connectedAt: now() });
    const snap = this.queue.snapshot();
    conn.send({
      type: "hello",
      you: conn.identity,
      room: { name: this.opts.name, repo: this.opts.repo, sessionId: this.agent.sessionId, model: this.opts.model },
      status: this.status,
      participants: this.participants(),
      queue: snap.queue,
      current: snap.current,
      transcript: this.transcript.tail(),
    });
    this.broadcast({ type: "participants", participants: this.participants() });
  }

  leave(connId: string): void {
    this.connections.delete(connId);
    this.broadcast({ type: "participants", participants: this.participants() });
  }

  async handle(connId: string, msg: ClientMessage): Promise<void> {
    const conn = this.connections.get(connId);
    if (!conn) return;
    const { identity } = conn;

    switch (msg.type) {
      case "typing":
        conn.typing = msg.typing;
        this.broadcast({ type: "participants", participants: this.participants() });
        return;

      case "prompt.submit": {
        if (!can(identity.role, "prompt")) return conn.send({ type: "error", message: "viewers cannot submit prompts" });
        this.queue.submit({ authorId: identity.id, authorLogin: identity.login, text: msg.text });
        this.broadcastQueue();
        await this.pump();
        return;
      }

      case "prompt.withdraw": {
        if (this.queue.withdraw(msg.promptId, identity.id, can(identity.role, "withdrawOthers"))) this.broadcastQueue();
        return;
      }

      case "permission.respond": {
        if (!can(identity.role, "approve")) return;
        if (!this.currentDeciders().includes(identity.id)) return conn.send({ type: "error", message: "not your call" });
        if (!this.permissions.respond(msg.requestId, msg.decision, identity.id)) {
          conn.send({ type: "error", message: "that request is no longer pending" });
        }
        return;
      }

      case "turn.abort": {
        if (!can(identity.role, "abort")) return conn.send({ type: "error", message: "only a host can abort" });
        if (!this.queue.isRunning) return;
        this.permissions.rejectAll();
        await this.agent.abort();
        this.onTurnFinished("aborted");
        return;
      }
    }
  }

  // --- queue driving -------------------------------------------------------

  /** Start the next prompt if the agent is idle. Safe to call any time. */
  private async pump(): Promise<void> {
    if (this.status !== "idle") return;
    const next = this.queue.startNext();
    if (!next) return;
    this.setStatus("running");
    this.broadcastQueue();
    await this.record({ kind: "turn.started", at: now(), prompt: next });
    try {
      await this.agent.send(next.authorLogin, next.text);
    } catch (err) {
      this.opts.log(`send failed: ${String(err)}`);
      this.onTurnFinished("error", String(err));
    }
  }

  private onTurnFinished(reason: "completed" | "aborted" | "error", error?: string): void {
    const done = this.queue.finish();
    this.setStatus("idle");
    if (done) void this.record({ kind: "turn.finished", at: now(), promptId: done.id, reason, error });
    this.broadcastQueue();
    void this.pump();
  }

  // --- helpers -------------------------------------------------------------

  private currentDeciders(): string[] {
    const ids = new Set<string>();
    const current = this.queue.snapshot().current;
    if (current) ids.add(current.authorId);
    for (const c of this.connections.values()) if (c.identity.role === "host") ids.add(c.identity.id);
    return [...ids];
  }

  private participants(): Participant[] {
    // One entry per identity even if they have several tabs open.
    const byId = new Map<string, Participant>();
    for (const c of this.connections.values()) {
      const existing = byId.get(c.identity.id);
      byId.set(c.identity.id, {
        ...c.identity,
        connectedAt: existing?.connectedAt ?? c.connectedAt,
        typing: (existing?.typing ?? false) || c.typing,
      });
    }
    return [...byId.values()];
  }

  private setStatus(status: RoomStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.broadcast({ type: "status", status });
  }

  private broadcastQueue(): void {
    const snap = this.queue.snapshot();
    this.broadcast({ type: "queue", queue: snap.queue, current: snap.current });
  }

  private async record(entry: TranscriptEntry): Promise<void> {
    await this.transcript.append(entry);
    this.broadcast({ type: "transcript", entry });
  }

  private broadcast(msg: ServerMessage): void {
    for (const c of this.connections.values()) c.send(msg);
  }
}

function now(): string {
  return new Date().toISOString();
}

export type { QueuedPrompt };
