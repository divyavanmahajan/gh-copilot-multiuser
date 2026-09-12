/**
 * End to end over real HTTP and WebSockets: guest sign-in, cookie, upgrade,
 * prompt, streamed transcript, presence.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { startServer, type RunningServer } from "../src/server/index.js";
import { ServerMessage } from "../src/protocol/messages.js";
import { fakeAgentFactory, waitFor } from "./fake-agent.js";

let server: RunningServer;

beforeAll(async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "room-e2e-"));
  const config = loadConfig(
    ["--port", "0", "--guests", "participate", "--guest-code", "letmein", "--state-dir", stateDir, "--name", "e2e"],
    { GITHUB_APP_CLIENT_ID: undefined, GITHUB_APP_CLIENT_SECRET: undefined } as NodeJS.ProcessEnv,
  );
  server = await startServer(config, { agentFactory: fakeAgentFactory() });
});

afterAll(async () => {
  await server.close();
});

async function signInGuest(name: string, code = "letmein"): Promise<string> {
  const res = await fetch(`${server.url}/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, code }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("no cookie");
  return cookie;
}

function openSocket(cookie: string): { ws: WebSocket; inbox: ServerMessage[] } {
  const ws = new WebSocket(server.url.replace("http", "ws") + "/ws", { headers: { cookie } });
  const inbox: ServerMessage[] = [];
  ws.on("message", (raw) => inbox.push(ServerMessage.parse(JSON.parse(raw.toString()))));
  return { ws, inbox };
}

describe("server", () => {
  it("rejects the wrong join code and unauthenticated sockets", async () => {
    const res = await fetch(`${server.url}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "mallory", code: "nope" }),
    });
    expect(res.status).toBe(403);

    const ws = new WebSocket(server.url.replace("http", "ws") + "/ws");
    const code = await new Promise<number | string>((resolve) => {
      ws.on("error", (e) => resolve(e.message));
      ws.on("close", (c) => resolve(c));
    });
    expect(String(code)).toMatch(/401/);
  });

  it("lets two guests share one agent turn by turn", async () => {
    const a = openSocket(await signInGuest("alice"));
    const b = openSocket(await signInGuest("bob"));
    await waitFor(() => a.inbox.some((m) => m.type === "hello") && b.inbox.some((m) => m.type === "hello"));

    const hello = b.inbox.find((m) => m.type === "hello");
    expect(hello?.type === "hello" && hello.you.role).toBe("member");
    expect(hello?.type === "hello" && hello.you.provider).toBe("guest");
    expect(hello?.type === "hello" && hello.room.name).toBe("e2e");

    a.ws.send(JSON.stringify({ type: "prompt.submit", text: "first" }));
    b.ws.send(JSON.stringify({ type: "prompt.submit", text: "second" }));

    const finished = (inbox: ServerMessage[]) =>
      inbox.filter((m) => m.type === "transcript" && m.entry.kind === "turn.finished").length;
    await waitFor(() => finished(a.inbox) === 2 && finished(b.inbox) === 2);

    const starts = a.inbox.flatMap((m) => (m.type === "transcript" && m.entry.kind === "turn.started" ? [m.entry.prompt.authorLogin] : []));
    expect(starts).toEqual(["alice", "bob"]);

    const streamed = (inbox: ServerMessage[]) =>
      inbox
        .flatMap((m) => (m.type === "transcript" && m.entry.kind === "agent" ? [m.entry.event] : []))
        .filter((e) => e.type === "assistant.message_delta")
        .map((e) => (e.data as { deltaContent: string }).deltaContent)
        .join("");
    expect(streamed(a.inbox)).toBe("Sure, done.Sure, done.");
    expect(streamed(b.inbox)).toBe(streamed(a.inbox));

    a.ws.close();
    b.ws.close();
  });

  it("serves the API for the login page", async () => {
    const res = await fetch(`${server.url}/api/room`);
    expect(await res.json()).toMatchObject({
      name: "e2e",
      providers: ["guest"],
      admission: { github: "approve", entra: "approve", guest: "member" },
    });
    const me = await fetch(`${server.url}/api/me`);
    expect(me.status).toBe(401);
  });
});

describe("server with default admission", () => {
  let dflt: RunningServer;
  let stateDir: string;

  beforeAll(async () => {
    stateDir = await mkdtemp(path.join(tmpdir(), "room-e2e-default-"));
    const config = loadConfig(["--port", "0", "--guest-code", "knock", "--state-dir", stateDir], {} as NodeJS.ProcessEnv);
    dflt = await startServer(config, { agentFactory: fakeAgentFactory() });
  });

  afterAll(async () => {
    await dflt.close();
  });

  it("makes guests wait for a host by default, and persists a host's policy change", async () => {
    const res = await fetch(`${dflt.url}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "walk-in", code: "knock" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: "pending" });
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;

    const ws = new WebSocket(dflt.url.replace("http", "ws") + "/ws", { headers: { cookie } });
    const inbox: ServerMessage[] = [];
    ws.on("message", (raw) => inbox.push(ServerMessage.parse(JSON.parse(raw.toString()))));
    await waitFor(() => inbox.length > 0);
    expect(inbox[0]?.type).toBe("admission.pending");
    ws.close();

    // A saved settings file wins over the default on the next start.
    await writeFile(path.join(stateDir, "settings.json"), JSON.stringify({ admission: { guest: "viewer" } }));
    await dflt.close();
    dflt = await startServer(loadConfig(["--port", "0", "--guest-code", "knock", "--state-dir", stateDir], {} as NodeJS.ProcessEnv), {
      agentFactory: fakeAgentFactory(),
    });
    const again = await fetch(`${dflt.url}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "walk-in", code: "knock" }),
    });
    expect(await again.json()).toEqual({ ok: true, role: "viewer" });
  });
});
