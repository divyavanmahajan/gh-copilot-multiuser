import { useEffect, useMemo, useRef, useState } from "react";
import {
  can,
  splitAgentMention,
  type AdmissionRequest,
  type Identity,
  type Participant,
  type QueuedPrompt,
  type RoomSettings,
  type RoomStatus,
  type Catalog,
  type ServerMessage,
  type TranscriptEntry,
} from "../protocol/messages.js";
import { RoomSocket } from "./lib/ws.js";
import { Login } from "./components/Login.js";
import { Transcript } from "./components/Transcript.js";
import { Queue } from "./components/Queue.js";
import { Presence } from "./components/Presence.js";
import { ApprovalCard, type PendingApproval } from "./components/ApprovalCard.js";
import { AdmissionCard } from "./components/AdmissionCard.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import {
  CatalogList,
  CommandPicker,
  itemsFor,
  localCommand,
  pickerFor,
} from "./components/CommandPicker.js";

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
  const [admissions, setAdmissions] = useState<AdmissionRequest[]>([]);
  const [settings, setSettings] = useState<RoomSettings | null>(null);
  const [guestCode, setGuestCode] = useState<string | null>(null);
  const [gate, setGate] = useState<"open" | "waiting" | "rejected">("open");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [catalog, setCatalog] = useState<Catalog>({ skills: [], agents: [] });
  const [listing, setListing] = useState<"skills" | "agents" | null>(null);
  const [highlight, setHighlight] = useState(0);
  const typingTimer = useRef<number | null>(null);

  useEffect(() => {
    const off = socket.on((msg: ServerMessage) => {
      switch (msg.type) {
        case "hello":
          setGate("open");
          setMe(msg.you);
          setRoom(msg.room);
          setStatus(msg.status);
          setParticipants(msg.participants);
          setQueue(msg.queue);
          setCurrent(msg.current);
          setTranscript(msg.transcript);
          setAdmissions(msg.pendingAdmissions);
          setSettings(msg.settings);
          setGuestCode(msg.guestCode);
          setCatalog(msg.catalog);
          break;
        case "catalog":
          setCatalog(msg.catalog);
          break;
        case "settings":
          setSettings(msg.settings);
          break;
        case "admission.pending":
          setMe(msg.you);
          setGate("waiting");
          break;
        case "admission.decided":
          if (msg.role === null) setGate("rejected");
          // Otherwise a hello follows with the new role.
          break;
        case "admissions":
          setAdmissions(msg.requests);
          if (msg.requests.length > 0) document.title = `(${msg.requests.length}) copilot-room`;
          else document.title = "copilot-room";
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

    // /skills, /agents and /refresh are the room's own, not the agent's: a
    // listing is for the person who asked, so it never enters the transcript.
    const local = localCommand(text);
    if (local) {
      if (local === "refresh") socket.send({ type: "catalog.refresh" });
      else setListing(local);
      setDraft("");
      return;
    }

    // A leading @name is routing, so it travels beside the prompt rather than
    // inside it; the server checks the name before anything is queued.
    const { agent, text: body } = splitAgentMention(text);
    socket.send({ type: "prompt.submit", text: body, ...(agent ? { agent } : {}) });
    socket.send({ type: "typing", typing: false });
    setDraft("");
  };

  const onDraftChange = (v: string) => {
    setDraft(v);
    socket.send({ type: "typing", typing: v.length > 0 });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => socket.send({ type: "typing", typing: false }), 3000);
  };

  if (gate === "rejected") {
    return (
      <div className="waiting card">
        <h2>Not admitted</h2>
        <p>A host declined to let you into this room.</p>
        <button className="secondary" onClick={() => fetch("/auth/logout", { method: "POST" }).then(() => location.reload())}>
          Sign out
        </button>
      </div>
    );
  }
  if (gate === "waiting" && me) {
    return (
      <div className="waiting card">
        <h2>Waiting for a host</h2>
        <p>
          You are signed in as <strong>{me.displayName}</strong> ({me.login}). A host has been notified and will admit you as a
          viewer or a participant.
        </p>
        <p className="who">Keep this tab open.</p>
      </div>
    );
  }
  if (!me || !room) return <div className="login">Joining room…</div>;
  const canPrompt = can(me.role, "prompt");

  // Recomputed each render: the draft is the only source of truth for whether
  // a picker is open, so there is no second piece of state to fall out of sync.
  const picker = canPrompt ? pickerFor(draft) : null;
  const pickerItems = picker ? itemsFor(picker, catalog) : [];

  const complete = (name: string) => {
    // /skills and friends are whole commands; everything else takes arguments.
    const isLocal = picker?.kind === "/" && localCommand(`/${name}`);
    setDraft(`${picker?.kind ?? ""}${name}${isLocal ? "" : " "}`);
    setHighlight(0);
  };

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
        {admissions.map((a) => (
          <AdmissionCard
            key={a.identity.id}
            request={a}
            onDecide={(decision) => socket.send({ type: "admission.decide", userId: a.identity.id, decision })}
          />
        ))}
        {listing && <CatalogList kind={listing} catalog={catalog} onClose={() => setListing(null)} />}
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
        <Presence
          participants={participants}
          me={me}
          onChangeRole={(userId, decision) => socket.send({ type: "admission.decide", userId, decision })}
        />
        {settings && can(me.role, "settings") && (
          <>
            <h3>Admission</h3>
            <SettingsPanel
              settings={settings}
              guestCode={guestCode}
              onChange={(patch) => socket.send({ type: "settings.update", patch })}
            />
          </>
        )}
        <h3>Queue</h3>
        <Queue
          current={current}
          queue={queue}
          me={me}
          onWithdraw={(id) => socket.send({ type: "prompt.withdraw", promptId: id })}
        />
      </aside>

      <footer>
        {picker && (
          <CommandPicker
            state={picker}
            items={pickerItems}
            highlight={Math.min(highlight, Math.max(pickerItems.length - 1, 0))}
            onPick={complete}
          />
        )}
        <textarea
          rows={2}
          placeholder={
            canPrompt
              ? "Ask the agent… / for a skill, @ for an agent (Enter to send, Shift+Enter for newline)"
              : "Viewers can watch but not prompt"
          }
          disabled={!canPrompt}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            // While the picker is open the arrow keys and Enter belong to it.
            if (picker && pickerItems.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + step + pickerItems.length) % pickerItems.length);
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                const chosen = pickerItems[Math.min(highlight, pickerItems.length - 1)];
                if (chosen) complete(chosen.name);
                return;
              }
            }
            if (e.key === "Escape") {
              setDraft("");
              return;
            }
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
