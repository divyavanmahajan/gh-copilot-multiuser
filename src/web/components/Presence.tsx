import type { AdmissionDecision, Identity, Participant } from "../../protocol/messages.js";
import { can } from "../../protocol/messages.js";

export function Presence({
  participants,
  me,
  onChangeRole,
}: {
  participants: Participant[];
  me: Identity;
  onChangeRole: (userId: string, decision: AdmissionDecision) => void;
}) {
  const host = can(me.role, "admit");
  return (
    <div>
      {participants.map((p) => (
        <div key={p.id} className="queue-item">
          <span className="text">
            {p.displayName}
            <span className="badge">{p.role}</span>
            {p.provider === "guest" && <span className="badge">guest</span>}
            {p.provider === "entra" && <span className="badge">entra</span>}
          </span>
          {p.typing && <span className="badge">typing…</span>}
          {host && p.id !== me.id && p.role !== "host" && (
            <span style={{ display: "flex", gap: 4 }}>
              {p.role === "viewer" ? (
                <button className="secondary" title="Allow prompting" onClick={() => onChangeRole(p.id, "member")}>↑</button>
              ) : (
                <button className="secondary" title="Make view-only" onClick={() => onChangeRole(p.id, "viewer")}>↓</button>
              )}
              <button className="secondary" title="Remove from room" onClick={() => onChangeRole(p.id, "reject")}>✕</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
