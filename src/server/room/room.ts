/**
 * The room: participants, the one agent, the strict queue, and fan-out.
 *
 * Everything user-facing flows through here. Transport (WebSocket) is kept
 * in ws.ts so this class can be driven from tests without sockets.
 */
import type { Agent, AgentFactory } from "../agent/agent.js";
import { PermissionRouter } from "../agent/permissions.js";
import { PromptQueue } from "../agent/queue.js";
import { Transcript } from "./transcript.js";
import {
  can,
  type AdmissionDecision,
  type AdmissionRequest,
  type ClientMessage,
  type Identity,
  type Participant,
  type QueuedPrompt,
  type RoomSettings,
  type RoomSettingsPatch,
  type RoomStatus,
  type ServerMessage,
  type TranscriptEntry,
} from "../../protocol/messages.js";

export interface RoomOptions {
  name: string;
  repo: string;
  model?: string;
  stateDir: string;
  permissionTimeoutMs: number;
  /** Builds the agent once the room has wired its callbacks. */
  agentFactory: AgentFactory;
  /** Persist a host's admission decision and update browser sessions. */
  onAdmission?: (identity: Identity, decision: AdmissionDecision, by: Identity) => Promise<void> | void;
  /** Host-editable settings. Absent means the room has no settings UI. */
  settings?: {
    get: () => RoomSettings;
    update: (patch: RoomSettingsPatch) => Promise<RoomSettings>;
  };
  /** Shown to hosts so they can hand it out. */
  guestCode?: string;
  log: (msg: string) => void;
}

export interface Connection {
  id: string;
  identity: Identity;
  send: (msg: ServerMessage) => void;
}

export class Room {
  private readonly connections = new Map<string, Connection & { typing: boolean; connectedAt: string }>();
  /** Signed in, waiting for a host. Not participants yet; they see nothing. */
  private readonly waiting = new Map<string, Connection & { requestedAt: string }>();
  private readonly queue = new PromptQueue();
  private readonly transcript: Transcript;
  private readonly permissions: PermissionRouter;
  private readonly agent: Agent;
  private status: RoomStatus = "starting";

  constructor(private readonly opts: RoomOptions) {
    this.transcript = new Transcript(opts.stateDir);
    this.transcript.onError((err) => opts.log(`transcript write failed: ${String(err)}`));
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
        this.record({ kind: "permission.resolved", at: now(), requestId, decision, byUserId }),
    });
    this.agent = opts.agentFactory({
      onPermissionRequest: this.permissions.handler,
      onEvent: (event) => this.record({ kind: "agent", at: now(), event }),
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
    await this.transcript.flush();
  }

  get sessionId(): string {
    return this.agent.sessionId;
  }

  get currentStatus(): RoomStatus {
    return this.status;
  }

  // --- connections ---------------------------------------------------------

  join(conn: Connection): void {
    if (conn.identity.role === "pending") {
      this.waiting.set(conn.id, { ...conn, requestedAt: now() });
      conn.send({ type: "admission.pending", you: conn.identity });
      this.notifyHosts();
      return;
    }
    this.connections.set(conn.id, { ...conn, typing: false, connectedAt: now() });
    this.sendHello(conn);
    this.broadcast({ type: "participants", participants: this.participants() });
  }

  leave(connId: string): void {
    if (this.waiting.delete(connId)) {
      this.notifyHosts();
      return;
    }
    this.connections.delete(connId);
    this.broadcast({ type: "participants", participants: this.participants() });
  }

  private sendHello(conn: Connection): void {
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
      pendingAdmissions: conn.identity.role === "host" ? this.pendingAdmissions() : [],
      settings: conn.identity.role === "host" ? (this.opts.settings?.get() ?? null) : null,
      guestCode: conn.identity.role === "host" ? (this.opts.guestCode ?? null) : null,
    });
  }

  /** One request per waiting identity, even with several tabs open. */
  pendingAdmissions(): AdmissionRequest[] {
    const byId = new Map<string, AdmissionRequest>();
    for (const w of this.waiting.values()) {
      const existing = byId.get(w.identity.id);
      if (!existing || existing.requestedAt > w.requestedAt) byId.set(w.identity.id, { identity: w.identity, requestedAt: w.requestedAt });
    }
    return [...byId.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  private notifyHosts(): void {
    const requests = this.pendingAdmissions();
    for (const c of this.connections.values()) {
      if (c.identity.role === "host") c.send({ type: "admissions", requests });
    }
  }

  /**
   * A host admits, re-roles, or rejects a user. Applies to every connection
   * of that identity: waiting ones become participants (or are told no),
   * participants get their new role and a fresh hello.
   */
  private async decideAdmission(userId: string, decision: AdmissionDecision, by: Identity): Promise<boolean> {
    const waiting = [...this.waiting.entries()].filter(([, w]) => w.identity.id === userId);
    const present = [...this.connections.entries()].filter(([, c]) => c.identity.id === userId);
    if (waiting.length === 0 && present.length === 0) return false;
    const subject = (waiting[0]?.[1] ?? present[0]?.[1])!.identity;
    if (subject.role === "host") return false; // hosts are configured, not decided on

    await this.opts.onAdmission?.(subject, decision, by);

    for (const [id, w] of waiting) {
      this.waiting.delete(id);
      if (decision === "reject") {
        w.send({ type: "admission.decided", role: null });
        continue;
      }
      const admitted: Connection = { ...w, identity: { ...w.identity, role: decision } };
      this.connections.set(id, { ...admitted, typing: false, connectedAt: now() });
      admitted.send({ type: "admission.decided", role: decision });
      this.sendHello(admitted);
    }
    for (const [id, c] of present) {
      if (decision === "reject") {
        this.connections.delete(id);
        c.send({ type: "admission.decided", role: null });
        continue;
      }
      c.identity = { ...c.identity, role: decision };
      c.send({ type: "admission.decided", role: decision });
      this.sendHello(c);
    }
    this.broadcast({ type: "participants", participants: this.participants() });
    this.notifyHosts();
    return true;
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

      case "admission.decide": {
        if (!can(identity.role, "admit")) return conn.send({ type: "error", message: "only a host can admit people" });
        if (!(await this.decideAdmission(msg.userId, msg.decision, identity))) {
          conn.send({ type: "error", message: "that user is not here any more" });
        }
        return;
      }

      case "settings.update": {
        if (!can(identity.role, "settings")) return conn.send({ type: "error", message: "only a host can change settings" });
        if (!this.opts.settings) return conn.send({ type: "error", message: "settings are fixed for this room" });
        const settings = await this.opts.settings.update(msg.patch);
        this.opts.log(`${identity.login} changed admission policy: ${JSON.stringify(settings.admission)}`);
        for (const c of this.connections.values()) {
          if (c.identity.role === "host") c.send({ type: "settings", settings });
        }
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
    this.record({ kind: "turn.started", at: now(), prompt: next });
    try {
      await this.agent.send(next.authorLogin, next.text);
    } catch (err) {
      this.opts.log(`send failed: ${String(err)}`);
      this.onTurnFinished("error", String(err));
    }
  }

  private onTurnFinished(reason: "completed" | "aborted" | "error", error?: string): void {
    // The runtime also reports idle after start/resume and after aborts; only
    // a running turn can finish.
    if (!this.queue.isRunning) {
      if (this.status === "starting") this.setStatus("idle");
      return;
    }
    const done = this.queue.finish();
    this.setStatus("idle");
    if (done) this.record({ kind: "turn.finished", at: now(), promptId: done.id, reason, error });
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

  private record(entry: TranscriptEntry): void {
    this.transcript.append(entry);
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
