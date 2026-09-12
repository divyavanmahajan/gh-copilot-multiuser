/**
 * Runtime configuration. Flags win over environment variables, which win over
 * defaults. Secrets (GitHub App credentials, host token) come from the
 * environment only.
 */
import { parseArgs } from "node:util";
import path from "node:path";

import { parseAllowList, type AdmissionPolicy, type AllowEntry } from "./server/auth/admissions.js";

export type Mode = "laptop" | "server";

export interface Config {
  mode: Mode;
  repo: string;
  host: string;
  port: number;
  /** Externally reachable base URL, e.g. http://devbox.corp.local:3000. */
  publicUrl: string;
  roomName: string;
  model?: string;
  /** Stable session id so restarts resume the same conversation. */
  sessionId?: string;
  /** Where room state (session id, transcript) is kept. */
  stateDir: string;
  /** Seconds a permission request waits for a human before it is denied. */
  permissionTimeoutSeconds: number;
  github: {
    /** GitHub App OAuth client id and secret. Required unless guests are the only login. */
    clientId?: string;
    clientSecret?: string;
    /** Allowed org, optionally narrowed to one team ("org" or "org/team-slug"). */
    allowed?: { org: string; team?: string };
    /** Logins (GitHub login or Entra UPN) that get the host role. */
    hosts: string[];
    /** Seed for the GitHub admission policy (outside --org). Hosts can change it in the UI. */
    publicAdmission?: AdmissionPolicy;
    apiBase: string;
    webBase: string;
  };
  entra?: {
    tenantId: string;
    clientId: string;
    /** Optional: without it the app must allow public client flows (PKCE / device code). */
    clientSecret?: string;
    /** Optional group object id; membership required via the `groups` claim. */
    group?: string;
    /** Seed for the Entra admission policy (outside the group). Hosts can change it in the UI. */
    admission?: AdmissionPolicy;
  };
  /** Pre-approved logins, e.g. for a server with no host online. */
  allow: AllowEntry[];
  guests: {
    /** Seed for the guest admission policy. Hosts can change it in the UI. */
    policy?: AdmissionPolicy;
    /** Join code guests must present. Generated at startup when unset. */
    code?: string;
  };
  /** Token the Copilot runtime authenticates with. Unset means the host's CLI login. */
  copilotToken?: string;
  /** Secret used to sign browser session cookies. Generated when unset. */
  cookieSecret?: string;
  dev: boolean;
}

export function loadConfig(argv = process.argv.slice(2), env = process.env): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string" },
      repo: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      "public-url": { type: "string" },
      name: { type: "string" },
      model: { type: "string" },
      "session-id": { type: "string" },
      "state-dir": { type: "string" },
      org: { type: "string" },
      hosts: { type: "string" },
      guests: { type: "string" },
      "guest-code": { type: "string" },
      "public-github": { type: "string" },
      "entra-group": { type: "string" },
      "entra-admission": { type: "string" },
      allow: { type: "string" },
      dev: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const mode = (values.mode ?? env.COPILOT_ROOM_MODE ?? "laptop") as Mode;
  const repo = path.resolve(values.repo ?? env.COPILOT_ROOM_REPO ?? process.cwd());
  const host = values.host ?? env.COPILOT_ROOM_HOST ?? (mode === "server" ? "0.0.0.0" : "127.0.0.1");
  const port = Number(values.port ?? env.PORT ?? 3000);
  const publicUrl = (values["public-url"] ?? env.COPILOT_ROOM_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
  const orgSpec = values.org ?? env.COPILOT_ROOM_ORG;
  const [org, team] = orgSpec ? orgSpec.split("/") : [undefined, undefined];
  const guests = policy(values.guests ?? env.COPILOT_ROOM_GUESTS, "--guests");
  const publicAdmission = policy(values["public-github"] ?? env.COPILOT_ROOM_PUBLIC_GITHUB, "--public-github");
  const entraAdmission = policy(values["entra-admission"] ?? env.COPILOT_ROOM_ENTRA_ADMISSION, "--entra-admission");

  return {
    mode,
    repo,
    host,
    port,
    publicUrl,
    roomName: values.name ?? env.COPILOT_ROOM_NAME ?? path.basename(repo),
    model: values.model ?? env.COPILOT_ROOM_MODEL,
    sessionId: values["session-id"] ?? env.COPILOT_ROOM_SESSION_ID,
    stateDir: path.resolve(values["state-dir"] ?? env.COPILOT_ROOM_STATE_DIR ?? path.join(repo, ".copilot-room")),
    permissionTimeoutSeconds: Number(env.COPILOT_ROOM_PERMISSION_TIMEOUT ?? 120),
    github: {
      clientId: env.GITHUB_APP_CLIENT_ID,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      allowed: org ? { org, team } : undefined,
      hosts: (values.hosts ?? env.COPILOT_ROOM_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      publicAdmission,
      apiBase: env.GITHUB_API_URL ?? "https://api.github.com",
      webBase: env.GITHUB_SERVER_URL ?? "https://github.com",
    },
    entra:
      env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID
        ? {
            tenantId: env.ENTRA_TENANT_ID,
            clientId: env.ENTRA_CLIENT_ID,
            clientSecret: env.ENTRA_CLIENT_SECRET,
            group: values["entra-group"] ?? env.COPILOT_ROOM_ENTRA_GROUP,
            admission: entraAdmission,
          }
        : undefined,
    allow: parseAllowList(values.allow ?? env.COPILOT_ROOM_ALLOW),
    guests: { policy: guests, code: values["guest-code"] ?? env.COPILOT_ROOM_GUEST_CODE },
    copilotToken: env.COPILOT_GITHUB_TOKEN ?? env.GH_TOKEN,
    cookieSecret: env.COPILOT_ROOM_COOKIE_SECRET,
    dev: Boolean(values.dev),
  };
}

/** Parse an admission policy flag. Undefined means "not given, use the saved value or default". */
function policy(value: string | undefined, flag: string): AdmissionPolicy | undefined {
  if (value === undefined) return undefined;
  // Aliases kept from the first release.
  if (value === "view") return "viewer";
  if (value === "participate") return "member";
  if (value === "off" || value === "approve" || value === "viewer" || value === "member") return value;
  throw new Error(`${flag} must be one of off, approve, viewer, member`);
}

function printHelp(): void {
  console.log(`copilot-room: one Copilot agent, one repo, your whole team in the room.

Usage: copilot-room [options]

  --repo DIR            Repository the agent works in (default: cwd)
  --mode laptop|server  laptop binds localhost, server binds all interfaces (default: laptop)
  --host ADDR           Bind address (overrides mode default)
  --port N              Port (default: 3000)
  --public-url URL      Externally reachable URL, used for OAuth callbacks
  --name NAME           Room name shown in the UI (default: repo folder name)
  --model NAME          Copilot model to use (default: runtime default)
  --session-id ID       Resume a specific Copilot session
  --state-dir DIR       Room state directory (default: <repo>/.copilot-room)
  --org ORG[/TEAM]      GitHub org or team whose members skip host approval
  --entra-group ID      Entra group object id whose members skip host approval
  --hosts a,b           GitHub logins or Entra UPNs with the host role
  --allow LIST          Pre-approved users: github:alice:member,entra:bob@corp.com:viewer

  Admission policies (initial values; hosts change them in the UI and the
  change persists): off = refuse, approve = a host admits (default),
  viewer / member = admit at once.
  --public-github POLICY    GitHub users outside --org
  --entra-admission POLICY  Entra users outside --entra-group
  --guests POLICY           anonymous guests presenting the join code
  --guest-code CODE         join code for guests (generated when unset)
  --dev                 Development mode (client still comes from dist/web:
                        rerun 'npm run build:web' after changing src/web)

Environment: GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, ENTRA_TENANT_ID,
ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, COPILOT_GITHUB_TOKEN, COPILOT_ROOM_COOKIE_SECRET,
COPILOT_ROOM_PERMISSION_TIMEOUT, COPILOT_ROOM_ALLOW, HTTPS_PROXY.`);
}
