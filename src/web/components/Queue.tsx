import { can, type Identity, type QueuedPrompt } from "../../protocol/messages.js";

export function Queue({
  current,
  queue,
  me,
  onWithdraw,
}: {
  current: QueuedPrompt | null;
  queue: QueuedPrompt[];
  me: Identity;
  onWithdraw: (id: string) => void;
}) {
  if (!current && queue.length === 0) return <div className="entry meta">idle</div>;
  return (
    <div>
      {current && (
        <div className="queue-item">
          <span className="text"><strong>{current.authorLogin}</strong>: {current.text}</span>
          <span className="badge">running</span>
        </div>
      )}
      {queue.map((p, i) => (
        <div key={p.id} className="queue-item">
          <span className="text">{i + 1}. <strong>{p.authorLogin}</strong>: {p.text}</span>
          {(p.authorId === me.id || can(me.role, "withdrawOthers")) && (
            <button className="secondary" onClick={() => onWithdraw(p.id)}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}
