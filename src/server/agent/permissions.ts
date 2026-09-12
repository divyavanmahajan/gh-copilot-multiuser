/**
 * Routes Copilot permission prompts (shell, write, url, ...) to humans.
 *
 * Policy for the first milestone: the author of the running prompt decides.
 * If they are gone, any host may. No answer before the timeout means reject.
 * Voting and per-kind auto-approval are later milestones.
 */
import { randomUUID } from "node:crypto";
import type { PermissionHandler, PermissionRequest, PermissionRequestResult } from "@github/copilot-sdk";
import type { PermissionDecision } from "../../protocol/messages.js";

export interface PendingPermission {
  requestId: string;
  request: PermissionRequest;
  deciderIds: string[];
  expiresAt: Date;
}

export interface PermissionRouterOptions {
  timeoutMs: number;
  /** Who may decide right now: the current prompt author plus connected hosts. */
  deciders: () => string[];
  broadcast: (pending: PendingPermission) => void;
  resolved: (requestId: string, decision: PermissionDecision | "timeout", byUserId?: string) => void;
}

export class PermissionRouter {
  private readonly pending = new Map<string, { resolve: (r: PermissionRequestResult) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly opts: PermissionRouterOptions) {}

  /** Handler to hand to the SDK. */
  readonly handler: PermissionHandler = (request) => {
    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + this.opts.timeoutMs);
    const deciderIds = this.opts.deciders();

    return new Promise<PermissionRequestResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.opts.resolved(requestId, "timeout");
        resolve({ kind: "reject" });
      }, this.opts.timeoutMs);
      this.pending.set(requestId, { resolve, timer });
      this.opts.broadcast({ requestId, request, deciderIds, expiresAt });
    });
  };

  /** Called when a browser answers. Returns false if the request is unknown. */
  respond(requestId: string, decision: PermissionDecision, byUserId: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve({ kind: decision });
    this.opts.resolved(requestId, decision, byUserId);
    return true;
  }

  /** Reject everything outstanding, e.g. when the turn is aborted. */
  rejectAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ kind: "reject" });
      this.opts.resolved(id, "reject");
    }
    this.pending.clear();
  }
}
