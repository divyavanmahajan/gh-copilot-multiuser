# Deploying copilot-room

## Prerequisites

- Node 22 or newer on the host. The Copilot runtime ships as an optional
  platform package of the SDK, so no separate CLI install is required. Set
  `COPILOT_CLI_PATH` to use an existing Copilot CLI instead.
- A GitHub App (see ENTERPRISE-SETUP.md) with its client id and secret.
- Copilot access for the account the runtime will use.

## Laptop mode (host's machine, same network)

```sh
export GITHUB_APP_CLIENT_ID=...
export GITHUB_APP_CLIENT_SECRET=...
cd ~/src/the-repo
npx copilot-room --host 0.0.0.0 --org my-org/my-team --hosts alice
```

Exporting a secret by hand writes it into your shell history. Every entry
point - `npx copilot-room`, `npm run dev`, and the Docker image - reads a
`.env` from the working directory first, so the values can live in a
gitignored file instead:

```
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
COPILOT_ROOM_COOKIE_SECRET=...
```

A variable already set in the environment beats the file, matching node's own
`--env-file`, so an explicit value on the command line still wins over a stale
`.env`. `COPILOT_ROOM_ENV_FILE` points somewhere else; set it to an empty
string to skip the file entirely. Lock the file down (`chmod 600 .env`, or
`icacls .env /inheritance:r /grant:r "$env:USERNAME:(R,W)"` on Windows).

The runtime uses your own Copilot CLI login. Colleagues open
`http://<your-hostname>:3000`, sign in with the device code shown, and are
in. Nothing leaves the network except the room's calls to github.com and
the runtime's calls to the Copilot API.

Use `--public-url http://<your-hostname>:3000` if you prefer the browser
redirect sign-in over the device code.

### Off-network colleagues

VPN first. If you must expose the room to the internet, put a tunnel in
front (`cloudflared tunnel --url http://localhost:3000`) and keep device
flow, which does not care that the tunnel URL changes.

## Server mode (shared box or container)

```sh
docker build -t copilot-room .
docker run -d --name room \
  -p 3000:3000 \
  -v /srv/the-repo:/workspace \
  -v /srv/room-state:/state \
  -e GITHUB_APP_CLIENT_ID=... \
  -e GITHUB_APP_CLIENT_SECRET=... \
  -e COPILOT_GITHUB_TOKEN=... \
  -e COPILOT_ROOM_PUBLIC_URL=http://devbox.corp.local:3000 \
  -e COPILOT_ROOM_ORG=my-org/my-team \
  -e COPILOT_ROOM_HOSTS=alice,bob \
  -e COPILOT_ROOM_COOKIE_SECRET=$(openssl rand -hex 32) \
  copilot-room
```

`COPILOT_GITHUB_TOKEN` belongs to a service account with a Copilot seat.
The repo checkout at `/workspace` is what the agent edits; make its git
credentials whatever you want the agent to commit and push as. It is also
where the room looks for skills and custom agents, so `.github/skills` and
`.github/agents` must be inside the checkout you mount.

Set `COPILOT_ROOM_COOKIE_SECRET` and keep it stable. It is generated afresh
on every start when unset, which invalidates every browser session: the whole
room is asked to sign in again after a restart.

Register `http://devbox.corp.local:3000/auth/github/callback` as the
GitHub App's callback URL. Internal hostnames are fine.

## Sign-in options

| Variable or flag | Effect |
|---|---|
| `GITHUB_APP_CLIENT_ID` / `_SECRET` | enables GitHub sign-in |
| `--org ORG[/TEAM]` | org or team members admitted as participants |
| `--public-github POLICY` | seed for other GitHub accounts (default: approve) |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | enables Microsoft Entra ID sign-in |
| `--entra-group ID` | group members admitted as participants |
| `--entra-admission POLICY` | seed for other tenant users (default: approve) |
| `--guests POLICY`, `--guest-code CODE` | seed for guests (default: approve) and their join code |
| `--allow github:alice:member,entra:bob@corp.com:viewer` | pre-approved accounts |
| `--hosts alice,bob@corp.com` | GitHub logins or Entra UPNs with the host role |

POLICY is `off`, `approve`, `viewer` or `member`. Flags only seed the first
start; hosts change policies in the UI and the value persists in
`settings.json` under the state directory. Host decisions about individual
people are stored next to it in `admissions.json`.
Entra redirect sign-in needs an `https` public URL; the device code sign-in
does not.

## HTTPS

Optional. Terminate TLS in front (nginx, Caddy, a corporate ingress) and set
`--public-url https://...` so cookies are marked Secure. For a laptop,
`mkcert` plus a reverse proxy works.

## Guests

Guests are allowed by default and wait for a host. The join code is printed
at startup and shown to hosts in the UI; set it with `--guest-code`. Guests
are unverified and badged as such.

## Proxies

The room and the Copilot runtime honour `HTTPS_PROXY`. Corporate CA bundles
go in `NODE_EXTRA_CA_CERTS`.

## State

`--state-dir` (default `<repo>/.copilot-room`, git-ignored) holds the
attributed transcript (`transcript.jsonl`), the host-editable admission
policy (`settings.json`) and the per-person decisions (`admissions.json`).
The Copilot runtime keeps its own session state under
`~/.copilot/session-state/<sessionId>`.

The transcript and the agent's memory are separate. The transcript belongs
to the state directory and outlives any session; the memory belongs to the
Copilot session, and a restart starts a new one unless you pass
`--session-id`. Restart without it and the room replays history the agent no
longer has. Resume the id, or give the room a fresh `--state-dir`, so the two
agree.

A room is one session. To run two conversations, run two rooms, each with
its own `--port` and `--state-dir`; prefer separate checkouts, since two
rooms on one working tree will edit the same files with no coordination.
