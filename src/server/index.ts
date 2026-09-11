/**
 * HTTP server: static client, auth routes, a small JSON API, and the
 * WebSocket upgrade. Composes everything from Config.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Server } from "node:http";
import type { Config } from "../config.js";
import { Admissions } from "./auth/admissions.js";
import { EntraProvider } from "./auth/entra.js";
import { GitHubAppProvider } from "./auth/github-app.js";
import { GuestProvider } from "./auth/guest.js";
import type { AuthProvider } from "./auth/provider.js";
import { COOKIE_NAME, SessionStore } from "./auth/session-store.js";
import type { AgentFactory } from "./agent/agent.js";
import { copilotAgentFactory } from "./agent/copilot.js";
import { Room } from "./room/room.js";
import { attachWebSocket } from "./ws.js";

export interface ServerDeps {
  /** Override the agent, e.g. with a fake in tests. Defaults to the Copilot SDK. */
  agentFactory?: AgentFactory;
}

export interface RunningServer {
  url: string;
  port: number;
  guestCode?: string;
  close: () => Promise<void>;
}

export async function startServer(config: Config, deps: ServerDeps = {}): Promise<RunningServer> {
  const log = (m: string) => console.error(`[copilot-room] ${m}`);
  const secureCookies = config.publicUrl.startsWith("https://");
  const sessions = new SessionStore(config.cookieSecret ?? randomBytes(32).toString("hex"));
  const admissions = new Admissions(config.stateDir, config.allow);
  await admissions.load();

  const providers: AuthProvider[] = [];
  if (config.github.clientId && config.github.clientSecret) {
    providers.push(
      new GitHubAppProvider({
        clientId: config.github.clientId,
        clientSecret: config.github.clientSecret,
        publicUrl: config.publicUrl,
        apiBase: config.github.apiBase,
        webBase: config.github.webBase,
        allowed: config.github.allowed,
        hosts: config.github.hosts,
        publicAdmission: config.github.publicAdmission,
        admissions,
        secureCookies,
      }),
    );
    if (!config.github.allowed && config.github.publicAdmission === "off") {
      log("GitHub sign-in: no --org and --public-github off, so only --hosts and --allow entries can get in");
    }
  } else {
    log("GITHUB_APP_CLIENT_ID/SECRET not set: GitHub sign-in disabled");
  }
  if (config.entra) {
    providers.push(
      new EntraProvider({
        ...config.entra,
        publicUrl: config.publicUrl,
        hosts: config.github.hosts,
        admissions,
        secureCookies,
      }),
    );
  }
  let guestCode: string | undefined;
  if (config.guests.policy !== "off") {
    guestCode = config.guests.code ?? randomBytes(4).toString("hex");
    providers.push(new GuestProvider({ policy: config.guests.policy, code: guestCode, secureCookies }));
  }
  if (providers.length === 0) throw new Error("no way to sign in: configure a GitHub App or enable guests");

  const room = new Room({
    name: config.roomName,
    repo: config.repo,
    model: config.model,
    stateDir: config.stateDir,
    permissionTimeoutMs: config.permissionTimeoutSeconds * 1000,
    onAdmission: async (identity, decision, by) => {
      await admissions.record(identity, decision, by.login);
      if (decision === "reject") sessions.revokeIdentity(identity.id);
      else sessions.updateRole(identity.id, decision);
      log(`${by.login} ${decision === "reject" ? "rejected" : `admitted as ${decision}`} ${identity.provider}:${identity.login}`);
    },
    agentFactory:
      deps.agentFactory ??
      copilotAgentFactory({
        repo: config.repo,
        model: config.model,
        sessionId: config.sessionId,
        gitHubToken: config.copilotToken,
      }),
    log,
  });
  await room.start();

  const app = new Hono();
  for (const p of providers) p.mount(app, (identity) => sessions.issue(identity));

  app.get("/api/me", (c) => {
    const identity = sessions.lookup(getCookie(c, COOKIE_NAME));
    return identity ? c.json(identity) : c.json({ error: "unauthenticated" }, 401);
  });
  app.get("/api/room", (c) =>
    c.json({
      name: config.roomName,
      mode: config.mode,
      providers: providers.map((p) => p.name),
      guestsPolicy: config.guests.policy,
      publicGitHub: config.github.publicAdmission,
      entraAdmission: config.entra?.admission ?? "off",
      sessionId: room.sessionId,
    }),
  );

  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "web");
  if (existsSync(webDir)) {
    app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDir) }));
    app.get("*", serveStatic({ path: path.relative(process.cwd(), path.join(webDir, "index.html")) }));
  } else {
    app.get("/", (c) => c.text("client not built; run `npm run build` or use `npm run dev`"));
  }

  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => resolve(s as Server)) as Server;
  });
  attachWebSocket(server, room, sessions, log);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;

  const close = async () => {
    await room.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  const shutdown = async () => {
    log("shutting down");
    await close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  return { url: `http://${config.host}:${port}`, port, guestCode, close };
}
