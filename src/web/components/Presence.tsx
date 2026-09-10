import type { Participant } from "../../protocol/messages.js";

export function Presence({ participants }: { participants: Participant[] }) {
  return (
    <div>
      {participants.map((p) => (
        <div key={p.id} className="queue-item">
          <span className="text">
            {p.displayName}
            <span className="badge">{p.role}</span>
            {p.provider === "guest" && <span className="badge">guest</span>}
          </span>
          {p.typing && <span className="badge">typing…</span>}
        </div>
      ))}
    </div>
  );
}
