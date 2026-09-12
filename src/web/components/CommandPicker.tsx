import type { AgentSummary, Catalog, SkillSummary } from "../../protocol/messages.js";

/**
 * The `/` and `@` pickers, and the `/skills` and `/agents` listings.
 *
 * Both triggers only fire on the first token of a prompt. Mid-sentence a slash
 * is usually a path and an at-sign is usually a person, and silently turning
 * either into a command would be worse than not offering the shortcut.
 */

export type PickerKind = "/" | "@";

export interface PickerState {
  kind: PickerKind;
  /** Text typed after the trigger, used to filter. */
  query: string;
}

/** What the draft is asking for, or null when it is an ordinary prompt. */
export function pickerFor(draft: string): PickerState | null {
  const match = /^([/@])([\w.-]*)$/.exec(draft);
  return match?.[1] ? { kind: match[1] as PickerKind, query: match[2] ?? "" } : null;
}

export interface PickerItem {
  name: string;
  description?: string;
  /** Right-aligned hint: a skill's kind, or an agent's tool count. */
  note?: string;
}

export function itemsFor(state: PickerState, catalog: Catalog): PickerItem[] {
  const query = state.query.toLowerCase();
  if (state.kind === "@") {
    return catalog.agents.map(agentItem).filter((i) => i.name.toLowerCase().startsWith(query));
  }
  // The runtime ships its own /skills, and so do we. One name can only mean one
  // thing in the picker, and here the room's own listing is what people want.
  const taken = new Set(LOCAL_COMMANDS.map((c) => c.name));
  const items = [...LOCAL_COMMANDS, ...catalog.skills.filter((s) => !taken.has(s.name)).map(skillItem)];
  return items.filter((i) => i.name.toLowerCase().startsWith(query));
}

const skillItem = (s: SkillSummary): PickerItem => ({
  name: s.name,
  ...(s.description ? { description: s.description } : {}),
  note: s.kind === "skill" ? "skill" : s.kind,
});

const agentItem = (a: AgentSummary): PickerItem => ({
  name: a.name,
  ...(a.description ? { description: a.description } : {}),
  ...(a.tools?.length ? { note: `${a.tools.length} tool${a.tools.length === 1 ? "" : "s"}` } : {}),
});

/** Commands the browser answers on its own, without troubling the agent. */
export const LOCAL_COMMANDS: PickerItem[] = [
  { name: "skills", description: "List the skills this repository ships.", note: "room" },
  { name: "agents", description: "List the custom agents you can send a prompt to.", note: "room" },
  { name: "refresh", description: "Re-scan the repository for skills and agents.", note: "room" },
];

export type LocalCommand = "skills" | "agents" | "refresh";

/** Match a local command, which must be the whole prompt. */
export function localCommand(text: string): LocalCommand | null {
  const name = /^\/([\w.-]+)$/.exec(text.trim())?.[1];
  return name === "skills" || name === "agents" || name === "refresh" ? name : null;
}

export function CommandPicker({
  state,
  items,
  highlight,
  onPick,
}: {
  state: PickerState;
  items: PickerItem[];
  highlight: number;
  onPick: (name: string) => void;
}) {
  if (!items.length) {
    return (
      <div className="picker">
        <div className="picker-empty">
          {state.kind === "/" ? "No skill matches that." : "No custom agent matches that."}
        </div>
      </div>
    );
  }
  return (
    <div className="picker">
      {items.map((item, i) => (
        <button
          key={item.name}
          type="button"
          className={`picker-item${i === highlight ? " on" : ""}`}
          // The textarea must not lose focus before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(item.name)}
        >
          <span className="picker-name">
            {state.kind}
            {item.name}
          </span>
          {item.description && <span className="picker-desc">{item.description}</span>}
          {item.note && <span className="picker-note">{item.note}</span>}
        </button>
      ))}
    </div>
  );
}

/** The `/skills` and `/agents` answers. Local to the reader: nobody else sees it. */
export function CatalogList({ kind, catalog, onClose }: { kind: "skills" | "agents"; catalog: Catalog; onClose: () => void }) {
  const empty =
    kind === "skills"
      ? "No skills found. Add one at .github/skills/<name>/SKILL.md, then run /refresh."
      : "No custom agents found. Add one at .github/agents/<name>.md, then run /refresh.";
  // What the repository ships is the answer people are after; the runtime's own
  // commands are worth listing but not worth burying the repository's under.
  const own = kind === "skills" ? catalog.skills.filter((s) => s.kind === "skill").map(skillItem) : catalog.agents.map(agentItem);
  const builtin = kind === "skills" ? catalog.skills.filter((s) => s.kind !== "skill").map(skillItem) : [];
  const sigil = kind === "skills" ? "/" : "@";

  const rows = (items: PickerItem[]) => (
    <ul className="catalog-list">
      {items.map((r) => (
        <li key={r.name}>
          <code>
            {sigil}
            {r.name}
          </code>
          {r.note && <span className="picker-note">{r.note}</span>}
          {r.description && <div className="picker-desc">{r.description}</div>}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="card catalog">
      <div className="who">
        {kind === "skills" ? "Skills" : "Custom agents"} · only you can see this
        <button className="secondary" onClick={onClose}>
          close
        </button>
      </div>
      {own.length === 0 ? <p className="picker-empty">{empty}</p> : rows(own)}
      {builtin.length > 0 && (
        <details className="catalog-more">
          <summary>{builtin.length} built into the runtime</summary>
          {rows(builtin)}
        </details>
      )}
    </div>
  );
}
