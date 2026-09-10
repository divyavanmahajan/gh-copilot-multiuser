import { useEffect, useMemo, useRef, useState } from "react";
import {
  can,
  type Identity,
  type Participant,
  type QueuedPrompt,
  type RoomStatus,
  type ServerMessage,
  type TranscriptEntry,
} from "../protocol/messages.js";
import { RoomSocket } from "./lib/ws.js";
import { Login } from "./components/Login.js";
import { Transcript } from "./components/Transcript.js";
import { Queue } from "./components/Queue.js";
import { Presence } from "./components/Presence.js";
import { ApprovalCard, type PendingApproval } from "./components/ApprovalCard.js";

interface RoomInfo {
  name: string;
  repo: string;
  sessionId: string;
  model?: string;
}

export function App() {
  const [me, setMe] = useState<Identity | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMe(j as Identity | null))
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return <div className="login">Loading…</div>;
  if (me === null) return <Login onSignedIn={() => location.reload()} />;
  return <RoomView />;
}

function RoomView() {
  const socket = useMemo(() => new RoomSocket(), []);
  const [me, setMe] = useState<Identity | null>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [status, setStatus] = useState<RoomStatus>("starting");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const [current, setCurrent] = useState<QueuedPrompt | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const typingTimer = useRef<number | null>(null);

  useEffect(() => {
    const off = socket.on((msg: ServerMessage) => {
      switch (msg.type) {
        case "hello":
          setMe(msg.you);
          setRoom(msg.room);
          setStatus(msg.status);
          setParticipants(msg.participants);
          setQueue(msg.queue);
          setCurrent(msg.current);
          setTranscript(msg.transcript);
          break;
        case "participants":
          setParticipants(msg.participants);
          break;
        case "status":
          setStatus(msg.status);
          break;
        case "queue":
          setQueue(msg.queue);
          setCurrent(msg.current);
          break;
        case "transcript":
          setTranscript((t) => [...t, msg.entry]);
          if (msg.entry.kind === "permission.resolved") {
            const id = msg.entry.requestId;
            setApprovals((a) => a.filter((p) => p.requestId !== id));
          }
          break;
        case "permission.request":
          setApprovals((a) => [...a, { requestId: msg.requestId, request: msg.request, deciderIds: msg.deciderIds, expiresAt: msg.expiresAt }]);
          break;
        case "error":
          setError(msg.message);
          setTimeout(() => setError(null), 4000);
          break;
      }
    });
    socket.connect();
    return () => {
      off();
      socket.close();
    };
  }, [socket]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    socket.send({ type: "prompt.submit", text });
    socket.send({ type: "typing", typing: false });
    setDraft("");
  };

  const onDraftChange = (v: string) => {
    setDraft(v);
    socket.send({ type: "typing", typing: v.length > 0 });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => socket.send({ type: "typing", typing: false }), 3000);
  };

  if (!me || !room) return <div className="login">Joining room…</div>;
  const canPrompt = can(me.role, "prompt");

  return (
    <div className="layout">
      <header>
        <strong>{room.name}</strong>
        <span className={`status ${status}`}>
          {status === "running" && current ? `running · ${current.authorLogin}` : status}
        </span>
        <span className="status">session {room.sessionId.slice(0, 8)}</span>
        {error && <span className="status" style={{ color: "var(--danger)" }}>{error}</span>}
        <span style={{ flex: 1 }} />
        {can(me.role, "abort") && status === "running" && (
          <button className="danger" onClick={() => socket.send({ type: "turn.abort" })}>Abort turn</button>
        )}
        <span className="status">
          {me.displayName}
          <span className="badge">{me.role}</span>
          {me.provider === "guest" && <span className="badge">guest</span>}
        </span>
      </header>

      <main>
        <Transcript entries={transcript} />
        {approvals.map((a) => (
          <ApprovalCard
            key={a.requestId}
            pending={a}
            me={me}
            participants={participants}
            onDecide={(decision) => socket.send({ type: "permission.respond", requestId: a.requestId, decision })}
          />
        ))}
      </main>

      <aside>
        <h3>In the room</h3>
        <Presence participants={participants} />
        <h3>Queue</h3>
        <Queue
          current={current}
          queue={queue}
          me={me}
          onWithdraw={(id) => socket.send({ type: "prompt.withdraw", promptId: id })}
        />
      </aside>

      <footer>
        <textarea
          rows={2}
          placeholder={canPrompt ? "Ask the agent… (Enter to send, Shift+Enter for newline)" : "Viewers can watch but not prompt"}
          disabled={!canPrompt}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button disabled={!canPrompt || !draft.trim()} onClick={submit}>
          {status === "running" ? "Queue" : "Send"}
        </button>
      </footer>
    </div>
  );
}
