import { useEffect, useState } from "react";

interface RoomMeta {
  name: string;
  mode: "laptop" | "server";
  providers: string[];
  guestsPolicy: "off" | "view" | "participate";
}

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [device, setDevice] = useState<{ flowId: string; userCode: string; verificationUri: string; interval: number } | null>(null);
  const [guest, setGuest] = useState({ name: "", code: "" });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/room").then((r) => r.json()).then((j) => setMeta(j as RoomMeta));
  }, []);

  // Device flow: poll until GitHub reports success.
  useEffect(() => {
    if (!device) return;
    const t = window.setInterval(async () => {
      const r = await fetch("/auth/github/device/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId: device.flowId }),
      });
      const j = (await r.json()) as { status: string; error?: string };
      if (j.status === "ok") onSignedIn();
      else if (j.status !== "pending") {
        setErr(j.status === "forbidden" ? "You are not a member of the allowed organization." : `Sign-in failed: ${j.error ?? j.status}`);
        setDevice(null);
      }
    }, (device.interval + 1) * 1000);
    return () => window.clearInterval(t);
  }, [device, onSignedIn]);

  const startDevice = async () => {
    const r = await fetch("/auth/github/device", { method: "POST" });
    setDevice((await r.json()) as typeof device);
  };

  const joinAsGuest = async () => {
    const r = await fetch("/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(guest),
    });
    if (r.ok) onSignedIn();
    else setErr(((await r.json()) as { error?: string }).error ?? "could not join");
  };

  if (!meta) return <div className="login">Loading…</div>;
  const github = meta.providers.includes("github");
  const guests = meta.providers.includes("guest");

  return (
    <div className="login card">
      <h2>{meta.name}</h2>
      <p>One Copilot agent, one repo, everyone in the room.</p>
      {err && <p style={{ color: "var(--danger)" }}>{err}</p>}

      {github && !device && (
        <p>
          {meta.mode === "server" ? (
            <a href="/auth/github/login"><button>Sign in with GitHub</button></a>
          ) : (
            <button onClick={startDevice}>Sign in with GitHub (device code)</button>
          )}
          {meta.mode === "laptop" && (
            <>
              {" "}
              <a href="/auth/github/login"><button className="secondary">use browser redirect instead</button></a>
            </>
          )}
        </p>
      )}
      {device && (
        <p>
          Open <a href={device.verificationUri} target="_blank" rel="noreferrer">{device.verificationUri}</a> and enter{" "}
          <strong style={{ fontSize: 20, letterSpacing: 2 }}>{device.userCode}</strong>. Waiting…
        </p>
      )}

      {guests && (
        <>
          <hr style={{ borderColor: "var(--border)" }} />
          <p>
            Join as a guest ({meta.guestsPolicy === "participate" ? "can prompt" : "view only"}). Guests are not verified.
          </p>
          <label>Your name</label>
          <input value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
          <label>Join code</label>
          <input value={guest.code} onChange={(e) => setGuest({ ...guest, code: e.target.value })} />
          <button className="secondary" onClick={joinAsGuest}>Join</button>
        </>
      )}
    </div>
  );
}
