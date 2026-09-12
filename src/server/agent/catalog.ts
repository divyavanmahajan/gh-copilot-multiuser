/**
 * Finds the skills and custom agents a repository ships.
 *
 * The runtime discovers none of this on its own: `enableConfigDiscovery`
 * defaults to false, so a room would start with an empty catalog. We scan the
 * conventional folders and hand the runtime an explicit list instead. Scanning
 * ourselves also means the room knows what exists before the agent is asked,
 * which is what the `/` and `@` pickers are built from.
 *
 * Both ecosystems' layouts are read, because a repository that has been worked
 * on by more than one assistant tends to have both:
 *
 *   .github/skills/<name>/SKILL.md      .claude/skills/<name>/SKILL.md
 *   .github/agents/<name>.md            .claude/agents/<name>.md
 *
 * This file must not import the Copilot SDK; it returns plain data that
 * copilot.ts maps onto the SDK's own types.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type CatalogSource = "github" | "claude";

/** A skill the runtime will load, as described by its own SKILL.md. */
export interface SkillDefinition {
  name: string;
  description?: string;
  source: CatalogSource;
  /** Directory holding SKILL.md. */
  path: string;
}

/** A custom agent, shaped to match the SDK's CustomAgentConfig. */
export interface AgentDefinition {
  name: string;
  displayName?: string;
  description?: string;
  prompt: string;
  tools?: string[];
  model?: string;
  source: CatalogSource;
  path: string;
}

export interface DiscoveredCatalog {
  /** Directories to hand the runtime as `skillDirectories`. */
  skillDirectories: string[];
  skills: SkillDefinition[];
  agents: AgentDefinition[];
  /** Folders that exist but could not be read, for the startup log. */
  problems: string[];
}

const SKILL_ROOTS: Array<[CatalogSource, string]> = [
  ["github", ".github/skills"],
  ["claude", ".claude/skills"],
];
const AGENT_ROOTS: Array<[CatalogSource, string]> = [
  ["github", ".github/agents"],
  ["claude", ".claude/agents"],
];

/**
 * Scan a repository. Never throws: a broken skill should not stop the room
 * from starting, so unreadable entries are collected in `problems` instead.
 */
export async function discoverCatalog(repo: string): Promise<DiscoveredCatalog> {
  const out: DiscoveredCatalog = { skillDirectories: [], skills: [], agents: [], problems: [] };

  for (const [source, rel] of SKILL_ROOTS) {
    const root = path.join(repo, rel);
    const entries = await readDirSafe(root, out.problems);
    if (entries === null) continue;
    // The runtime wants the parent directory; it walks the subdirectories itself.
    out.skillDirectories.push(root);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const text = await readFileSafe(path.join(dir, "SKILL.md"), out.problems);
      if (text === null) continue;
      const { data } = parseFrontMatter(text);
      out.skills.push({
        name: str(data.name) ?? entry.name,
        description: str(data.description),
        source,
        path: dir,
      });
    }
  }

  for (const [source, rel] of AGENT_ROOTS) {
    const root = path.join(repo, rel);
    const entries = await readDirSafe(root, out.problems);
    if (entries === null) continue;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const file = path.join(root, entry.name);
      const text = await readFileSafe(file, out.problems);
      if (text === null) continue;
      const { data, body } = parseFrontMatter(text);
      const name = str(data.name) ?? entry.name.replace(/\.md$/, "");
      // An agent with no prompt would be registered but useless; skip it loudly.
      if (!body.trim()) {
        out.problems.push(`${file}: no prompt body, skipped`);
        continue;
      }
      out.agents.push({
        name,
        displayName: str(data.displayName),
        description: str(data.description),
        prompt: body.trim(),
        tools: list(data.tools),
        model: str(data.model),
        source,
        path: file,
      });
    }
  }

  // A name can only mean one thing. Project (.github) wins over .claude, which
  // matches how the runtime shadows user config with project config.
  out.skills = dedupe(out.skills, (s) => s.name);
  out.agents = dedupe(out.agents, (a) => a.name);
  return out;
}

function dedupe<T extends { name: string; source: CatalogSource; path: string }>(
  items: T[],
  key: (item: T) => string,
): T[] {
  const byName = new Map<string, T>();
  for (const item of items) {
    const existing = byName.get(key(item));
    if (existing && existing.source === "github") continue;
    byName.set(key(item), item);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readDirSafe(dir: string, problems: string[]) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // Absent is the normal case, not a problem worth reporting.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") problems.push(`${dir}: ${String(err)}`);
    return null;
  }
}

async function readFileSafe(file: string, problems: string[]) {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") problems.push(`${file}: ${String(err)}`);
    return null;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function list(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return undefined;
}

/**
 * Read the leading `---` block. Deliberately not a YAML parser: skill and agent
 * front matter is a flat map of strings and short lists, and a real YAML
 * dependency would buy nothing but surface area.
 */
export function parseFrontMatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match?.[1]) return { data: {}, body: text };
  const data: Record<string, unknown> = {};
  for (const raw of match[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep < 1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body: text.slice(match[0].length) };
}

function unquote(s: string): string {
  return s.replace(/^["'](.*)["']$/s, "$1");
}
