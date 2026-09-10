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
import { GitHubAppProvider } from "./auth/github-app.js";
import { GuestProvider } from "./auth/guest.js";
import type { AuthProvider } from "./auth/provider.js";
import { COOKIE_NAME, SessionStore } from "./auth/session-store.js";
import { Room } from "./room/room.js";
import { attachWebSocket } from "./ws.js";

export async function startServer(config: Config): Promise<{ url: string; guestCode?: string }> {
  const log = (m: string) => console.error(`[copilot-room] ${m}`);
  const secureCookies = config.publicUrl.startsWith("https://");
  const sessions = new SessionStore(config.cookieSecret ?? randomBytes(32).toString("hex"));

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
        secureCookies,
      }),
    );
  } else {
    log("GITHUB_APP_CLIENT_ID/SECRET not set: GitHub sign-in disabled");
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
    sessionId: config.sessionId,
    stateDir: config.stateDir,
    copilotToken: config.copilotToken,
    permissionTimeoutMs: config.permissionTimeoutSeconds * 1000,
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

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }) as Server;
  attachWebSocket(server, room, sessions, log);

  const shutdown = async () => {
    log("shutting down");
    await room.stop();
    server.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  return { url: `http://${config.host}:${config.port}`, guestCode };
}
