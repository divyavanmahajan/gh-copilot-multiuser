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
  // PermissionRequest is a union keyed by `kind`; show what a human needs to decide.
  const intention = typeof r.intention === "string" ? `${r.intention}\n` : "";
  switch (r.kind) {
    case "shell":
      return `${intention}$ ${String(r.fullCommandText ?? "")}`;
    case "write":
      return `${intention}${String(r.fileName ?? "")}\n${String(r.diff ?? "").slice(0, 2000)}`;
    case "read":
      return `${intention}${String(r.path ?? r.fileName ?? "")}`;
    case "url":
      return `${intention}${String(r.url ?? "")}`;
    case "mcp":
      return `${intention}${String(r.serverName ?? "")} / ${String(r.toolName ?? "")}`;
    default:
      return intention + JSON.stringify(r, null, 2).slice(0, 800);
  }
}
