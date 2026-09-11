import { useEffect, useState } from "react";

type Policy = "off" | "approve" | "viewer" | "member";

interface RoomMeta {
  name: string;
  mode: "laptop" | "server";
  providers: string[];
  admission: { github: Policy; entra: Policy; guest: Policy };
}

const NOTE: Record<Policy, string> = {
  approve: "a host admits you after sign-in",
  viewer: "you join as a viewer",
  member: "you join as a participant",
  off: "members only",
};

interface DeviceFlow {
  provider: "github" | "entra";
  flowId: string;
  userCode: string;
  verificationUri: string;
  interval: number;
}

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [device, setDevice] = useState<DeviceFlow | null>(null);
  const [guest, setGuest] = useState({ name: "", code: "" });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/room").then((r) => r.json()).then((j) => setMeta(j as RoomMeta));
  }, []);

  // Device flow: poll until the identity provider reports success.
  useEffect(() => {
    if (!device) return;
    const t = window.setInterval(async () => {
      const r = await fetch(`/auth/${device.provider}/device/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId: device.flowId }),
      });
      const j = (await r.json()) as { status: string; error?: string };
      if (j.status === "ok") onSignedIn();
      else if (j.status !== "pending") {
        setErr(j.status === "forbidden" ? "Your account is not allowed into this room." : `Sign-in failed: ${j.error ?? j.status}`);
        setDevice(null);
      }
    }, (device.interval + 1) * 1000);
    return () => window.clearInterval(t);
  }, [device, onSignedIn]);

  const startDevice = async (provider: "github" | "entra") => {
    setErr(null);
    const r = await fetch(`/auth/${provider}/device`, { method: "POST" });
    const j = (await r.json()) as Omit<DeviceFlow, "provider"> & { error?: string };
    if (!r.ok) return setErr(j.error ?? "could not start device sign-in");
    setDevice({ provider, ...j });
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
  const entra = meta.providers.includes("entra");
  const guests = meta.providers.includes("guest");
  const laptop = meta.mode === "laptop";

  return (
    <div className="login card">
      <h2>{meta.name}</h2>
      <p>One Copilot agent, one repo, everyone in the room.</p>
      {err && <p style={{ color: "var(--danger)" }}>{err}</p>}

      {device ? (
        <p>
          Open <a href={device.verificationUri} target="_blank" rel="noreferrer">{device.verificationUri}</a> and enter{" "}
          <strong style={{ fontSize: 20, letterSpacing: 2 }}>{device.userCode}</strong>. Waiting…{" "}
          <button className="secondary" onClick={() => setDevice(null)}>cancel</button>
        </p>
      ) : (
        <div className="providers">
          {github && (
            <div className="row">
              {laptop ? (
                <>
                  <button onClick={() => startDevice("github")}>Sign in with GitHub (device code)</button>
                  <a href="/auth/github/login"><button className="secondary">browser redirect</button></a>
                </>
              ) : (
                <a href="/auth/github/login"><button>Sign in with GitHub</button></a>
              )}
              <span className="who">{NOTE[meta.admission.github]}</span>
            </div>
          )}
          {entra && (
            <div className="row">
              {laptop ? (
                <>
                  <button onClick={() => startDevice("entra")}>Sign in with Microsoft (device code)</button>
                  <a href="/auth/entra/login"><button className="secondary">browser redirect</button></a>
                </>
              ) : (
                <a href="/auth/entra/login"><button>Sign in with Microsoft</button></a>
              )}
              <span className="who">{NOTE[meta.admission.entra]}</span>
            </div>
          )}
        </div>
      )}

      {guests && (
        <>
          <hr />
          <p>Join as a guest: {NOTE[meta.admission.guest]}. Guests are not verified.</p>
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
