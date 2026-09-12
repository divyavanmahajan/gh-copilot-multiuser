/**
 * Guest sign-in for people without a GitHub or Entra account: a join code
 * and a name. By default a guest then waits for a host to admit them as a
 * viewer or participant; the room's guest policy (host-editable) can refuse
 * guests or admit them directly. Guests are never hosts, and their identity
 * is unverified, which the UI says.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { AdmissionPolicy, Identity, Role } from "../../protocol/messages.js";
import type { AuthProvider } from "./provider.js";
import { COOKIE_NAME } from "./session-store.js";

export class GuestProvider implements AuthProvider {
  readonly name = "guest";

  constructor(private readonly opts: { policy: () => AdmissionPolicy; code: string; secureCookies: boolean }) {}

  mount(app: Hono, issue: (identity: Identity) => Promise<string>): void {
    app.post("/auth/guest", async (c) => {
      const policy = this.opts.policy();
      if (policy === "off") return c.json({ error: "guests are not admitted to this room" }, 403);
      const { code, name } = (await c.req.json()) as { code?: string; name?: string };
      const cleanName = (name ?? "").trim().slice(0, 40);
      if (!code || !cleanName) return c.json({ error: "code and name are required" }, 400);
      if (!safeEqual(code, this.opts.code)) return c.json({ error: "wrong join code" }, 403);
      const role: Role = policy === "approve" ? "pending" : policy;
      const identity: Identity = {
        id: `guest:${randomBytes(8).toString("base64url")}`,
        provider: "guest",
        login: cleanName,
        displayName: cleanName,
        role,
      };
      setCookie(c, COOKIE_NAME, await issue(identity), {
        httpOnly: true,
        sameSite: "Lax",
        secure: this.opts.secureCookies,
        path: "/",
      });
      return c.json({ ok: true, role });
    });
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
