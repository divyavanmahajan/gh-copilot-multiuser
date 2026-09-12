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
import { SettingsStore } from "./settings.js";
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
  const settings = new SettingsStore(config.stateDir, {
    admission: {
      github: config.github.publicAdmission,
      entra: config.entra?.admission,
      guest: config.guests.policy,
    },
  });
  await settings.load();
  log(`admission policy: ${JSON.stringify(settings.get().admission)} (hosts can change it in the UI)`);

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
        publicAdmission: settings.policy("github"),
        admissions,
        secureCookies,
      }),
    );
  } else {
    log("GITHUB_APP_CLIENT_ID/SECRET not set: GitHub sign-in disabled");
  }
  if (config.entra) {
    providers.push(
      new EntraProvider({
        tenantId: config.entra.tenantId,
        clientId: config.entra.clientId,
        clientSecret: config.entra.clientSecret,
        group: config.entra.group,
        admission: settings.policy("entra"),
        publicUrl: config.publicUrl,
        hosts: config.github.hosts,
        admissions,
        secureCookies,
      }),
    );
  }
  // Guests are always mounted; the live policy decides whether they get in,
  // so a host can switch guests on from the UI without a restart.
  const guestCode = config.guests.code ?? randomBytes(4).toString("hex");
  providers.push(new GuestProvider({ policy: settings.policy("guest"), code: guestCode, secureCookies }));

  const room = new Room({
    name: config.roomName,
    repo: config.repo,
    model: config.model,
    stateDir: config.stateDir,
    permissionTimeoutMs: config.permissionTimeoutSeconds * 1000,
    settings,
    guestCode,
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
  app.get("/api/room", (c) => {
    const { admission } = settings.get();
    return c.json({
      name: config.roomName,
      mode: config.mode,
      // Only sign-in methods that can currently succeed are offered.
      providers: providers.map((p) => p.name).filter((n) => n !== "guest" || admission.guest !== "off"),
      admission,
      sessionId: room.sessionId,
    });
  });

  // Built: dist/cli.js sits next to dist/web. Run from source via tsx:
  // src/server/index.ts, so reach the repo-root dist/web instead.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const webDir = [path.join(moduleDir, "web"), path.resolve(moduleDir, "../../dist/web")].find((d) => existsSync(d));
  if (webDir) {
    app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDir) }));
    app.get("*", serveStatic({ path: path.relative(process.cwd(), path.join(webDir, "index.html")) }));
  } else {
    app.get("/", (c) => c.text("client not built; run `npm run build:web`"));
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

  return { url: `http://${config.host}:${port}`, port, guestCode: settings.get().admission.guest === "off" ? undefined : guestCode, close };
}
