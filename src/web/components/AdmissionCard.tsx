import type { AdmissionDecision, AdmissionRequest } from "../../protocol/messages.js";

/** Shown to hosts: someone signed in and is waiting at the door. */
export function AdmissionCard({
  request,
  onDecide,
}: {
  request: AdmissionRequest;
  onDecide: (d: AdmissionDecision) => void;
}) {
  const { identity } = request;
  const via = identity.provider === "github" ? "GitHub" : identity.provider === "entra" ? "Microsoft Entra" : "guest";
  return (
    <div className="card admission">
      <div className="who">Waiting to join · signed in with {via} · {new Date(request.requestedAt).toLocaleTimeString()}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0" }}>
        {identity.avatarUrl && <img src={identity.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: 14 }} />}
        <strong>{identity.displayName}</strong>
        <span className="badge">{identity.login}</span>
      </div>
      <div className="actions">
        <button onClick={() => onDecide("member")}>Admit as participant</button>
        <button className="secondary" onClick={() => onDecide("viewer")}>Admit as viewer</button>
        <button className="danger" onClick={() => onDecide("reject")}>Reject</button>
      </div>
    </div>
  );
}
