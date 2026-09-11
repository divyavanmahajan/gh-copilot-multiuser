import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Room, type Connection } from "../src/server/room/room.js";
import type { Identity, ServerMessage } from "../src/protocol/messages.js";
import { fakeAgentFactory, waitFor } from "./fake-agent.js";

function identity(login: string, role: Identity["role"] = "member"): Identity {
  return { id: `github:${login}`, provider: "github", login, displayName: login, role };
}

function connect(room: Room, id: Identity): { conn: Connection; inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  const conn: Connection = { id: `c-${id.login}`, identity: id, send: (m) => inbox.push(m) };
  room.join(conn);
  return { conn, inbox };
}

const entries = (inbox: ServerMessage[]) => inbox.flatMap((m) => (m.type === "transcript" ? [m.entry] : []));

describe("Room", () => {
  let room: Room;
  let factory: ReturnType<typeof fakeAgentFactory>;

  beforeEach(async () => {
    factory = fakeAgentFactory();
    room = new Room({
      name: "test",
      repo: "/repo",
      stateDir: await mkdtemp(path.join(tmpdir(), "room-")),
      permissionTimeoutMs: 200,
      agentFactory: factory,
      log: () => {},
    });
    await room.start();
    await waitFor(() => room.currentStatus === "idle");
  });

  afterEach(async () => {
    await room.stop();
  });

  it("greets a joiner with the room state and announces presence to everyone", () => {
    const alice = connect(room, identity("alice", "host"));
    const bob = connect(room, identity("bob"));
    const hello = bob.inbox[0];
    expect(hello?.type).toBe("hello");
    if (hello?.type !== "hello") return;
    expect(hello.you.login).toBe("bob");
    expect(hello.status).toBe("idle");
    expect(hello.participants.map((p) => p.login).sort()).toEqual(["alice", "bob"]);
    // Alice saw Bob arrive.
    const last = alice.inbox.at(-1);
    expect(last?.type === "participants" && last.participants.length).toBe(2);
  });

  it("serializes prompts from two people and attributes them", async () => {
    const alice = connect(room, identity("alice"));
    const bob = connect(room, identity("bob"));

    await room.handle(alice.conn.id, { type: "prompt.submit", text: "add a test" });
    await room.handle(bob.conn.id, { type: "prompt.submit", text: "then lint" });

    // Bob's prompt waits while Alice's runs.
    const queued = bob.inbox.filter((m) => m.type === "queue").at(-1);
    expect(queued?.type === "queue" && queued.current?.authorLogin).toBe("alice");
    expect(queued?.type === "queue" && queued.queue.map((p) => p.authorLogin)).toEqual(["bob"]);

    await waitFor(() => entries(bob.inbox).filter((e) => e.kind === "turn.finished").length === 2);

    const agent = factory.instance();
    expect(agent.prompts).toEqual(["[alice]: add a test", "[bob]: then lint"]);

    // Both saw identical streamed output.
    const aliceAgent = entries(alice.inbox).filter((e) => e.kind === "agent");
    const bobAgent = entries(bob.inbox).filter((e) => e.kind === "agent");
    expect(bobAgent).toEqual(aliceAgent);
    expect(aliceAgent.map((e) => (e.kind === "agent" ? e.event.type : "")).filter((t) => t === "assistant.message")).toHaveLength(2);
    expect(room.currentStatus).toBe("idle");
  });

  it("routes permission prompts to the author, and only the author may answer", async () => {
    const alice = connect(room, identity("alice"));
    const bob = connect(room, identity("bob"));

    await room.handle(alice.conn.id, { type: "prompt.submit", text: "run the tests" });
    await waitFor(() => bob.inbox.some((m) => m.type === "permission.request"));

    const req = bob.inbox.find((m) => m.type === "permission.request");
    if (req?.type !== "permission.request") throw new Error("no request");
    expect(req.deciderIds).toEqual(["github:alice"]);

    await room.handle(bob.conn.id, { type: "permission.respond", requestId: req.requestId, decision: "approve-once" });
    expect(bob.inbox.at(-1)).toEqual({ type: "error", message: "not your call" });

    await room.handle(alice.conn.id, { type: "permission.respond", requestId: req.requestId, decision: "approve-once" });
    await waitFor(() => entries(alice.inbox).some((e) => e.kind === "turn.finished"));

    const resolved = entries(alice.inbox).find((e) => e.kind === "permission.resolved");
    expect(resolved?.kind === "permission.resolved" && resolved.byUserId).toBe("github:alice");
    const done = entries(alice.inbox).find((e) => e.kind === "agent" && e.event.type === "tool.execution_complete");
    expect(done?.kind === "agent" && (done.event.data as { success: boolean }).success).toBe(true);
  });

  it("rejects a permission request nobody answers before the timeout", async () => {
    const alice = connect(room, identity("alice"));
    await room.handle(alice.conn.id, { type: "prompt.submit", text: "run it" });
    await waitFor(() => entries(alice.inbox).some((e) => e.kind === "turn.finished"), 3000);
    const resolved = entries(alice.inbox).find((e) => e.kind === "permission.resolved");
    expect(resolved?.kind === "permission.resolved" && resolved.decision).toBe("timeout");
  });

  it("keeps viewers read-only and lets hosts abort", async () => {
    const host = connect(room, identity("alice", "host"));
    const viewer = connect(room, identity("guest-1", "viewer"));

    await room.handle(viewer.conn.id, { type: "prompt.submit", text: "hi" });
    expect(viewer.inbox.at(-1)).toEqual({ type: "error", message: "viewers cannot submit prompts" });

    await room.handle(host.conn.id, { type: "prompt.submit", text: "long task" });
    await room.handle(viewer.conn.id, { type: "turn.abort" });
    expect(viewer.inbox.at(-1)).toEqual({ type: "error", message: "only a host can abort" });

    await room.handle(host.conn.id, { type: "turn.abort" });
    expect(factory.instance().aborted).toBe(1);
    const finished = entries(host.inbox).find((e) => e.kind === "turn.finished");
    expect(finished?.kind === "turn.finished" && finished.reason).toBe("aborted");
  });

  it("replays the transcript to a late joiner", async () => {
    const alice = connect(room, identity("alice"));
    await room.handle(alice.conn.id, { type: "prompt.submit", text: "hello" });
    await waitFor(() => entries(alice.inbox).some((e) => e.kind === "turn.finished"));

    const carol = connect(room, identity("carol"));
    const hello = carol.inbox[0];
    expect(hello?.type === "hello" && hello.transcript.map((e) => e.kind)).toEqual(
      entries(alice.inbox).map((e) => e.kind),
    );
  });
});

describe("Room admissions", () => {
  let room: Room;
  const decisions: string[] = [];

  beforeEach(async () => {
    decisions.length = 0;
    room = new Room({
      name: "test",
      repo: "/repo",
      stateDir: await mkdtemp(path.join(tmpdir(), "room-")),
      permissionTimeoutMs: 200,
      agentFactory: fakeAgentFactory(),
      onAdmission: (identity, decision, by) => void decisions.push(`${by.login}:${decision}:${identity.login}`),
      log: () => {},
    });
    await room.start();
    await waitFor(() => room.currentStatus === "idle");
  });

  afterEach(async () => {
    await room.stop();
  });

  it("parks pending users, tells hosts, and admits them with the chosen role", async () => {
    const host = connect(room, identity("alice", "host"));
    const dan = connect(room, identity("dan", "pending"));

    expect(dan.inbox).toEqual([{ type: "admission.pending", you: identity("dan", "pending") }]);
    const notice = host.inbox.at(-1);
    expect(notice?.type === "admissions" && notice.requests.map((r) => r.identity.login)).toEqual(["dan"]);
    // Not a participant yet.
    const hello = host.inbox[0];
    expect(hello?.type === "hello" && hello.participants.map((p) => p.login)).toEqual(["alice"]);

    await room.handle(host.conn.id, { type: "admission.decide", userId: "github:dan", decision: "member" });
    expect(decisions).toEqual(["alice:member:dan"]);
    expect(dan.inbox[1]).toEqual({ type: "admission.decided", role: "member" });
    const danHello = dan.inbox[2];
    expect(danHello?.type === "hello" && danHello.you.role).toBe("member");
    expect(danHello?.type === "hello" && danHello.participants.map((p) => p.login).sort()).toEqual(["alice", "dan"]);

    // Dan can now prompt, and the host's waiting list is empty.
    await room.handle(dan.conn.id, { type: "prompt.submit", text: "hi" });
    expect(dan.inbox.some((m) => m.type === "error")).toBe(false);
    const cleared = host.inbox.filter((m) => m.type === "admissions").at(-1);
    expect(cleared?.type === "admissions" && cleared.requests).toEqual([]);
  });

  it("rejects, and only hosts may decide", async () => {
    const host = connect(room, identity("alice", "host"));
    const member = connect(room, identity("bob"));
    const eve = connect(room, identity("eve", "pending"));

    await room.handle(member.conn.id, { type: "admission.decide", userId: "github:eve", decision: "member" });
    expect(member.inbox.at(-1)).toEqual({ type: "error", message: "only a host can admit people" });

    await room.handle(host.conn.id, { type: "admission.decide", userId: "github:eve", decision: "reject" });
    expect(eve.inbox.at(-1)).toEqual({ type: "admission.decided", role: null });
    expect(decisions).toEqual(["alice:reject:eve"]);

    await room.handle(host.conn.id, { type: "admission.decide", userId: "github:eve", decision: "member" });
    expect(host.inbox.at(-1)).toEqual({ type: "error", message: "that user is not here any more" });
  });

  it("re-roles or removes people who are already in", async () => {
    const host = connect(room, identity("alice", "host"));
    const viewer = connect(room, identity("vic", "viewer"));

    await room.handle(host.conn.id, { type: "admission.decide", userId: "github:vic", decision: "member" });
    const hello = viewer.inbox.filter((m) => m.type === "hello").at(-1);
    expect(hello?.type === "hello" && hello.you.role).toBe("member");

    await room.handle(host.conn.id, { type: "admission.decide", userId: "github:vic", decision: "reject" });
    expect(viewer.inbox.at(-1)).toEqual({ type: "admission.decided", role: null });
    const seen = host.inbox.filter((m) => m.type === "participants").at(-1);
    expect(seen?.type === "participants" && seen.participants.map((p) => p.login)).toEqual(["alice"]);

    // Hosts cannot be decided on.
    await room.handle(host.conn.id, { type: "admission.decide", userId: "github:alice", decision: "viewer" });
    expect(host.inbox.at(-1)).toEqual({ type: "error", message: "that user is not here any more" });
  });
});

describe("Room settings", () => {
  it("lets hosts change admission settings, persists them, and tells other hosts", async () => {
    let current = { admission: { github: "approve" as const, entra: "approve" as const, guest: "approve" as const } };
    const updates: unknown[] = [];
    const room = new Room({
      name: "test",
      repo: "/repo",
      stateDir: await mkdtemp(path.join(tmpdir(), "room-")),
      permissionTimeoutMs: 200,
      agentFactory: fakeAgentFactory(),
      settings: {
        get: () => current,
        update: async (patch) => {
          updates.push(patch);
          current = { admission: { ...current.admission, ...patch.admission } } as typeof current;
          return current;
        },
      },
      guestCode: "knock",
      log: () => {},
    });
    await room.start();
    await waitFor(() => room.currentStatus === "idle");

    const host = connect(room, identity("alice", "host"));
    const other = connect(room, identity("zed", "host"));
    const member = connect(room, identity("bob"));

    const hello = host.inbox[0];
    expect(hello?.type === "hello" && hello.settings?.admission.guest).toBe("approve");
    expect(hello?.type === "hello" && hello.guestCode).toBe("knock");
    const memberHello = member.inbox[0];
    expect(memberHello?.type === "hello" && memberHello.settings).toBeNull();
    expect(memberHello?.type === "hello" && memberHello.guestCode).toBeNull();

    await room.handle(member.conn.id, { type: "settings.update", patch: { admission: { guest: "member" } } });
    expect(member.inbox.at(-1)).toEqual({ type: "error", message: "only a host can change settings" });

    await room.handle(host.conn.id, { type: "settings.update", patch: { admission: { guest: "viewer" } } });
    expect(updates).toEqual([{ admission: { guest: "viewer" } }]);
    const seenByOther = other.inbox.at(-1);
    expect(seenByOther?.type === "settings" && seenByOther.settings.admission.guest).toBe("viewer");
    expect(member.inbox.some((m) => m.type === "settings")).toBe(false);

    await room.stop();
  });
});
