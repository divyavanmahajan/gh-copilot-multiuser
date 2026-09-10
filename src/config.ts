/**
 * Runtime configuration. Flags win over environment variables, which win over
 * defaults. Secrets (GitHub App credentials, host token) come from the
 * environment only.
 */
import { parseArgs } from "node:util";
import path from "node:path";

export type Mode = "laptop" | "server";
export type GuestPolicy = "off" | "view" | "participate";

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
    /** GitHub logins that get the host role. Defaults to the first login. */
    hosts: string[];
    apiBase: string;
    webBase: string;
  };
  guests: {
    policy: GuestPolicy;
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
  const guests = (values.guests ?? env.COPILOT_ROOM_GUESTS ?? "off") as GuestPolicy;

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
      apiBase: env.GITHUB_API_URL ?? "https://api.github.com",
      webBase: env.GITHUB_SERVER_URL ?? "https://github.com",
    },
    guests: { policy: guests, code: values["guest-code"] ?? env.COPILOT_ROOM_GUEST_CODE },
    copilotToken: env.COPILOT_GITHUB_TOKEN ?? env.GH_TOKEN,
    cookieSecret: env.COPILOT_ROOM_COOKIE_SECRET,
    dev: Boolean(values.dev),
  };
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
  --org ORG[/TEAM]      Only members of this org or team may join
  --hosts a,b           GitHub logins with the host role
  --guests off|view|participate
                        Admit non-GitHub users with a join code (default: off)
  --guest-code CODE     Join code for guests (generated when unset)
  --dev                 Serve the Vite dev client instead of dist/web

Environment: GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, COPILOT_GITHUB_TOKEN,
COPILOT_ROOM_COOKIE_SECRET, COPILOT_ROOM_PERMISSION_TIMEOUT, HTTPS_PROXY.`);
}
