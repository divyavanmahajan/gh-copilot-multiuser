/**
 * Who gets in, and as what.
 *
 * Every sign-in provider ends by calling resolveRole(). The order is:
 *   1. logins listed in --hosts are hosts;
 *   2. users who pass the provider's automatic gate (GitHub org/team,
 *      Entra tenant/group) are members;
 *   3. a stored decision (a host admitted or rejected them before, or the
 *      --allow list) applies;
 *   4. otherwise the provider's admission policy decides: off (403),
 *      approve (wait for a host), viewer or member (admit at once).
 *
 * Decisions persist in <state-dir>/admissions.json so an approval survives
 * restarts and a server with no host online still lets known people in.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdmissionDecision, AdmissionPolicy, Identity, IdentityProvider, Role } from "../../protocol/messages.js";

export type { AdmissionPolicy };

export interface AllowEntry {
  provider: IdentityProvider;
  login: string;
  role: Exclude<Role, "pending">;
}

export interface StoredDecision {
  role: Exclude<Role, "pending"> | "rejected";
  by: string;
  at: string;
  login?: string;
}

export class Admissions {
  private readonly file: string;
  private decisions: Record<string, StoredDecision> = {};

  constructor(stateDir: string, private readonly allow: AllowEntry[] = []) {
    this.file = path.join(stateDir, "admissions.json");
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.decisions = JSON.parse(await readFile(this.file, "utf8")) as Record<string, StoredDecision>;
    } catch {
      this.decisions = {};
    }
  }

  /** Stored decision for this identity, or an --allow entry matching provider and login. */
  lookup(identity: Pick<Identity, "id" | "provider" | "login">): StoredDecision | undefined {
    const stored = this.decisions[identity.id];
    if (stored) return stored;
    const allowed = this.allow.find(
      (a) => a.provider === identity.provider && a.login.toLowerCase() === identity.login.toLowerCase(),
    );
    return allowed ? { role: allowed.role, by: "allowlist", at: "" } : undefined;
  }

  async record(identity: Pick<Identity, "id" | "login">, decision: AdmissionDecision, by: string): Promise<void> {
    this.decisions[identity.id] = {
      role: decision === "reject" ? "rejected" : decision,
      by,
      at: new Date().toISOString(),
      login: identity.login,
    };
    await writeFile(this.file, JSON.stringify(this.decisions, null, 2));
  }

  list(): Array<[string, StoredDecision]> {
    return Object.entries(this.decisions);
  }
}

export interface ResolveInput {
  identity: Pick<Identity, "id" | "provider" | "login">;
  hosts: string[];
  /** true: passed the automatic gate; false: failed it; null: no gate configured. */
  gate: boolean | null;
  policy: AdmissionPolicy;
  admissions: Admissions;
}

/** Null means refuse the sign-in. */
export function resolveRole({ identity, hosts, gate, policy, admissions }: ResolveInput): Role | null {
  if (hosts.some((h) => h.toLowerCase() === identity.login.toLowerCase())) return "host";
  if (gate === true) return "member";
  const stored = admissions.lookup(identity);
  if (stored) return stored.role === "rejected" ? null : stored.role;
  switch (policy) {
    case "approve":
      return "pending";
    case "viewer":
      return "viewer";
    case "member":
      return "member";
    case "off":
      return null;
  }
}

/** Parse "github:alice:member,entra:bob@corp.com:viewer". */
export function parseAllowList(spec: string | undefined): AllowEntry[] {
  if (!spec) return [];
  const out: AllowEntry[] = [];
  for (const raw of spec.split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const [provider, login, role = "member"] = item.split(":");
    if (!provider || !login) throw new Error(`bad --allow entry "${item}", expected provider:login[:role]`);
    if (!["github", "entra", "guest"].includes(provider)) throw new Error(`bad provider in --allow entry "${item}"`);
    if (!["host", "member", "viewer"].includes(role)) throw new Error(`bad role in --allow entry "${item}"`);
    out.push({ provider: provider as IdentityProvider, login, role: role as AllowEntry["role"] });
  }
  return out;
}
