/**
 * GitHub App sign-in.
 *
 * Two flows, both ending in the same Identity:
 *  - Web flow (server mode): /auth/github/login -> github.com -> /auth/github/callback.
 *    The callback is a browser redirect, so an internal hostname works fine.
 *  - Device flow (laptop mode): /auth/github/device starts it, the browser
 *    shows the code, /auth/github/device/poll completes it. No callback URL.
 *
 * Scopes: read:org is enough for the membership gate.
 *
 * Admission: org/team members are admitted as members. Anyone else is
 * handled by `publicAdmission` (refuse, wait for a host, or admit directly),
 * unless a host already decided about them or they are on the allow list.
 */
import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Identity } from "../../protocol/messages.js";
import { resolveRole, type Admissions, type AdmissionPolicy } from "./admissions.js";
import { isMember, type MembershipCheck } from "./membership.js";
import type { AuthProvider } from "./provider.js";
import { COOKIE_NAME } from "./session-store.js";

export interface GitHubAppOptions {
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  apiBase: string;
  webBase: string;
  allowed?: MembershipCheck;
  hosts: string[];
  publicAdmission: AdmissionPolicy;
  admissions: Admissions;
  secureCookies: boolean;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export class GitHubAppProvider implements AuthProvider {
  readonly name = "github";
  private readonly pendingStates = new Map<string, number>();
  private readonly deviceFlows = new Map<string, { deviceCode: string; interval: number }>();

  constructor(private readonly opts: GitHubAppOptions) {}

  mount(app: Hono, issue: (identity: Identity) => Promise<string>): void {
    // --- Web flow -------------------------------------------------------
    app.get("/auth/github/login", (c) => {
      const state = randomBytes(16).toString("base64url");
      this.pendingStates.set(state, Date.now());
      const url = new URL(`${this.opts.webBase}/login/oauth/authorize`);
      url.searchParams.set("client_id", this.opts.clientId);
      url.searchParams.set("redirect_uri", `${this.opts.publicUrl}/auth/github/callback`);
      url.searchParams.set("scope", "read:org");
      url.searchParams.set("state", state);
      return c.redirect(url.toString());
    });

    app.get("/auth/github/callback", async (c) => {
      const code = c.req.query("code");
      const state = c.req.query("state");
      if (!code || !state || !this.pendingStates.delete(state)) return c.text("invalid OAuth state", 400);
      const token = await this.exchangeCode(code);
      const identity = await this.identityFor(token);
      if (!identity) return c.text("your GitHub account is not allowed into this room", 403);
      setCookie(c, COOKIE_NAME, await issue(identity), this.cookieOptions());
      return c.redirect("/");
    });

    // --- Device flow ----------------------------------------------------
    app.post("/auth/github/device", async (c) => {
      const res = await fetch(`${this.opts.webBase}/login/device/code`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: this.opts.clientId, scope: "read:org" }),
      });
      const body = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; interval: number };
      const flowId = randomBytes(12).toString("base64url");
      this.deviceFlows.set(flowId, { deviceCode: body.device_code, interval: body.interval });
      return c.json({ flowId, userCode: body.user_code, verificationUri: body.verification_uri, interval: body.interval });
    });

    app.post("/auth/github/device/poll", async (c) => {
      const { flowId } = (await c.req.json()) as { flowId: string };
      const flow = this.deviceFlows.get(flowId);
      if (!flow) return c.json({ status: "unknown" }, 404);
      const res = await fetch(`${this.opts.webBase}/login/oauth/access_token`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.opts.clientId,
          device_code: flow.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const body = (await res.json()) as { access_token?: string; error?: string };
      if (body.error === "authorization_pending" || body.error === "slow_down") return c.json({ status: "pending" });
      this.deviceFlows.delete(flowId);
      if (!body.access_token) return c.json({ status: "failed", error: body.error }, 400);
      const identity = await this.identityFor(body.access_token);
      if (!identity) return c.json({ status: "forbidden" }, 403);
      setCookie(c, COOKIE_NAME, await issue(identity), this.cookieOptions());
      return c.json({ status: "ok" });
    });

    app.post("/auth/logout", (c) => {
      setCookie(c, COOKIE_NAME, "", { ...this.cookieOptions(), maxAge: 0 });
      return c.json({ ok: true });
    });
  }

  private cookieOptions() {
    return { httpOnly: true, sameSite: "Lax" as const, secure: this.opts.secureCookies, path: "/" };
  }

  private async exchangeCode(code: string): Promise<string> {
    const res = await fetch(`${this.opts.webBase}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        code,
        redirect_uri: `${this.opts.publicUrl}/auth/github/callback`,
      }),
    });
    const body = (await res.json()) as { access_token?: string; error?: string };
    if (!body.access_token) throw new Error(`token exchange failed: ${body.error ?? res.status}`);
    return body.access_token;
  }

  private async identityFor(userToken: string): Promise<Identity | null> {
    const res = await fetch(`${this.opts.apiBase}/user`, {
      headers: { Authorization: `Bearer ${userToken}`, Accept: "application/vnd.github+json", "User-Agent": "copilot-room" },
    });
    if (res.status !== 200) return null;
    const user = (await res.json()) as GitHubUser;
    const base = { id: `github:${user.id}`, provider: "github" as const, login: user.login };
    const gate = this.opts.allowed ? await isMember(this.opts.apiBase, userToken, user.login, this.opts.allowed) : null;
    const role = resolveRole({
      identity: base,
      hosts: this.opts.hosts,
      gate,
      policy: this.opts.publicAdmission,
      admissions: this.opts.admissions,
    });
    if (!role) return null;
    return { ...base, displayName: user.name ?? user.login, avatarUrl: user.avatar_url, role };
  }
}
