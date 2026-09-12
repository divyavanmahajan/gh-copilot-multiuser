/**
 * Identity providers.
 *
 * A provider turns an HTTP login flow into an Identity. The room never cares
 * which provider produced an identity; roles and rights come from the
 * Identity itself. GitHub and guest exist today; a corporate OIDC provider is
 * the planned third.
 */
import type { Hono } from "hono";
import type { Identity } from "../../protocol/messages.js";

export interface AuthProvider {
  readonly name: string;
  /** Mount this provider's routes (login, callback, device poll, ...). */
  mount(app: Hono, issue: (identity: Identity) => Promise<string>): void;
}
