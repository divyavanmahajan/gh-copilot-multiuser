import type { Identity, Participant, PermissionDecision } from "../../protocol/messages.js";

export interface PendingApproval {
  requestId: string;
  request: unknown;
  deciderIds: string[];
  expiresAt: string;
}

export function ApprovalCard({
  pending,
  me,
  participants,
  onDecide,
}: {
  pending: PendingApproval;
  me: Identity;
  participants: Participant[];
  onDecide: (d: PermissionDecision) => void;
}) {
  const mine = pending.deciderIds.includes(me.id);
  const deciders = pending.deciderIds
    .map((id) => participants.find((p) => p.id === id)?.displayName ?? id)
    .join(", ");
  const r = (pending.request ?? {}) as Record<string, unknown>;

  return (
    <div className="card permission">
      <div className="who">Copilot asks permission · {String(r.kind ?? "action")}</div>
      <pre style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{describe(r)}</pre>
      <div className="who">
        {mine ? "Your call." : `Waiting for ${deciders}.`} Expires {new Date(pending.expiresAt).toLocaleTimeString()}.
      </div>
      {mine && (
        <div className="actions">
          <button onClick={() => onDecide("approve-once")}>Approve</button>
          <button className="secondary" onClick={() => onDecide("approve-for-session")}>Approve for session</button>
          <button className="danger" onClick={() => onDecide("reject")}>Reject</button>
        </div>
      )}
    </div>
  );
}

function describe(r: Record<string, unknown>): string {
  // Permission requests are a union keyed by `kind`; show the most useful field for each.
  for (const key of ["fullCommandText", "command", "path", "url", "toolName", "serverName", "intention"]) {
    if (typeof r[key] === "string") return String(r[key]);
  }
  return JSON.stringify(r, null, 2).slice(0, 800);
}
