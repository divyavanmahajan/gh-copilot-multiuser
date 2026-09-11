/**
 * Browser sessions: an opaque token in an HMAC-signed cookie mapped to an
 * Identity. In-memory for the first milestone; a room restart logs everyone
 * out, which is acceptable for a tool that runs alongside a meeting.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Identity, Role } from "../../protocol/messages.js";

export const COOKIE_NAME = "copilot_room";

export class SessionStore {
  private readonly sessions = new Map<string, Identity>();

  constructor(private readonly secret: string) {}

  async issue(identity: Identity): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    this.sessions.set(token, identity);
    return `${token}.${this.sign(token)}`;
  }

  lookup(cookieValue: string | undefined): Identity | null {
    if (!cookieValue) return null;
    const [token, sig] = cookieValue.split(".");
    if (!token || !sig) return null;
    const expected = this.sign(token);
    if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    return this.sessions.get(token) ?? null;
  }

  /** Change the role on every browser session of one identity (admission, promotion). */
  updateRole(identityId: string, role: Role): void {
    for (const [token, identity] of this.sessions) {
      if (identity.id === identityId) this.sessions.set(token, { ...identity, role });
    }
  }

  /** Log an identity out everywhere, e.g. after a host rejects them. */
  revokeIdentity(identityId: string): void {
    for (const [token, identity] of this.sessions) {
      if (identity.id === identityId) this.sessions.delete(token);
    }
  }

  revoke(cookieValue: string | undefined): void {
    const token = cookieValue?.split(".")[0];
    if (token) this.sessions.delete(token);
  }

  private sign(token: string): string {
    return createHmac("sha256", this.secret).update(token).digest("base64url");
  }
}
