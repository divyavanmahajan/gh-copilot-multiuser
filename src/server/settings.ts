/**
 * Host-editable room settings, persisted in <state-dir>/settings.json.
 *
 * Precedence at startup: a value a host saved from the UI wins over the
 * command-line seed, which wins over the default. The default admission
 * policy for every sign-in type is `approve`: a host lets people in.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RoomSettingsPatch, type AdmissionPolicy, type RoomSettings } from "../protocol/messages.js";

export const DEFAULT_SETTINGS: RoomSettings = {
  admission: { github: "approve", entra: "approve", guest: "approve" },
};

export interface SettingsSeed {
  admission?: Partial<Record<"github" | "entra" | "guest", AdmissionPolicy | undefined>>;
}

export class SettingsStore {
  private readonly file: string;
  private current: RoomSettings = DEFAULT_SETTINGS;
  private readonly listeners = new Set<(s: RoomSettings) => void>();

  constructor(stateDir: string, private readonly seed: SettingsSeed = {}) {
    this.file = path.join(stateDir, "settings.json");
  }

  async load(): Promise<RoomSettings> {
    await mkdir(path.dirname(this.file), { recursive: true });
    // The file may be hand-edited or partial; unknown or missing keys fall through.
    let saved: RoomSettingsPatch = {};
    try {
      const parsed = RoomSettingsPatch.safeParse(JSON.parse(await readFile(this.file, "utf8")));
      if (parsed.success) saved = parsed.data;
    } catch {
      // first run
    }
    this.current = {
      admission: {
        github: saved.admission?.github ?? this.seed.admission?.github ?? DEFAULT_SETTINGS.admission.github,
        entra: saved.admission?.entra ?? this.seed.admission?.entra ?? DEFAULT_SETTINGS.admission.entra,
        guest: saved.admission?.guest ?? this.seed.admission?.guest ?? DEFAULT_SETTINGS.admission.guest,
      },
    };
    return this.current;
  }

  get(): RoomSettings {
    return this.current;
  }

  /** Live getter for one provider's policy; providers read it at sign-in time. */
  policy(provider: keyof RoomSettings["admission"]): () => AdmissionPolicy {
    return () => this.current.admission[provider];
  }

  async update(patch: RoomSettingsPatch): Promise<RoomSettings> {
    this.current = { admission: { ...this.current.admission, ...stripUndefined(patch.admission ?? {}) } };
    await writeFile(this.file, JSON.stringify(this.current, null, 2));
    for (const l of this.listeners) l(this.current);
    return this.current;
  }

  onChange(listener: (s: RoomSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
