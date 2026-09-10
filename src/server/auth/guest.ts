/**
 * Guest sign-in for people without a GitHub account: a join code and a name.
 * Guests are viewers or members depending on the room's guest policy and are
 * never hosts. Their identity is unverified, and the UI says so.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Identity } from "../../protocol/messages.js";
import type { GuestPolicy } from "../../config.js";
import type { AuthProvider } from "./provider.js";
import { COOKIE_NAME } from "./session-store.js";

export class GuestProvider implements AuthProvider {
  readonly name = "guest";

  constructor(
    private readonly opts: { policy: Exclude<GuestPolicy, "off">; code: string; secureCookies: boolean },
  ) {}

  mount(app: Hono, issue: (identity: Identity) => Promise<string>): void {
    app.post("/auth/guest", async (c) => {
      const { code, name } = (await c.req.json()) as { code?: string; name?: string };
      const cleanName = (name ?? "").trim().slice(0, 40);
      if (!code || !cleanName) return c.json({ error: "code and name are required" }, 400);
      if (!safeEqual(code, this.opts.code)) return c.json({ error: "wrong join code" }, 403);
      const identity: Identity = {
        id: `guest:${randomBytes(8).toString("base64url")}`,
        provider: "guest",
        login: cleanName,
        displayName: cleanName,
        role: this.opts.policy === "participate" ? "member" : "viewer",
      };
      setCookie(c, COOKIE_NAME, await issue(identity), {
        httpOnly: true,
        sameSite: "Lax",
        secure: this.opts.secureCookies,
        path: "/",
      });
      return c.json({ ok: true });
    });
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
