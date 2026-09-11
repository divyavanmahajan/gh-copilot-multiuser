import type { AdmissionPolicy, RoomSettings, RoomSettingsPatch } from "../../protocol/messages.js";

const LABELS: Record<AdmissionPolicy, string> = {
  approve: "Host approves (default)",
  viewer: "Admit as viewer",
  member: "Admit as participant",
  off: "Refuse",
};

const ROWS: Array<{ key: keyof RoomSettings["admission"]; label: string; hint: string }> = [
  { key: "github", label: "GitHub", hint: "outside the allowed org or team" },
  { key: "entra", label: "Microsoft", hint: "outside the allowed group" },
  { key: "guest", label: "Guests", hint: "with the join code, unverified" },
];

/** Hosts only: who gets in without a host clicking, per sign-in type. Persists. */
export function SettingsPanel({
  settings,
  guestCode,
  onChange,
}: {
  settings: RoomSettings;
  guestCode: string | null;
  onChange: (patch: RoomSettingsPatch) => void;
}) {
  return (
    <div className="settings">
      {ROWS.map((r) => (
        <label key={r.key} className="settings-row">
          <span>
            {r.label}
            <span className="who">{r.hint}</span>
          </span>
          <select
            value={settings.admission[r.key]}
            onChange={(e) => onChange({ admission: { [r.key]: e.target.value as AdmissionPolicy } })}
          >
            {(Object.keys(LABELS) as AdmissionPolicy[]).map((p) => (
              <option key={p} value={p}>{LABELS[p]}</option>
            ))}
          </select>
        </label>
      ))}
      {settings.admission.guest !== "off" && guestCode && (
        <div className="who" style={{ marginTop: 6 }}>
          Guest join code: <code style={{ fontSize: 14, letterSpacing: 1 }}>{guestCode}</code>
        </div>
      )}
      <div className="who" style={{ marginTop: 6 }}>
        Hosts, org or group members, the allow list and remembered decisions always skip approval.
      </div>
    </div>
  );
}
