/**
 * Microsoft Entra ID sign-in (OpenID Connect).
 *
 * Two flows, both ending in the same Identity:
 *  - Web flow: /auth/entra/login -> login.microsoftonline.com -> /auth/entra/callback.
 *    Authorization code with PKCE; a client secret is used when configured.
 *    Entra only accepts https redirect URIs (localhost excepted), so on a
 *    plain-http LAN use the device flow instead.
 *  - Device flow: /auth/entra/device starts it, /auth/entra/device/poll
 *    completes it. Needs "Allow public client flows" on the app registration.
 *
 * ID tokens are verified against the tenant's published keys (issuer,
 * audience, expiry, and nonce for the web flow).
 */
import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Identity } from "../../protocol/messages.js";
import { resolveRole, type Admissions, type AdmissionPolicy } from "./admissions.js";
import type { AuthProvider } from "./provider.js";
import { COOKIE_NAME } from "./session-store.js";

export interface EntraOptions {
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  group?: string;
  admission: AdmissionPolicy;
  publicUrl: string;
  hosts: string[];
  admissions: Admissions;
  secureCookies: boolean;
  /** Override for tests. */
  authority?: string;
}

interface EntraClaims extends JWTPayload {
  oid?: string;
  preferred_username?: string;
  email?: string;
  upn?: string;
  name?: string;
  groups?: string[];
  nonce?: string;
}

const SCOPE = "openid profile email";

export class EntraProvider implements AuthProvider {
  readonly name = "entra";
  private readonly authority: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly pending = new Map<string, { verifier: string; nonce: string; at: number }>();
  private readonly deviceFlows = new Map<string, { deviceCode: string; interval: number }>();

  constructor(private readonly opts: EntraOptions) {
    this.authority = opts.authority ?? `https://login.microsoftonline.com/${opts.tenantId}`;
    this.jwks = createRemoteJWKSet(new URL(`${this.authority}/discovery/v2.0/keys`));
  }

  mount(app: Hono, issue: (identity: Identity) => Promise<string>): void {
    const redirectUri = `${this.opts.publicUrl}/auth/entra/callback`;

    // --- Web flow (authorization code + PKCE) ---------------------------
    app.get("/auth/entra/login", (c) => {
      const state = randomBytes(16).toString("base64url");
      const nonce = randomBytes(16).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      this.pending.set(state, { verifier, nonce, at: Date.now() });
      const url = new URL(`${this.authority}/oauth2/v2.0/authorize`);
      url.searchParams.set("client_id", this.opts.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", SCOPE);
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
      url.searchParams.set("code_challenge_method", "S256");
      return c.redirect(url.toString());
    });

    app.get("/auth/entra/callback", async (c) => {
      const code = c.req.query("code");
      const state = c.req.query("state");
      const flow = state ? this.pending.get(state) : undefined;
      if (!code || !state || !flow) return c.text("invalid sign-in state", 400);
      this.pending.delete(state);

      const body = new URLSearchParams({
        client_id: this.opts.clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: flow.verifier,
        scope: SCOPE,
      });
      if (this.opts.clientSecret) body.set("client_secret", this.opts.clientSecret);
      const res = await fetch(`${this.authority}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const token = (await res.json()) as { id_token?: string; error?: string; error_description?: string };
      if (!token.id_token) return c.text(`sign-in failed: ${token.error_description ?? token.error ?? res.status}`, 400);

      const identity = await this.identityFor(token.id_token, flow.nonce);
      if (identity === "forbidden") return c.text("your account is not allowed into this room", 403);
      if (identity === "invalid") return c.text("could not verify the sign-in token", 400);
      setCookie(c, COOKIE_NAME, await issue(identity), this.cookieOptions());
      return c.redirect("/");
    });

    // --- Device flow ----------------------------------------------------
    app.post("/auth/entra/device", async (c) => {
      const res = await fetch(`${this.authority}/oauth2/v2.0/devicecode`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.opts.clientId, scope: SCOPE }),
      });
      const body = (await res.json()) as {
        device_code?: string;
        user_code?: string;
        verification_uri?: string;
        interval?: number;
        error_description?: string;
      };
      if (!body.device_code) return c.json({ error: body.error_description ?? "device flow unavailable" }, 400);
      const flowId = randomBytes(12).toString("base64url");
      this.deviceFlows.set(flowId, { deviceCode: body.device_code, interval: body.interval ?? 5 });
      return c.json({ flowId, userCode: body.user_code, verificationUri: body.verification_uri, interval: body.interval ?? 5 });
    });

    app.post("/auth/entra/device/poll", async (c) => {
      const { flowId } = (await c.req.json()) as { flowId: string };
      const flow = this.deviceFlows.get(flowId);
      if (!flow) return c.json({ status: "unknown" }, 404);
      const res = await fetch(`${this.authority}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.opts.clientId,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: flow.deviceCode,
        }),
      });
      const body = (await res.json()) as { id_token?: string; error?: string; error_description?: string };
      if (body.error === "authorization_pending" || body.error === "slow_down") return c.json({ status: "pending" });
      this.deviceFlows.delete(flowId);
      if (!body.id_token) return c.json({ status: "failed", error: body.error_description ?? body.error }, 400);
      const identity = await this.identityFor(body.id_token);
      if (identity === "forbidden") return c.json({ status: "forbidden" }, 403);
      if (identity === "invalid") return c.json({ status: "failed", error: "token verification failed" }, 400);
      setCookie(c, COOKIE_NAME, await issue(identity), this.cookieOptions());
      return c.json({ status: "ok" });
    });
  }

  private cookieOptions() {
    return { httpOnly: true, sameSite: "Lax" as const, secure: this.opts.secureCookies, path: "/" };
  }

  /** Verify the ID token and turn its claims into an Identity with a resolved role. */
  async identityFor(idToken: string, expectedNonce?: string): Promise<Identity | "forbidden" | "invalid"> {
    let claims: EntraClaims;
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: `${this.authority}/v2.0`,
        audience: this.opts.clientId,
      });
      claims = payload as EntraClaims;
    } catch {
      return "invalid";
    }
    if (expectedNonce && claims.nonce !== expectedNonce) return "invalid";
    return this.identityFromClaims(claims);
  }

  /** Exposed for tests: role resolution from already-verified claims. */
  identityFromClaims(claims: EntraClaims): Identity | "forbidden" | "invalid" {
    const oid = claims.oid ?? claims.sub;
    const login = claims.preferred_username ?? claims.upn ?? claims.email;
    if (!oid || !login) return "invalid";
    const base = { id: `entra:${oid}`, provider: "entra" as const, login };
    const gate = this.opts.group ? (claims.groups ?? []).includes(this.opts.group) : null;
    const role = resolveRole({
      identity: base,
      hosts: this.opts.hosts,
      gate,
      policy: this.opts.admission,
      admissions: this.opts.admissions,
    });
    if (!role) return "forbidden";
    return { ...base, displayName: claims.name ?? login, role };
  }
}
